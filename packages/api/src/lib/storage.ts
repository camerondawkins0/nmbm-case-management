import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

// Where uploaded documents live. Rules, whichever provider is active —
// ported from the WSL system:
//  - a private bucket, never public
//  - signed URLs that expire in 15 minutes, so a link pasted somewhere
//    stops working
//  - opaque keys (documents/<uuid>): no participant name or id in a
//    bucket listing or a log line
//  - bytes never in the database
// And nothing is deleted: a document is voided in the database and its
// file kept, for the seven years R6 asks for.
export const SIGNED_URL_MINUTES = 15;

export type UploadInstructions = { url: string; method: "PUT"; headers: Record<string, string> };

export interface StorageProvider {
  readonly name: "gcs" | "local";
  // The browser uploads straight to storage with this. The size cap and
  // content type are part of the signature, so the browser can't send
  // something other than what the server agreed to.
  createUploadUrl(key: string, contentType: string, maxBytes: number): Promise<UploadInstructions>;
  createDownloadUrl(key: string, filename: string, contentType: string): Promise<string>;
  // Null when nothing has been uploaded under the key — how the server
  // confirms an upload really happened before it shows up on a record.
  stat(key: string): Promise<{ size: number; contentType: string | null } | null>;
}

export function opaqueKey(): string {
  return `documents/${crypto.randomUUID()}`;
}

// Quoted for a Content-Disposition header: the filename is what a person
// called their file, so it's escaped rather than trusted.
function disposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Google Cloud Storage, in production. V4 signed URLs against a private
// bucket. On Cloud Run there's no key file, so signing goes through the
// IAM signBlob API — the runtime account needs Token Creator on itself
// (deploy/setup-gcp.sh grants it).
export class GcsStorageProvider implements StorageProvider {
  readonly name = "gcs" as const;
  constructor(private readonly bucketName: string) {}

  private async file(key: string) {
    const { Storage } = await import("@google-cloud/storage");
    return new Storage().bucket(this.bucketName).file(key);
  }

  async createUploadUrl(key: string, contentType: string, maxBytes: number) {
    const range = `0,${maxBytes}`;
    const [url] = await (await this.file(key)).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + SIGNED_URL_MINUTES * 60_000,
      contentType,
      extensionHeaders: { "x-goog-content-length-range": range },
    });
    return { url, method: "PUT" as const, headers: { "content-type": contentType, "x-goog-content-length-range": range } };
  }

  async createDownloadUrl(key: string, filename: string, contentType: string) {
    const [url] = await (await this.file(key)).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_MINUTES * 60_000,
      responseDisposition: disposition(filename),
      responseType: contentType,
    });
    return url;
  }

  async stat(key: string) {
    const file = await this.file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [meta] = await file.getMetadata();
    return { size: Number(meta.size ?? 0), contentType: meta.contentType ?? null };
  }
}

// Development and tests. Same shape as production — the browser still
// gets a time-limited signed URL — but the signature is an HMAC checked
// by /api/local-storage, and bytes land on local disk. Never used in
// production (buildServer refuses to start without a bucket there).
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  constructor(
    private readonly dir: string,
    private readonly secret: string,
  ) {}

  private sign(parts: string[]) {
    return crypto.createHmac("sha256", this.secret).update(parts.join("\n")).digest("base64url");
  }

  verify(parts: string[], signature: string, expires: number) {
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    const expected = Buffer.from(this.sign(parts));
    const given = Buffer.from(signature);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  filePath(key: string) {
    // Keys are uuids this server minted; still, never allow traversal.
    if (!/^documents\/[0-9a-f-]{36}$/.test(key)) return null;
    return path.join(this.dir, key);
  }

  async createUploadUrl(key: string, contentType: string, maxBytes: number) {
    const expires = Date.now() + SIGNED_URL_MINUTES * 60_000;
    const sig = this.sign(["write", key, String(expires), contentType, String(maxBytes)]);
    const query = new URLSearchParams({ expires: String(expires), max: String(maxBytes), sig });
    return { url: `/api/local-storage/${key}?${query}`, method: "PUT" as const, headers: { "content-type": contentType } };
  }

  async createDownloadUrl(key: string, filename: string, contentType: string) {
    const expires = Date.now() + SIGNED_URL_MINUTES * 60_000;
    const sig = this.sign(["read", key, String(expires), filename, contentType]);
    const query = new URLSearchParams({ expires: String(expires), name: filename, type: contentType, sig });
    return `/api/local-storage/${key}?${query}`;
  }

  async stat(key: string) {
    const file = this.filePath(key);
    if (!file) return null;
    try {
      const info = await fs.promises.stat(file);
      const type = await fs.promises.readFile(`${file}.type`, "utf8").catch(() => null);
      return { size: info.size, contentType: type };
    } catch {
      return null;
    }
  }
}

export function createStorageProvider(): StorageProvider {
  const bucket = process.env.DOCUMENTS_BUCKET;
  if (bucket) return new GcsStorageProvider(bucket);
  if (process.env.NODE_ENV === "production") {
    // Falling back to local disk on Cloud Run would put client documents
    // on an instance's ephemeral filesystem, gone on the next restart.
    throw new Error("DOCUMENTS_BUCKET must be set in production");
  }
  const dir = process.env.LOCAL_STORAGE_DIR || path.join(os.tmpdir(), "nmbm-documents");
  return new LocalStorageProvider(dir, process.env.SESSION_SECRET || "dev-only-change-me-32-characters+");
}

// The routes the local provider signs URLs for. Encapsulated, so the
// catch-all body parser applies to these two routes only — registered on
// the root it would let every API route accept any body, including the
// cross-site form posts the rest of the API refuses.
export async function registerLocalStorageRoutes(fastify: FastifyInstance, provider: LocalStorageProvider) {
  await fastify.register(async (scope) => {
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 20 * 1024 * 1024 }, (_req, body, done) =>
      done(null, body),
    );

    scope.put<{ Params: { "*": string }; Querystring: { expires?: string; max?: string; sig?: string } }>(
      "/api/local-storage/*",
      async (request, reply) => {
        const key = request.params["*"];
        const file = provider.filePath(key);
        const contentType = String(request.headers["content-type"] ?? "");
        const max = Number(request.query.max);
        const signed = provider.verify(
          ["write", key, String(request.query.expires), contentType, String(request.query.max)],
          request.query.sig ?? "",
          Number(request.query.expires),
        );
        if (!file || !signed) return reply.code(403).send({ error: "bad_signature", message: "Invalid or expired upload link" });
        const body = request.body as Buffer;
        if (!Buffer.isBuffer(body) || body.length > max) {
          return reply.code(413).send({ error: "too_large", message: "File is larger than allowed" });
        }
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, body);
        await fs.promises.writeFile(`${file}.type`, contentType);
        return { ok: true };
      },
    );

    scope.get<{ Params: { "*": string }; Querystring: { expires?: string; name?: string; type?: string; sig?: string } }>(
      "/api/local-storage/*",
      async (request, reply) => {
        const key = request.params["*"];
        const file = provider.filePath(key);
        const { name = "", type = "" } = request.query;
        const signed = provider.verify(
          ["read", key, String(request.query.expires), name, type],
          request.query.sig ?? "",
          Number(request.query.expires),
        );
        if (!file || !signed) return reply.code(403).send({ error: "bad_signature", message: "Invalid or expired link" });
        if (!fs.existsSync(file)) return reply.code(404).send({ error: "not_found", message: "No such file" });
        return reply
          .header("content-type", type)
          .header("content-disposition", disposition(name))
          .header("cache-control", "private, no-store")
          .send(fs.createReadStream(file));
      },
    );
  });
}
