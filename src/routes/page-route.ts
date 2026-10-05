import { ApplicationRouter } from "@/routes/application-router";
import { PageCollaboratorRouter } from "@/routes/page/page-collaborator-router";
import { PageColumnRouter } from "@/routes/page/page-column-router";
import { PageColumnLockRouter } from '@/routes/page/page-column-lock-router';
import { PageColumnValueRouter } from "@/routes/page/page-column-value-router";
import { PageDocumentRouter } from '@/routes/page/page-document-router';
import { PageFilterKeyRouter } from "@/routes/page/page-filter-key-router";
import { PageFlowRouter } from '@/routes/page/page-flow-router';
import { PageFormRouter } from '@/routes/page/page-form-router';
import { PageHierarchyRouter } from "@/routes/page/page-hierarchy-router";
import { PageResourceRouter } from "@/routes/page/page-resource-router";
import { PageViewRouter } from "@/routes/page/page-view-router";
import { PageViewQueryRouter } from '@/routes/page/page-view-query-router';
import { PageViewRowMoveRouter } from '@/routes/page/page-view-row-move-router';

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
    private readonly flows = new PageFlowRouter(),
    private readonly forms = new PageFormRouter(),
    private readonly columns = new PageColumnRouter(),
    private readonly columnLocks = new PageColumnLockRouter(),
    private readonly values = new PageColumnValueRouter(),
    private readonly documents = new PageDocumentRouter(),
    private readonly viewQueries = new PageViewQueryRouter(),
    private readonly rowMoves = new PageViewRowMoveRouter(),
  ) {
    super();
  }

  protected registerRoutes(): void {
    this.router.use(this.resource.build());
    this.router.use(this.hierarchy.build());
    this.router.use(this.collaborators.build());
    this.router.use(this.views.build());
    this.router.use(this.filterKeys.build());
    this.router.use(this.flows.build());
    this.router.use(this.forms.build());
    this.router.use(this.columns.build());
    this.router.use(this.columnLocks.build());
    this.router.use(this.values.build());
    this.router.use(this.documents.build());
    this.router.use(this.viewQueries.build());
    this.router.use(this.rowMoves.build());
  }
}

export default new PageRouter().build();
