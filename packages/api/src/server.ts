import Fastify from "fastify";
import { createDb } from "@nmbm/db";
import authPlugin from "./plugins/auth.js";
import healthRoutes from "./modules/health/routes.js";
import participantRoutes from "./modules/participants/routes.js";
import episodeRoutes from "./modules/episodes/routes.js";

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>;
  }
}

export async function buildServer() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const fastify = Fastify({ logger: true });
  const db = createDb(databaseUrl);
  fastify.decorate("db", db);

  await fastify.register(authPlugin, { db });
  await fastify.register(healthRoutes);
  await fastify.register(participantRoutes, { db });
  await fastify.register(episodeRoutes, { db });

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
