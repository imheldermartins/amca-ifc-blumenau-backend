import express, { type Express, type RequestHandler } from "express";
import { corsConfig } from "@/services/http/cors.config";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { globalRateLimit } from "@/services/http/rate-limit.config";
import socketServer from "@/services/realtime/socket-server";
import { API_VERSION } from "@/constants/api-version";
import healthRouter from "@routes/health-route";
import type { ServerRoute } from "@/services/http/types/http-server.types";

/**
 * Camada de comunicação HTTP: monta a instância do express por composição
 * (app, cors, lista de routers) em vez de deixar tudo solto no entrypoint.
 *
 * Middleware: chame .use(...) ANTES de .start(). As rotas só entram na pilha
 * do express dentro de start(), então qualquer middleware adicionado antes
 * (auth, logging, rate-limit, etc.) sempre roda antes dos handlers de rota.
 */
export default class HttpServer {
  private readonly app: Express;
  private readonly port: number;
  private readonly host: string | undefined;
  private readonly routes: ServerRoute[];

  public constructor(routes: ServerRoute[], port: number = Number(process.env.PORT) || 3000) {
    this.app = express();
    this.port = port;
    this.host = process.env.HOST?.trim() || undefined;
    this.routes = routes;

    this.setupGlobalMiddlewares();
  }

  private setupGlobalMiddlewares(): void {
    // Atrás de um reverse proxy (nginx em prod), o IP real do client chega no
    // X-Forwarded-For — sem trust proxy o rate limit contaria tudo como um IP só.
    // Só ligar quando de fato há proxy na frente (TRUST_PROXY=1), senão o header
    // vira vetor de spoofing de IP.
    if (process.env.TRUST_PROXY === "1") {
      this.app.set("trust proxy", 1);
    }

    // helmet: cabeçalhos de defesa em profundidade (HSTS, nosniff, frameguard,
    // sem x-powered-by). A CSP fica DESLIGADA aqui de propósito — este servidor
    // só devolve JSON, e uma CSP em resposta de API não protege nada. Quem
    // precisa dela é o SPA, e ela mora no nginx que serve o build.
    this.app.use(helmet({ contentSecurityPolicy: false }));

    // Healthchecks ficam fora de /api e do rate limit. /live confirma o
    // processo; /ready também confirma que este backend alcança um rqlite
    // pronto para atender leituras e escritas.
    this.app.use("/health", healthRouter);

    this.app.use(globalRateLimit);
    this.app.use(cors(corsConfig));

    // Limite EXPLÍCITO de corpo. O default do express também é 100kb, mas
    // implícito: deixar escrito é o que impede alguém de aumentar sem pensar.
    // O maior payload legítimo é o snapshot das views (`pages.data`), que
    // cresce com colunas × views — 256kb dá folga larga sem virar vetor de
    // memória.
    this.app.use(express.json({ limit: "256kb" }));

    // Necessário para ler o cookie de sessão (o refresh) em /auth/refresh e
    // /auth/logout — sem isto, req.cookies é undefined.
    this.app.use(cookieParser());

  }

  public use(...middlewares: RequestHandler[]): this {
    this.app.use(...middlewares);
    return this;
  }

  /**
   * `/api` é parte estrutural do transporte; apenas a versão é uma constante
   * de sistema. Os routers continuam declarando caminhos de recurso relativos.
   */
  private mountRoutes(): void {
    for (const { path, router } of this.routes) {
      this.app.use(`/api/${API_VERSION}${path}`, router);
    }
  }

  public start(): void {
    this.mountRoutes();

    const onListening = () => {
      const advertisedHost = this.host ?? "localhost";
      console.log(`Server running on http://${advertisedHost}:${this.port}`);
    };
    const server = this.host
      ? this.app.listen(this.port, this.host, onListening)
      : this.app.listen(this.port, onListening);

    // Socket.io pega carona no mesmo http.Server/porta do express.
    socketServer.attach(server);
  }
}
