/**
 * HTTP status codes used across the server.
 *
 * Declared as an `as const` object (not an `enum`) so it provides both a
 * runtime value — usable directly in `res.status(...)` — and a literal type
 * for annotating helpers, without emitting an enum's extra runtime shape.
 */
export const StatusCode = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type StatusCode = (typeof StatusCode)[keyof typeof StatusCode];
