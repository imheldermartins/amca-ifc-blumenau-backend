import type { Request, Response } from "express";
import userController from "@/controllers/user-controller";
import type { Schema } from "@/db/schemas/index";
import type { Input } from "@/db/schemas/inputs";
import { BaseRouter } from "@routes/base-router";
import type { RouteOperation } from "@/routes/types/router.types";
import middleware from "@/services/auth/middleware";
import ownership from "@/services/auth/ownership";
import { StatusCode } from "@/services/http/status-code";




export class UserRouter extends BaseRouter<Schema.User> {
  protected readonly resourceName = "User";

  constructor() {
    // Todas as operações exigem autenticação; as que operam sobre um /:id
    // exigem também que o recurso seja do próprio usuário (ownership.self).
    super(userController, {
      all: [middleware.handle],
      get: [middleware.handle, ownership.self],
      update: [middleware.handle, ownership.self],
      delete: [middleware.handle, ownership.self],
    });
  }

  // Users é collection de referência para as demais: a criação fica desabilitada
  // aqui -- usuários entram exclusivamente pelo fluxo de POST /auth/register.
  protected override enabledOperations(): Set<RouteOperation> {
    return new Set<RouteOperation>(["all", "get", "update", "delete"]);
  }

  // "all" é escopado ao token: retorna apenas o próprio usuário autenticado,
  // nunca a lista completa de usuários.
  protected override async all(req: Request, res: Response): Promise<Response> {
    const user = await this.controller.get({ id: req.userId } as unknown as LookupValues<Schema.User>);

    return res.status(StatusCode.OK).json(user ? [user] : []);
  }

  // Whitelist do update: só name/email entram pelo body. Bloqueia injeção de
  // campos sensíveis (ex.: password_hash) ou auto-gerenciados via PUT.
  protected override async update(req: Request, res: Response): Promise<Response> {
    const { name, email } = (req.body ?? {}) as Input.UpdateUser;

    const payload = {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
    } as UpdateValues<Schema.User>;

    const item = await this.controller.update(
      { id: req.params.id } as unknown as LookupValues<Schema.User>,
      payload,
    );

    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado ou falha ao atualizar` });
    }

    return res.status(StatusCode.OK).json(item);
  }
}

export default new UserRouter().build();
