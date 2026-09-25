import type { Request, Response } from "express";
import inviteController from "@controllers/invite-controller";
import { ApplicationRouter } from "@/routes/application-router";
import middleware from "@/services/auth/middleware";
import { StatusCode } from "@/services/http/status-code";

export class InviteRouter extends ApplicationRouter {
  public constructor() {
    super();
  }

  protected registerRoutes(): void {
    this.router.get("/:token", this.preview.bind(this));
    this.router.post("/:token/accept", middleware.handle, this.accept.bind(this));
  }

  private async preview(req: Request, res: Response): Promise<Response> {
    res.set("Cache-Control", "no-repository");
    return res.status(StatusCode.OK).json(await inviteController.preview(req.params.token));
  }

  private async accept(req: Request, res: Response): Promise<Response> {
    const accepted = await inviteController.accept(req.params.token, req.userId as string);
    return accepted
      ? res.status(StatusCode.OK).json({ accepted: true })
      : res.status(StatusCode.CONFLICT).json({ message: "O convite não pode mais ser aceito." });
  }
}

export default new InviteRouter().build();
