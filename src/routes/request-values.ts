import type { Request } from "express";

/** Extração tipada de valores que já passaram pelos middlewares da rota. */
export function authenticatedUserId(request: Request): NonEmptyString {
  if (typeof request.userId !== "string" || request.userId.length === 0) {
    throw new Error("Authenticated route without userId");
  }
  return request.userId as NonEmptyString;
}

export function routeParam(request: Request, name: string): NonEmptyString {
  const value = request.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing route parameter: ${name}`);
  }
  return value as NonEmptyString;
}
