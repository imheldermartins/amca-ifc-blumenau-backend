import { Router, type Request, type Response } from "express";
import authController from "@/controllers/auth-controller";

const router = Router();

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
    return res.status(400).json({ message: "email and password are required" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ message: "password must be at least 6 characters" });
  }

  const result = await authController.register({ name, email, password });

  if (!result.ok) {
    if (result.reason === "email_taken") {
      return res.status(409).json({ message: "email already registered" });
    }
    return res.status(500).json({ message: "Failed to register user" });
  }

  return res.status(201).json({ user: result.user, tokens: result.tokens });
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
    return res.status(400).json({ message: "email and password are required" });
  }

  const tokens = await authController.login({ email, password });

  if (!tokens) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  return res.status(200).json(tokens);
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
    return res.status(400).json({ message: "refreshToken is required" });
  }

  const tokens = authController.refresh(refreshToken);

  if (!tokens) {
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }

  return res.status(200).json(tokens);
});

export default router;
