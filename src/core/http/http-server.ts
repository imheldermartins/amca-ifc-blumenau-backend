import express, { type Express, type Router, type RequestHandler } from "express";
import { corsConfig } from "@core/http/cors.config";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "@core/http/swagger.config";
import { globalRateLimit } from "@core/http/rate-limit.config";
import socketServer from "@core/socket/socket-server";

export interface ServerRoute {
  path: string;
  router: Router;
}

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
  private readonly routes: ServerRoute[];

  public constructor(routes: ServerRoute[], port: number = Number(process.env.PORT) || 3000) {
    this.app = express();
    this.port = port;
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

    this.app.use(globalRateLimit);
    this.app.use(cors(corsConfig));
    this.app.use(express.json());
    this.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }

  public use(...middlewares: RequestHandler[]): this {
    this.app.use(...middlewares);
    return this;
  }

  private mountRoutes(): void {
    for (const { path, router } of this.routes) {
      this.app.use(path, router);
    }
  }

  public start(): void {
    this.mountRoutes();

    const server = this.app.listen(this.port, () => {
      console.log(`Server running on http://localhost:${this.port}`);
    });

    // Socket.io pega carona no mesmo http.Server/porta do express.
    socketServer.attach(server);
  }
}