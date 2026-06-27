import type { Request, Response } from "express";
import userController from "@/controllers/user-controller";
import type { Schema } from "@/models/schemas/index";
import { BaseRouter, type RouteOperation } from "@routes/base-router";
import middleware from "@/core/auth/middleware";
import ownership from "@/core/auth/ownership";
import { StatusCode } from "@core/http/status-code";

/**
 * @openapi
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *           nullable: true
 *         email:
 *           type: string
 *       required:
 *         - email
 */

/**
 * @openapi
 * /users:
 *   get:
 *     summary: Retorna o usuário autenticado (escopo do token)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista contendo apenas o próprio usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       401:
 *         description: Token de acesso ausente ou inválido
 *
 * # POST /users desabilitado: usuários entram pelo fluxo de POST /auth/register.
 *
 * /users/{id}:
 *   get:
 *     summary: Busca o próprio usuário por id
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usuário encontrado
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       403:
 *         description: Você só pode acessar seus próprios recursos
 *       404:
 *         description: Usuário não encontrado
 *   put:
 *     summary: Atualiza o próprio usuário
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Usuário atualizado
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       403:
 *         description: Você só pode alterar seus próprios recursos
 *       404:
 *         description: Usuário não encontrado ou falha ao atualizar
 *   delete:
 *     summary: Remove o próprio usuário
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Usuário removido
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       403:
 *         description: Você só pode remover seus próprios recursos
 *       404:
 *         description: Usuário não encontrado
 */
class UserRouter extends BaseRouter<Schema.User> {
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
}

export default new UserRouter().router;
