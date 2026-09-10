import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new AppError(400, "bad_request", message);
export const forbidden = (message: string) => new AppError(403, "forbidden", message);
export const notFound = (message: string) => new AppError(404, "not_found", message);
export const conflict = (message: string) => new AppError(409, "conflict", message);
// A rule the caller violated rather than a malformed request — the
// no-contact disenrollment gate is the main one (M6).
export const unprocessable = (message: string) => new AppError(422, "unprocessable", message);

// Without this every thrown AppError surfaces as a 500 and the message
// never reaches the caller.
export function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "bad_request", issues: error.issues });
    }
    request.log.error(error);
    return reply.code(error.statusCode ?? 500).send({ error: "internal_error" });
  });
}
