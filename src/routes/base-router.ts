import type { Request, Response, RequestHandler } from "express";
import { StatusCode } from "@/services/http/status-code";
import type { RouteMiddlewares, RouteOperation } from "@/routes/types/router.types";
import { ApplicationRouter } from "@/routes/application-router";

/**
 * Abstrai o mapeamento HTTP <-> IBaseController<T> que se repetia em cada
 * arquivo de rota. Uma resource router concreta só precisa:
 *   1. dizer qual controller usar (via super(controller, middlewares) no construtor)
 *   2. dizer o nome do recurso (pras mensagens de erro)
 *   3. opcionalmente passar middlewares por operação (ex: proteger create/update/delete)
 *   4. opcionalmente sobrescrever um dos 5 métodos pra regra específica
 *      (ex: validação de campo), chamando super.<metodo>() pra reaproveitar
 *      o resto do fluxo.
 *
 * `ApplicationRouter.build()` materializa as rotas uma única vez, depois que
 * a instância concreta terminou de ser construída.
 */
export abstract class BaseRouter<T> extends ApplicationRouter {
  protected abstract readonly resourceName: string;

  constructor(
    protected readonly controller: IBaseController<T>,
    private readonly middlewares: RouteMiddlewares = {},
  ) {
    super();
  }

  protected override registerRoutes(): void {
    // ANTES do CRUD, sempre: o express casa na ORDEM de registro, e "/:id"
    // engole qualquer caminho fixo irmão registrado depois ("/pages/shared"
    // viraria id="shared"). Registrar aqui é o que garante a precedência.
    this.staticRoutes();

    const ops = this.enabledOperations();

    if (ops.has("all")) this.router.get("/", ...this.middlewaresFor("all"), this.all.bind(this));
    if (ops.has("get")) this.router.get("/:id", ...this.middlewaresFor("get"), this.get.bind(this));
    if (ops.has("create")) this.router.post("/", ...this.middlewaresFor("create"), this.create.bind(this));
    if (ops.has("update")) this.router.put("/:id", ...this.middlewaresFor("update"), this.update.bind(this));
    if (ops.has("delete")) this.router.delete("/:id", ...this.middlewaresFor("delete"), this.delete.bind(this));
  }

  /**
   * Rotas de CAMINHO FIXO que precisam vencer o "/:id" do CRUD (ex.:
   * `GET /pages/shared`). Registradas antes de tudo por `registerRoutes()`.
   *
   * Sobrescreva como método para manter o ciclo de construção uniforme.
   */
  protected staticRoutes(): void {}

  /**
   * Operações HTTP que serão registradas -- por padrão, o CRUD completo.
   * Subclasses sobrescrevem para desabilitar operações (ex: omitir "create").
   * Sobrescreva como método para manter o ciclo de construção uniforme.
   */
  protected enabledOperations(): Set<RouteOperation> {
    return new Set<RouteOperation>(["all", "get", "create", "update", "delete"]);
  }

  private middlewaresFor(operation: RouteOperation): RequestHandler[] {
    return this.middlewares[operation] ?? [];
  }

  protected async all(_req: Request, res: Response): Promise<Response> {
    const items = await this.controller.all();

    if (!items) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `Nenhum registro de "${this.resourceName}" encontrado` });
    }

    return res.status(StatusCode.OK).json(items);
  }

  protected async get(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;

    const item = await this.controller.get({ id } as unknown as LookupValues<T>);

    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    return res.status(StatusCode.OK).json(item);
  }

  protected async create(req: Request, res: Response): Promise<Response> {
    const data = (req.body ?? {}) as CreateValues<T>;

    const item = await this.controller.create(data);

    if (!item) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }

    return res.status(StatusCode.CREATED).json(item);
  }

  protected async update(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const data = (req.body ?? {}) as UpdateValues<T>;

    const item = await this.controller.update({ id } as unknown as LookupValues<T>, data);

    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado ou falha ao atualizar` });
    }

    return res.status(StatusCode.OK).json(item);
  }

  protected async delete(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;

    const deleted = await this.controller.delete({ id } as unknown as LookupValues<T>);

    if (!deleted) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    return res.status(StatusCode.NO_CONTENT).send();
  }
}
