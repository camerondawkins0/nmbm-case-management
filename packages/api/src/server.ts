import Fastify from "fastify";
import { createDb, closeDb } from "@nmbm/db";
import authPlugin from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/errors.js";
import healthRoutes from "./modules/health/routes.js";
import meRoutes from "./modules/me/routes.js";
import participantRoutes from "./modules/participants/routes.js";
import episodeRoutes from "./modules/episodes/routes.js";
import noteRoutes from "./modules/notes/routes.js";
import carePlanRoutes from "./modules/care-plans/routes.js";
import dashboardRoutes from "./modules/dashboard/routes.js";
import feedbackRoutes from "./modules/feedback/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import consentRoutes from "./modules/consents/routes.js";
import referralRoutes from "./modules/referrals/routes.js";
import programRoutes from "./modules/programs/routes.js";
import followUpRoutes from "./modules/follow-ups/routes.js";
import { registerWebApp, registerSecurityHeaders } from "./plugins/web-app.js";

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>;
  }
}

export async function buildServer(options: { logger?: boolean } = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const fastify = Fastify({
    logger: options.logger ?? true,
    // Cloud Run ends TLS in front of the container and forwards plain
    // HTTP. Without trusting its X-Forwarded-Proto, every request looks
    // insecure and the session cookie (Secure in production) is never
    // set — sign-in would silently fail. Only on when told: trusting
    // those headers anywhere else would let a client forge them.
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  const db = createDb(databaseUrl);
  fastify.decorate("db", db);
  fastify.addHook("onClose", async () => closeDb(db));
  registerErrorHandler(fastify);
  registerSecurityHeaders(fastify, { https: process.env.NODE_ENV === "production" });

  await fastify.register(authPlugin, { db });
  await fastify.register(healthRoutes);
  await fastify.register(meRoutes, { db });
  await fastify.register(participantRoutes, { db });
  await fastify.register(episodeRoutes, { db });
  await fastify.register(noteRoutes, { db });
  await fastify.register(carePlanRoutes, { db });
  await fastify.register(dashboardRoutes, { db });
  await fastify.register(feedbackRoutes, { db });
  await fastify.register(consentRoutes, { db });
  await fastify.register(referralRoutes, { db });
  await fastify.register(programRoutes, { db });
  await fastify.register(followUpRoutes, { db });
  // Last, so every API and sign-in route is matched first.
  await registerWebApp(fastify);
  await fastify.register(adminRoutes, { db });

  return fastify;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8080);
  buildServer()
    .then(async (fastify) => {
      // Cloud Run sends SIGTERM before stopping an instance. Closing lets
      // in-flight requests finish and releases database connections
      // instead of dropping them.
      process.once("SIGTERM", () => {
        fastify.log.info("SIGTERM: shutting down");
        fastify.close().then(() => process.exit(0), () => process.exit(1));
      });
      await fastify.listen({ port, host: "0.0.0.0" });
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
