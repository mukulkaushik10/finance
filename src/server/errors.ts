export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what = "Record") => new AppError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You don't have permission to do this") => new AppError(403, "forbidden", msg);
export const unauthorized = (msg = "Sign in required") => new AppError(401, "unauthorized", msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const conflict = (msg: string) => new AppError(409, "conflict", msg);
