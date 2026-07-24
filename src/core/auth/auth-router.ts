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

// O limite agressivo (anti-brute-force de SENHA) fica SÓ em login/register —
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

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Cria uma conta, devolve o access token e grava o refresh em cookie
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               name:
 *                 type: string
 *                 nullable: true
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       201:
 *         description: Conta criada. O refresh token vai no cookie HttpOnly, não no corpo.
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
 *         description: email e password são obrigatórios (password >= 6)
 *       409:
 *         description: email já cadastrado
 */
router.post("/register", authRateLimit, async (req: Request, res: Response) => {
  const { name, email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "email e senha são obrigatórios" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "a senha deve ter no mínimo 6 caracteres" });
  }

  const result = await authController.register({ name, email, password });

  if (!result.ok) {
    if (result.reason === "email_taken") {
      return res.status(StatusCode.CONFLICT).json({ message: "email já cadastrado" });
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
  }

  const { accessToken } = issueSession(res, result.tokens);
  return res.status(StatusCode.CREATED).json({ user: result.user, accessToken });
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
