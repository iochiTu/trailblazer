export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
    /** Field problems, sent like Zod validation errors ({ path, message }). */
    public readonly issues?: { path: string; message: string }[],
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = () => new HttpError(403, "forbidden", "You don't have access to this");
export const unauthorized = () => new HttpError(401, "unauthorized", "Sign in required");
export const conflict = (message: string) => new HttpError(409, "conflict", message);
/** A Postgres unique violation (23505), optionally of one constraint; drizzle wraps the driver error. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let e = error as { code?: string; constraint_name?: string; cause?: unknown } | undefined; e; ) {
    if (e.code === "23505") return !constraint || e.constraint_name === constraint;
    e = e.cause as typeof e;
  }
  return false;
}

export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
