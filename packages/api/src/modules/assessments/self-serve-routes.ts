import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "@nmbm/db";
import { saveAnswersSchema, unlockSchema } from "@nmbm/shared";
import * as links from "./links.js";

// The participant's own form (M13). No staff session is involved: the
// link's secret is in the path, and entering the passcode earns a
// cookie scoped to that one path. Every route here is listed in
// PUBLIC_BY_DESIGN, and each checks both itself.
const COOKIE = "nmbm_form";

export default async function selfServeRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const cookiePath = (token: string) => `/api/self-serve/${token}`;
  const access = (request: { cookies: Record<string, string | undefined> }) => request.cookies[COOKIE];

  function setAccess(reply: FastifyReply, token: string, value: string) {
    reply.setCookie(COOKIE, value, {
      path: cookiePath(token),
      httpOnly: true,
      // Strict: nothing on another site can make the browser send it.
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
  }

  fastify.post<{ Params: { token: string } }>("/api/self-serve/:token/unlock", async (request, reply) => {
    const { passcode } = unlockSchema.parse(request.body);
    const value = await links.unlock(db, request.params.token, passcode);
    setAccess(reply, request.params.token, value);
    return { ok: true };
  });

  fastify.get<{ Params: { token: string } }>("/api/self-serve/:token", async (request) =>
    links.participantView(db, request.params.token, access(request)),
  );

  fastify.patch<{ Params: { token: string } }>("/api/self-serve/:token/answers", async (request) => {
    const { answers } = saveAnswersSchema.parse(request.body);
    return links.participantSave(db, request.params.token, access(request), answers);
  });

  fastify.post<{ Params: { token: string } }>("/api/self-serve/:token/submit", async (request, reply) => {
    const result = await links.participantSubmit(db, request.params.token, access(request));
    reply.clearCookie(COOKIE, { path: cookiePath(request.params.token) });
    return result;
  });
}
