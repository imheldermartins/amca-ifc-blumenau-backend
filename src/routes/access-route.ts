import { ApplicationRouter } from "@/routes/application-router";
import { AccessInviteRoutes } from "@/routes/access/access-invite-routes";
import { AccessMemberRoutes } from "@/routes/access/access-member-routes";
import { AccessOverviewRoutes } from "@/routes/access/access-overview-routes";
import { AccessRequestRoutes } from "@/routes/access/access-request-routes";
import { AccessRoleRoutes } from "@/routes/access/access-role-routes";
import { AccessScopeGuard } from "@/routes/access/access-scope-guard";
import middleware from "@/services/auth/middleware";

export class AccessRouter extends ApplicationRouter {
  private readonly overviewRoutes = new AccessOverviewRoutes();
  private readonly roleRoutes = new AccessRoleRoutes();
  private readonly memberRoutes = new AccessMemberRoutes();
  private readonly inviteRoutes = new AccessInviteRoutes();
  private readonly requestRoutes = new AccessRequestRoutes();
  private readonly scopeGuard = new AccessScopeGuard();

  public constructor() {
    super(middleware.handle);
  }

  protected registerRoutes(): void {
    this.overviewRoutes.registerCatalog(this.router);
    this.router.use("/:scope/:id", this.scopeGuard.handle);
    this.overviewRoutes.registerCurrentAccess(this.router);
    this.roleRoutes.register(this.router);
    this.memberRoutes.register(this.router);
    this.inviteRoutes.register(this.router);
    this.requestRoutes.register(this.router);
  }
}

export default new AccessRouter().build();
