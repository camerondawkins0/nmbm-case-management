import type { FastifyInstance } from "fastify";

// PUBLIC_BY_DESIGN: Cloud Run health check, unauthenticated by necessity.
export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/api/health", async () => ({ status: "ok" }));
}
