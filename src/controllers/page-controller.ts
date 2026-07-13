import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";

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

      return createdPage;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async update(lookup: LookupValues<Schema.Page>, data: UpdateValues<Schema.Page>) {
    try {
      const updated = await this.db.update(data, lookup);

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

  async delete(lookup: LookupValues<Schema.Page>) {
    try {
      const deleted = await this.db.delete(lookup);

      if (!deleted) throw new Error("Failed to delete page");

      return deleted;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return false;
    }
  }

  // --- Fluxo adicional: páginas-filhas de uma page_root ---

  /**
   * Adiciona uma página-filha (item/linha) sob a page_root `rootId`:
   * cria a `pages` (owner_id = usuário do token) e o vínculo em `page_edges`.
   */
  async createChild(
    rootId: string,
    ownerId: string,
    body: Input.CreateChildPage,
  ) {
    try {
      const root = await this.db.find({ id: rootId } as LookupValues<Schema.Page>);
      if (!root) throw new Error("Page root not found");

      const created = await this.db.create({
        title: body.title ?? null,
        owner_id: ownerId,
        data: body.data ?? {},
      } as unknown as CreateValues<Schema.Page>);
      if (!created) throw new Error("Failed to create child page");

      const edge = await db.pageEdges.create({
        page_root_id: rootId,
        page_id: created.id,
      } as unknown as CreateValues<Schema.PageEdge>);
      if (!edge) throw new Error("Failed to link child page to root");

      return created;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Lê o dataset de uma page_root (linhas + defs de coluna + valores) com o JOIN
   * de referência do protótipo, via `db.sqlRaw` (exceção sancionada de SQL cru).
   * `page_columns` vem como JSON do SQLite e é parseado antes de retornar.
   */
  async getDataset(rootId: string) {
    try {
      if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(rootId)) throw new Error("Invalid page root id");

      const query =
        `SELECT p.id AS page_id, p.title AS page_title, ` +
        `json_group_object(pc.id, json_object(` +
        `'row_id', pcv.id, 'row_data', pcv.data, ` +
        `'column_name', pc.name, 'column_type', pc.type, 'column_data', pc.data` +
        `)) AS page_columns ` +
        `FROM pages p ` +
        `INNER JOIN page_edges ph ON ph.page_id = p.id ` +
        `LEFT JOIN page_columns_values pcv ON p.id = pcv.page_id ` +
        `LEFT JOIN page_columns pc ON pcv.page_column_id = pc.id ` +
        `WHERE ph.page_root_id = '${rootId}' ` +
        `GROUP BY p.id, p.title`;

      const rows = await db.sqlRaw<{ page_id: string; page_title: string | null; page_columns: string }>(
        query,
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
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageController();
