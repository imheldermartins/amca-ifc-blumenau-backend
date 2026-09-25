import accessStore from "@/repositories/scoped-access-repository";
import pageAccessStore from "@/repositories/page-access-repository";
import type { PageAccessStore } from "@/repositories/page-access-repository";
import type { SharedPage } from "@/controllers/types/page-access-controller.types";
import type { PermissionKind } from "@/services/auth/permissions";
export type { SharedPage } from "@/controllers/types/page-access-controller.types";

// ULID (26 chars, alfabeto Crockford) -- mesmo guarda dos demais controllers.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** Consultas de acesso delegadas à política de roles e herança por escopo. */
export class PageAccessController {
  public constructor(private readonly sharedPages: PageAccessStore = pageAccessStore) {}

  /** Falhas de consulta negam o acesso; ownership e roles são resolvidos no banco. */
  async canAccessPage(userId: string, pageId: string): Promise<boolean> {
    return this.canPageAction(userId, pageId, "read", "view");
  }

  public async canReadSubpages(userId: string, pageId: string): Promise<boolean> {
    return this.canPageAction(userId, pageId, "read", "subpages");
  }

  public async canUpdatePage(userId: string, pageId: string): Promise<boolean> {
    return this.canPageAction(userId, pageId, "write", "update");
  }

  private async canPageAction(
    userId: string,
    pageId: string,
    kind: PermissionKind,
    action: string,
  ): Promise<boolean> {
    if (!ULID_RE.test(userId) || !ULID_RE.test(pageId)) return false;

    try {
      return await accessStore.can("page", pageId, userId, kind, action);
    } catch (error) {
      // Falha de infra NUNCA vira permissão: nega e deixa o log contar por quê.
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return false;
    }
  }

  /**
   * Páginas que o usuário acessa como COLABORADOR (e não como dono) — a aba
   * "Colaborando" do frontend. Traz o dono junto porque o card mostra de quem
   * é a página; `password_hash` fica de fora por construção (SELECT explícito).
   */
  async listSharedPages(userId: string): Promise<SharedPage[] | null> {
    if (!ULID_RE.test(userId)) return [];

    try {
      const rows = await this.sharedPages.listDirectSharesForUser(userId);
      const visibility = await Promise.all(
        rows.map((row) => this.canAccessPage(userId, row.id)),
      );
      return rows.filter((_, index) => visibility[index]);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }
}

export default new PageAccessController();
