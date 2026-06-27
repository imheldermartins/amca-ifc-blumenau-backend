import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

class WorkspacesController implements IBaseController<Schema.Workspace> {
  private db: Model<Schema.Workspace> = db.workspaces;

  async all(lookup?: LookupsConfig<Schema.Workspace>) {
    try {
      const workspaces = await this.db.findAll(lookup);

      if (!workspaces) throw new Error("No workspaces found");

      return workspaces;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async get(lookup: LookupValues<Schema.Workspace>) {
    try {
      const workspace = await this.db.find(lookup);

      if (!workspace) throw new Error("Workspace not found");

      return workspace;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async create(data: CreateValues<Schema.Workspace>) {
    try {
      const created = await this.db.create(data);

      if (!created) throw new Error("Failed to create workspace");

      return created;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async update(lookup: LookupValues<Schema.Workspace>, data: UpdateValues<Schema.Workspace>) {
    try {
      const updated = await this.db.update(data, lookup);

      if (!updated) throw new Error("Failed to update workspace");

      const workspace = await this.db.find(lookup);

      return workspace ?? null;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async delete(lookup: LookupValues<Schema.Workspace>) {
    try {
      const deleted = await this.db.delete(lookup);

      if (!deleted) throw new Error("Failed to delete workspace");

      return deleted;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return false;
    }
  }

  // --- Fluxo adicional: page_root do usuário nesta workspace ---

  /**
   * GET-or-create da page_root: a bi-relação (1 page_root por usuário/workspace)
   * é garantida pelo PRÓPRIO id da página -- `pages.id == workspaceId` -- somado
   * ao `owner_id`. Lookup: `WHERE id = :workspaceId AND owner_id = :ownerId`.
   * Se não existir, cria com esse id e título padrão derivado do 1º nome do user.
   *
   * Obs.: como `pages.id` é PK e recebe o id da workspace, há no máximo UMA
   * page_root por workspace; um segundo dono na mesma workspace colide na PK.
   */
  async getOrCreatePageRoot(workspaceId: string, ownerId: string, title?: string | null) {
    try {
      const workspace = await this.db.find({ id: workspaceId } as LookupValues<Schema.Workspace>);
      if (!workspace) throw new Error("Workspace not found");

      const existing = await db.pages.find(
        { id: workspaceId, owner_id: ownerId } as LookupValues<Schema.Page>,
      );
      if (existing) return existing;

      const user = await db.users.find({ id: ownerId } as LookupValues<Schema.User>);
      const firstName = user?.name?.trim().split(/\s+/)[0];
      const rootTitle = title ?? (firstName ? `${firstName} base de dados` : "Base de dados");

      const created = await db.pages.create({
        id: workspaceId,
        title: rootTitle,
        owner_id: ownerId,
        data: {},
      } as unknown as CreateValues<Schema.Page>);
      if (!created) throw new Error("Failed to create page root");

      return created;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new WorkspacesController();
