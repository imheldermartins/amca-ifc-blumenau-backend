import type { Request, Response } from "express";
import authController from "@/controllers/auth-controller";
import type { RegisterResult } from "@/controllers/types/auth-controller.types";
import { ApplicationRouter } from "@/routes/application-router";
import middleware from "@/services/auth/middleware";
import { authRateLimit } from "@/services/http/rate-limit.config";
import { requireClientHeader } from "@/services/http/csrf-guard";
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookieOptions,
  refreshCookieOptions,
} from "@/services/auth/cookie.config";
import type { TokenPair } from "@/services/auth/types/jwt.types";
import { StatusCode } from "@/services/http/status-code";

export class AuthRouter extends ApplicationRouter {
  public constructor() {
    super();
  }

  protected registerRoutes(): void {
    this.router.post("/register", authRateLimit, this.register.bind(this));
    this.router.post("/verification/resend", authRateLimit, this.resendVerification.bind(this));
    this.router.get("/verification/:token", this.previewVerification.bind(this));
    this.router.post("/verification/:token/complete", authRateLimit, this.completeVerification.bind(this));
    this.router.post("/login", authRateLimit, this.login.bind(this));
    this.router.post("/refresh", requireClientHeader, this.refresh.bind(this));
    this.router.post("/logout", requireClientHeader, this.logout.bind(this));
    this.router.get("/me", middleware.handle, this.me.bind(this));
  }

  private async register(req: Request, res: Response): Promise<Response> {
    const { name, email, inviteToken, returnTo } = req.body ?? {};
    if (!name || !email) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "nome e email são obrigatórios" });
    }
    return this.sendRegistration(res, await authController.register({ name, email, inviteToken, returnTo }));
  }

  private async resendVerification(req: Request, res: Response): Promise<Response> {
    return this.sendRegistration(res, await authController.resendVerification(req.body?.email));
  }

  private async previewVerification(req: Request, res: Response): Promise<Response> {
    res.set("Cache-Control", "no-repository");
    return res.status(StatusCode.OK).json(await authController.previewVerification(req.params.token));
  }

  private async completeVerification(req: Request, res: Response): Promise<Response> {
    const result = await authController.completeVerification(req.params.token, req.body?.password, req.body?.name);
    if (!result.ok) {
      return res.status(result.reason === "failed" ? StatusCode.INTERNAL_SERVER_ERROR : StatusCode.BAD_REQUEST)
        .json({ message: result.reason === "failed" ? "Erro no servidor" : "Link inválido ou expirado" });
    }
    const { accessToken } = this.issueSession(res, result.tokens);
    return res.status(StatusCode.CREATED).json({
      user: result.user,
      accessToken,
      workspace: result.workspace,
      inviteAccepted: result.inviteAccepted,
    });
  }

  private async login(req: Request, res: Response): Promise<Response> {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "email e senha são obrigatórios" });
    }
    const result = await authController.login({ email, password });
    if (!result) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Credenciais inválidas" });
    const { accessToken } = this.issueSession(res, result.tokens);
    return res.status(StatusCode.OK).json({ user: result.user, accessToken });
  }

  private async refresh(req: Request, res: Response): Promise<Response> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Sessão não encontrada" });
    }
    const tokens = await authController.refresh(refreshToken);
    if (!tokens) {
      res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Sessão expirada" });
    }
    return res.status(StatusCode.OK).json(this.issueSession(res, tokens));
  }

  private async logout(req: Request, res: Response): Promise<Response> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (typeof refreshToken === "string" && refreshToken.length > 0) {
      await authController.revoke(refreshToken);
    }
    res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
    return res.status(StatusCode.NO_CONTENT).send();
  }

  private async me(req: Request, res: Response): Promise<Response> {
    const user = await authController.me(req.userId as string);
    return user
      ? res.status(StatusCode.OK).json(user)
      : res.status(StatusCode.NOT_FOUND).json({ message: "Usuário não encontrado" });
  }

  private issueSession(res: Response, tokens: TokenPair): { accessToken: string } {
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
    return { accessToken: tokens.accessToken };
  }

  private sendRegistration(res: Response, result: RegisterResult): Response {
    if (result.ok) return res.status(StatusCode.ACCEPTED).json(result);
    const failures = {
      email_taken: [StatusCode.CONFLICT, "email já cadastrado"],
      invalid_invite: [StatusCode.BAD_REQUEST, "Convite inválido"],
      too_soon: [StatusCode.TOO_MANY_REQUESTS, "Aguarde 60 segundos para solicitar outro link"],
      validation: [StatusCode.BAD_REQUEST, "Dados de cadastro inválidos"],
      failed: [StatusCode.INTERNAL_SERVER_ERROR, "Erro no servidor"],
    } as const;
    const [status, message] = failures[result.reason];
    return res.status(status).json({ message });
  }
}

export default new AuthRouter().build();
