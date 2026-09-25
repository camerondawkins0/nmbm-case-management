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

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>;
  }
}

export async function buildServer(options: { logger?: boolean } = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const fastify = Fastify({ logger: options.logger ?? true });
  const db = createDb(databaseUrl);
  fastify.decorate("db", db);
  fastify.addHook("onClose", async () => closeDb(db));
  registerErrorHandler(fastify);

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
  await fastify.register(adminRoutes, { db });

  return fastify;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8080);
  buildServer()
    .then((fastify) => fastify.listen({ port, host: "0.0.0.0" }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
