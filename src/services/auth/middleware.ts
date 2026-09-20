import type { Request, Response, NextFunction } from "express";
import jwtService from "@/services/auth/jwt-service";
import { StatusCode } from "@/services/http/status-code";

export class Middleware {
  constructor(private readonly jwt: typeof jwtService) {}

  // Arrow function como propriedade de instância: preserva o "this" mesmo
  // quando o express chama handle solto, sem precisar de .bind() em todo uso.
  public readonly handle = (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "Não autorizado" });
      return;
    }

    const token = header.slice("Bearer ".length);

    try {
      const { sub } = this.jwt.verifyAccessToken(token);
      req.userId = sub;
      next();
    } catch {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "Não autorizado" });
    }
  };
}

export default new Middleware(jwtService);
