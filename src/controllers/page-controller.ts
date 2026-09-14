import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { SystemRoleFactory } from "@db/system-role-factory";
import { pageActivityTouchStatement } from '@db/page-activity';
import { pageChildEdgeStatement } from '@db/page-child-creation';
import { ulid } from 'ulid';

class PageController implements IBaseController<Schema.Page> {
  private db: Model<Schema.Page> = db.pages;

  async all(lookup?: LookupsConfig<Schema.Page>) {
    try {
      const pages = await this.db.findAll(lookup);

      if (!pages) throw new Error("No pages found");

      return pages;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async get(lookup: LookupValues<Schema.Page>) {
    try {
      const page = await this.db.find(lookup);

      if (!page) throw new Error("Page not found");

      return page;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async create(data: CreateValues<Schema.Page>) {
    try {
      const createdPage = await this.db.create(data);

      if (!createdPage) throw new Error("Failed to create page");
      if (!await SystemRoleFactory.ensureDefault('page', createdPage.id)) {
        throw new Error("Failed to create default page role");
      }

      return createdPage;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async update(
    lookup: LookupValues<Schema.Page>,
    data: UpdateValues<Schema.Page>,
    databasePageIds: readonly string[] = [],
  ) {
    try {
      const pageId = typeof lookup.id === "string" ? lookup.id : null;
      const targets = [...new Set([...(pageId ? [pageId] : []), ...databasePageIds])];
      const updated = await this.db.update(data, lookup, {
        after: targets.map(pageActivityTouchStatement),
      });

      if (!updated) throw new Error("Failed to update page");

      const page = await this.db.find(lookup);

      return page ?? null;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async delete(lookup: LookupValues<Schema.Page>, databasePageIds: readonly string[] = []) {
    try {
      const deleted = await this.db.delete(lookup, {
        after: [...new Set(databasePageIds)].map(pageActivityTouchStatement),
      });

      if (!deleted) throw new Error("Failed to delete page");

      return deleted;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return false;
    }
  }

  // --- Fluxo adicional: páginas-filhas de uma página parent ---

  /**
   * Adiciona uma página-filha (item/linha) sob a página pai `parentId`:
   * cria a `pages` (owner_id = usuário do token) e a aresta em `page_edges`
   * (parent_id = pai, child_id = filha).
   */
  async createChild(
    parentId: string,
    ownerId: string,
    body: Input.CreateChildPage,
  ) {
    try {
      const parent = await this.db.find({ id: parentId } as LookupValues<Schema.Page>);
      if (!parent) throw new Error("Parent page not found");

      const childId = ulid();
      const created = await this.db.create({
        id: childId,
        title: body.title ?? null,
        owner_id: ownerId,
        data: body.data ?? {},
      } as unknown as CreateValues<Schema.Page>, {
        after: [
          SystemRoleFactory.defaultStatement('page', childId),
          pageChildEdgeStatement(parentId, childId),
          pageActivityTouchStatement(parentId),
        ],
      });
      if (!created) throw new Error("Failed to create child page");

      return created;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Lê o dataset de uma página parent (linhas + defs de coluna + valores) com o
   * JOIN de referência do protótipo, via `db.sqlRaw` (exceção sancionada de SQL
   * cru). `page_columns` vem como JSON do SQLite e é parseado antes de retornar.
   */
  async getDataset(parentId: string) {
    try {
      if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(parentId)) throw new Error("Invalid parent page id");

      const text =
        `SELECT p.id AS page_id, p.title AS page_title, ` +
        `json_group_object(pc.id, json_object(` +
        `'row_id', pcv.id, 'row_data', pcv.data, ` +
        `'column_name', pc.name, 'column_type', pc.type, 'column_data', pc.data` +
        `)) AS page_columns ` +
        `FROM pages p ` +
        `INNER JOIN page_edges ph ON ph.child_id = p.id ` +
        `LEFT JOIN page_columns_values pcv ON p.id = pcv.page_id ` +
        `AND EXISTS (` +
        `SELECT 1 FROM page_columns active_pc ` +
        `WHERE active_pc.id = pcv.page_column_id AND active_pc.deleted_at IS NULL` +
        `) ` +
        `LEFT JOIN page_columns pc ON pcv.page_column_id = pc.id AND pc.deleted_at IS NULL ` +
        `WHERE ph.parent_id = ? AND p.deleted_at IS NULL ` +
        `GROUP BY p.id, p.title`;

      const rows = await db.sqlRaw<{ page_id: string; page_title: string | null; page_columns: string }>(
        { text, values: [parentId] },
        "query",
      );

      return rows.map((row) => ({
        ...row,
        page_columns: row.page_columns ? JSON.parse(row.page_columns) : {},
      }));
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Breadcrumb (trilha de ancestrais) de uma página: sobe a hierarquia de
   * `page_edges` a partir de `targetPageId`, do topo até a própria página.
   * CTE recursivo via `db.sqlRaw` PARAMETRIZADO (`?` -> bind), então o id da
   * URL nunca é concatenado no SQL. Ordena por profundidade decrescente: o
   * ancestral mais alto vem primeiro, a página-alvo por último.
   */
  async getBreadcrumb(targetPageId: string) {
    try {
      if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(targetPageId)) throw new Error("Invalid target page id");

      const text =
        `WITH RECURSIVE ancestors(id, parent_id, depth) AS (` +
        `SELECT pe.child_id, pe.parent_id, 0 ` +
        `FROM page_edges pe ` +
        `JOIN pages child ON child.id = pe.child_id AND child.deleted_at IS NULL ` +
        `JOIN pages parent ON parent.id = pe.parent_id AND parent.deleted_at IS NULL ` +
        `WHERE pe.child_id = ? ` +
        `UNION ALL ` +
        `SELECT pe.child_id, pe.parent_id, a.depth + 1 ` +
        `FROM page_edges pe ` +
        `JOIN ancestors a ON pe.child_id = a.parent_id ` +
        `JOIN pages parent ON parent.id = pe.parent_id AND parent.deleted_at IS NULL` +
        `) SELECT * FROM ancestors ORDER BY depth DESC`;

      const crumbs = await db.sqlRaw<{
        id: string;
        parent_id: string;
        depth: number;
      }>({ text, values: [targetPageId] }, "query");

      return crumbs;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageController();
