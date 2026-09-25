import type { Input } from "@/db/schemas/inputs";
import pageHierarchyStore, { PageHierarchyStore } from "@/repositories/page-hierarchy-repository";
import { isUlid } from "@/utils/ulid";

/** Regras de entrada e tratamento de falhas para a árvore de páginas. */
export class PageHierarchyController {
  public constructor(private readonly hierarchy: PageHierarchyStore = pageHierarchyStore) {}

  public async getParentId(pageId: string): Promise<string | null> {
    if (!isUlid(pageId)) return null;
    try {
      return await this.hierarchy.getParentId(pageId);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  public async createChild(parentId: string, ownerId: string, input: Input.CreateChildPage) {
    if (!isUlid(parentId) || !isUlid(ownerId)) return null;
    try {
      return await this.hierarchy.createChild(parentId, ownerId, input);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  public async getDataset(parentId: string) {
    if (!isUlid(parentId)) return null;
    try {
      return await this.hierarchy.findDataset(parentId);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  public async getBreadcrumb(pageId: string) {
    if (!isUlid(pageId)) return null;
    try {
      return await this.hierarchy.findBreadcrumb(pageId);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }
}

export default new PageHierarchyController();
