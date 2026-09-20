import type { Router } from "express";

export interface ServerRoute {
  path: string;
  router: Router;
}
