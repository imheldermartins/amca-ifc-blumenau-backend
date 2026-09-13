import { Router, type Request, type Response } from "express";
import authController from "@/controllers/auth-controller";
import middleware from "@core/auth/middleware";
import { StatusCode } from "@core/http/status-code";
import { authRateLimit } from "@core/http/rate-limit.config";
import { requireClientHeader } from "@core/http/csrf-guard";
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookieOptions,
  refreshCookieOptions,
} from "@core/auth/cookie.config";
import type { TokenPair } from "@core/auth/jwt-service";
import type { RegisterResult } from "@/controllers/auth-controller";

/**
 * Rotas de autenticação.
 *
 * **O refresh token NÃO trafega no corpo.** Ele sai daqui só como cookie
 * `HttpOnly` (ver cookie.config.ts) e volta só como cookie — o JavaScript da
 * página nunca o vê, então um XSS não consegue exfiltrar a credencial de 7
 * dias. O que o cliente recebe no JSON é o access token (15 min), que ele
 * guarda em MEMÓRIA e perde no reload; recuperá-lo é o papel de
 * `POST /auth/refresh`.
 *
 * Consequência para quem testa via Insomnia/curl: não existe mais
 * `refreshToken` na resposta do login para copiar. Ver docs/INSOMNIA.md.
 */
const router = Router();

// O limite agressivo (anti-brute-force de SENHA) fica só em login e cadastros —
// as rotas que recebem credencial e podem ser marteladas para adivinhá-la.
// Aplicado por-rota (abaixo), não no router todo.
//
// refresh/logout/me NÃO adivinham senha: o refresh é a checagem de sessão que
// o app faz UMA vez no boot (mesmo deslogado, dá 401), o me é leitura
// autenticada, o logout encerra. Colocá-los no limite agressivo fazia o
// próprio app estourar o orçamento (F5, tela de login) e travar o login. Eles
// ficam sob o limite GLOBAL (http-server.ts), que é generoso.

/** Grava o refresh no cookie e devolve só o access para o corpo da resposta. */
function issueSession(res: Response, tokens: TokenPair): { accessToken: string } {
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
  return { accessToken: tokens.accessToken };
}

function sendRegistration(res: Response, result: RegisterResult): Response {
  if (result.ok) {
    return res.status(StatusCode.ACCEPTED).json(result);
  }

  if (result.reason === "email_taken") {
    return res.status(StatusCode.CONFLICT).json({ message: "email já cadastrado" });
  }
  if (result.reason === "invalid_invite") {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "Convite inválido" });
  }
  if (result.reason === "too_soon") {
    return res.status(StatusCode.TOO_MANY_REQUESTS).json({ message: "Aguarde 60 segundos para solicitar outro link" });
  }
  if (result.reason === "validation") {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "Dados de cadastro inválidos" });
  }
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
}

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Cria uma conta pendente e envia o link de validação
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email]
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 120
 *               email:
 *                 type: string
 *     responses:
 *       202:
 *         description: Link de validação solicitado; ainda não há sessão ou workspace
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verificationRequired: { type: boolean }
 *                 email: { type: string }
 *                 notificationPending: { type: boolean }
 *       400:
 *         description: nome e e-mail inválidos
 *       409:
 *         description: email já cadastrado
 */
router.post("/register", authRateLimit, async (req: Request, res: Response) => {
  const { name, email, inviteToken, returnTo } = req.body ?? {};

  if (!name || !email) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "nome e email são obrigatórios" });
  }

  const result = await authController.register({ name, email, inviteToken, returnTo });
  return sendRegistration(res, result);
});

router.post("/verification/resend", authRateLimit, async (req: Request, res: Response) => {
  return sendRegistration(res, await authController.resendVerification(req.body?.email));
});

router.get("/verification/:token", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  return res.status(StatusCode.OK).json(await authController.previewVerification(req.params.token));
});

router.post("/verification/:token/complete", authRateLimit, async (req: Request, res: Response) => {
  const result = await authController.completeVerification(req.params.token, req.body?.password, req.body?.name);
  if (!result.ok) {
    return res.status(result.reason === "failed" ? StatusCode.INTERNAL_SERVER_ERROR : StatusCode.BAD_REQUEST)
      .json({ message: result.reason === "failed" ? "Erro no servidor" : "Link inválido ou expirado" });
  }
  const { accessToken } = issueSession(res, result.tokens);
  return res.status(StatusCode.CREATED).json({
    user: result.user,
    accessToken,
    workspace: result.workspace,
    inviteAccepted: result.inviteAccepted,
  });
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Autentica por email/senha; access token no corpo, refresh em cookie
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Usuário + access token. O refresh vai no cookie HttpOnly.
 *         headers:
 *           Set-Cookie:
 *             description: "Refresh token (HttpOnly; SameSite=Lax; Path=/; Secure em prod)"
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 accessToken:
 *                   type: string
 *       400:
 *         description: email e password são obrigatórios
 *       401:
 *         description: credenciais inválidas
 */
router.post("/login", authRateLimit, async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "email e senha são obrigatórios" });
  }

  const result = await authController.login({ email, password });

  if (!result) {
    return res.status(StatusCode.UNAUTHORIZED).json({ message: "Credenciais inválidas" });
  }

  const { accessToken } = issueSession(res, result.tokens);
  return res.status(StatusCode.OK).json({ user: result.user, accessToken });
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Troca o refresh do COOKIE por um novo access token (e rotaciona o cookie)
 *     description: >
 *       Não recebe corpo. A credencial é o cookie HttpOnly gravado no login.
 *       Exige o header `X-Cubs-Client` — um site terceiro não consegue
 *       defini-lo sem disparar preflight, que o CORS recusa.
 *     tags: [Auth]
 *     parameters:
 *       - in: header
 *         name: X-Cubs-Client
 *         required: true
 *         schema:
 *           type: string
 *         description: Identificador do cliente (ex.- web). Guarda de CSRF.
 *     responses:
 *       200:
 *         description: Novo access token; o cookie de refresh é rotacionado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *       401:
 *         description: cookie de refresh ausente, inválido ou revogado
 *       403:
 *         description: header X-Cubs-Client ausente
 */
router.post("/refresh", requireClientHeader, async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    return res.status(StatusCode.UNAUTHORIZED).json({ message: "Sessão não encontrada" });
  }

  const tokens = await authController.refresh(refreshToken);

  if (!tokens) {
    // Cookie inválido/expirado/revogado: limpa para o navegador parar de
    // reenviar um cookie morto em toda requisição.
    res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
    return res.status(StatusCode.UNAUTHORIZED).json({ message: "Sessão expirada" });
  }

  const { accessToken } = issueSession(res, tokens);
  return res.status(StatusCode.OK).json({ accessToken });
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Encerra a sessão — limpa o cookie e REVOGA os refresh tokens da conta
 *     description: >
 *       Apagar o cookie não bastaria: uma cópia roubada do refresh continuaria
 *       válida até expirar. Por isso o logout incrementa o `token_version` do
 *       usuário, invalidando todos os refresh já emitidos para a conta.
 *     tags: [Auth]
 *     parameters:
 *       - in: header
 *         name: X-Cubs-Client
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Sessão encerrada (idempotente — sem cookie também responde 204)
 *       403:
 *         description: header X-Cubs-Client ausente
 */
router.post("/logout", requireClientHeader, async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

  if (typeof refreshToken === "string" && refreshToken.length > 0) {
    await authController.revoke(refreshToken);
  }

  res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
  // Idempotente de propósito: deslogar quem já está deslogado não é erro, e
  // 204 evita que o frontend precise tratar caso nenhum.
  return res.status(StatusCode.NO_CONTENT).send();
});

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: O usuário do access token
 *     description: >
 *       É o que sustenta o guard de rota do frontend. Antes o usuário vinha de
 *       `GET /users` pegando o primeiro item da lista; agora quem responde
 *       "você está logado, e é este" é uma rota própria.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Usuário autenticado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: access token ausente ou inválido
 *       404:
 *         description: token válido para um usuário que não existe mais
 */
router.get("/me", middleware.handle, async (req: Request, res: Response) => {
  const user = await authController.me(req.userId as string);

  if (!user) {
    return res.status(StatusCode.NOT_FOUND).json({ message: "Usuário não encontrado" });
  }

  return res.status(StatusCode.OK).json(user);
});

export default router;
