import type { FastifyInstance } from "fastify";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

// A browser names the page a request came from in Origin on every
// cross-site POST, PUT, PATCH and DELETE. The session cookie is
// SameSite=Lax, which already keeps it off those; this refuses them
// outright, so nothing that changes a record can be set off by a page
// on another site — a form that auto-submits to /api/notes/:id/approve,
// say. No Origin is a request from outside a browser, which carries no
// session cookie it didn't get by signing in.
export function registerSameOriginCheck(fastify: FastifyInstance) {
  fastify.addHook("onRequest", async (request, reply) => {
    if (READS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin === undefined) return;
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      // "null" (a sandboxed frame, a file) or garbage: not this site.
    }
    // hostname follows X-Forwarded-Host only when TRUST_PROXY is set,
    // as it is behind Cloud Run. Through URL so a default port written
    // out on one side ("host:443") still matches.
    let expected: string | null = null;
    try {
      expected = new URL(`${request.protocol}://${request.hostname}`).host;
    } catch {
      // A Host header that isn't a host can't match anything.
    }
    if (host === null || host !== expected) {
      return reply.code(403).send({ error: "forbidden", message: "Requests from other sites are refused" });
    }
  });
}
