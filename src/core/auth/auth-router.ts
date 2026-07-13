import { Router, type Request, type Response } from "express";
import authController from "@/controllers/auth-controller";
import { StatusCode } from "@core/http/status-code";
import { authRateLimit } from "@core/http/rate-limit.config";

const router = Router();

// Limite agressivo por IP em TODO o /auth (login/register/refresh) — freia
// brute-force de senha. O limite global (http-server.ts) continua valendo.
router.use(authRateLimit);

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Cria uma conta e já devolve o par de tokens
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
 *         description: Conta criada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 tokens:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *       400:
 *         description: email e password são obrigatórios (password >= 6)
 *       409:
 *         description: email já cadastrado
 */
router.post("/register", async (req: Request, res: Response) => {
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

  return res.status(StatusCode.CREATED).json({ user: result.user, tokens: result.tokens });
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Autentica por email/senha e devolve o par de tokens
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
 *         description: Par de tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       400:
 *         description: email e password são obrigatórios
 *       401:
 *         description: credenciais inválidas
 */
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "email e senha são obrigatórios" });
  }

  const tokens = await authController.login({ email, password });

  if (!tokens) {
    return res.status(StatusCode.UNAUTHORIZED).json({ message: "Credenciais inválidas" });
  }

  return res.status(StatusCode.OK).json(tokens);
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Troca um refresh token válido por um novo par de tokens
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Novo par de tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       400:
 *         description: refreshToken é obrigatório
 *       401:
 *         description: refreshToken inválido ou expirado
 */
router.post("/refresh", (req: Request, res: Response) => {
  const { refreshToken } = req.body ?? {};

  if (!refreshToken) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "refreshToken é obrigatório" });
  }

  const tokens = authController.refresh(refreshToken);

  if (!tokens) {
    return res.status(StatusCode.UNAUTHORIZED).json({ message: "Refresh token inválido ou expirado" });
  }

  return res.status(StatusCode.OK).json(tokens);
});

export default router;
