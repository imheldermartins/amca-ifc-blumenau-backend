import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

class PageController implements IBaseController<Schema.Page> {
  private db: Model<Schema.Page> = db.pages;

  async all(lookup?: LookupsConfig<Schema.Page>, options?: IncludeOption) {
    try {
      const pages = await this.db.findAll(lookup, options);

      if (!pages) throw new Error("No pages found");

      return pages;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async get(lookup: LookupValues<Schema.Page>, options?: IncludeOption) {
    try {
      const page = await this.db.find(lookup, options);

      if (!page) throw new Error("Page not found");

      return page;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async create(data: CreateValues<Schema.Page>, nested?: NestedWrite) {
    try {
      const createdPage = await this.db.create(data, nested);

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
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageController();
