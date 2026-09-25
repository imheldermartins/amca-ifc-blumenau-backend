import { ApplicationRouter } from "@/routes/application-router";
import { PageCollaboratorRouter } from "@/routes/page/page-collaborator-router";
import { PageColumnRouter } from "@/routes/page/page-column-router";
import { PageColumnValueRouter } from "@/routes/page/page-column-value-router";
import { PageFilterKeyRouter } from "@/routes/page/page-filter-key-router";
import { PageHierarchyRouter } from "@/routes/page/page-hierarchy-router";
import { PageResourceRouter } from "@/routes/page/page-resource-router";
import { PageViewRouter } from "@/routes/page/page-view-router";

/**
 * Composition root do domínio Page.
 *
 * Cada sub-router conhece uma única capacidade. A ordem mantém as rotas fixas
 * do recurso (como `/shared`) antes do CRUD dinâmico `/:id`.
 */
export class PageRouter extends ApplicationRouter {
  public constructor(
    private readonly resource = new PageResourceRouter(),
    private readonly hierarchy = new PageHierarchyRouter(),
    private readonly collaborators = new PageCollaboratorRouter(),
    private readonly views = new PageViewRouter(),
    private readonly filterKeys = new PageFilterKeyRouter(),
    private readonly columns = new PageColumnRouter(),
    private readonly values = new PageColumnValueRouter(),
  ) {
    super();
  }

  protected registerRoutes(): void {
    this.router.use(this.resource.build());
    this.router.use(this.hierarchy.build());
    this.router.use(this.collaborators.build());
    this.router.use(this.views.build());
    this.router.use(this.filterKeys.build());
    this.router.use(this.columns.build());
    this.router.use(this.values.build());
  }
}

export default new PageRouter().build();
