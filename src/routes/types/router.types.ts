import type { RequestHandler } from "express";

export type RouteOperation = "all" | "get" | "create" | "update" | "delete";
export type RouteMiddlewares = Partial<Record<RouteOperation, RequestHandler[]>>;
