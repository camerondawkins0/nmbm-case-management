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
