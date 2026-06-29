import { Router, type Request, type Response, type RequestHandler } from "express";
import { StatusCode } from "@core/http/status-code";

export type RouteOperation = "all" | "get" | "create" | "update" | "delete";
export type RouteMiddlewares = Partial<Record<RouteOperation, RequestHandler[]>>;

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
 * IMPORTANTE: os middlewares são recebidos via parâmetro de construtor, não
 * como campo de classe na subclasse -- campo de classe da subclasse só é
 * inicializado DEPOIS que o super() retorna, e registerRoutes() já roda
 * dentro do super(). Passando por parâmetro, o valor já está disponível
 * antes das rotas serem registradas.
 */
export abstract class BaseRouter<T> {
  public readonly router: Router;
  protected abstract readonly resourceName: string;

  constructor(
    protected readonly controller: IBaseController<T>,
    private readonly middlewares: RouteMiddlewares = {},
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  protected registerRoutes(): void {
    const ops = this.enabledOperations();

    if (ops.has("all")) this.router.get("/", ...this.middlewaresFor("all"), this.all.bind(this));
    if (ops.has("get")) this.router.get("/:id", ...this.middlewaresFor("get"), this.get.bind(this));
    if (ops.has("create")) this.router.post("/", ...this.middlewaresFor("create"), this.create.bind(this));
    if (ops.has("update")) this.router.put("/:id", ...this.middlewaresFor("update"), this.update.bind(this));
    if (ops.has("delete")) this.router.delete("/:id", ...this.middlewaresFor("delete"), this.delete.bind(this));
  }

  /**
   * Operações HTTP que serão registradas -- por padrão, o CRUD completo.
   * Subclasses sobrescrevem para desabilitar operações (ex: omitir "create").
   * IMPORTANTE: sobrescreva como MÉTODO, não como arrow field -- registerRoutes()
   * roda dentro do super(), e só métodos (no prototype) já existem nesse momento.
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