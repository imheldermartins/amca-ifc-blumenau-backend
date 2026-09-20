import { Router, type RequestHandler } from "express";

export abstract class ApplicationRouter {
  public readonly router = Router();
  private initialized = false;

  protected constructor(...middlewares: RequestHandler[]) {
    if (middlewares.length > 0) this.router.use(...middlewares);
  }

  public build(): Router {
    if (!this.initialized) {
      this.registerRoutes();
      this.initialized = true;
    }
    return this.router;
  }

  protected abstract registerRoutes(): void;
}
