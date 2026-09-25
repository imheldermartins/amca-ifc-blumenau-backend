import type { Request, Response } from "express";
import { ApplicationRouter } from "@routes/application-router";
import {db} from '@/db/client-db';

export class HealthRouter extends ApplicationRouter {
  public constructor(private readonly databaseHealth: Pick<typeof db, 'isReady'> = db) {
    super();
  }

  protected registerRoutes(): void {
    this.router.get("/live", this.live.bind(this));
    this.router.get("/ready", this.ready.bind(this));
  }

  private live(_request: Request, response: Response): Response {
    return response.status(200).json({ status: "ok" });
  }

  private async ready(_request: Request, response: Response): Promise<Response> {
    const databaseReady = await this.databaseHealth.isReady();
    return response.status(databaseReady ? 200 : 503).json({
      status: databaseReady ? "ok" : "unavailable",
      checks: { database: databaseReady ? "ready" : "unavailable" },
    });
  }
}

export default new HealthRouter().build();
