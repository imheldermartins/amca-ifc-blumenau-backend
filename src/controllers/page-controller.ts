import db from "@models/index";
import type { Model } from "@/repositories/model";
import type { Schema } from "@/db/schemas/index";
import { SystemRoleFactory } from "@/repositories/system-role-factory";
import { pageActivityTouchStatement, readPageLatestUpdatedAt } from '@/repositories/page-activity';
import { ulid } from "ulid";
import {titleValueProjection} from '@/repositories/page-value-projection';
import {stripPageQueryInternals} from '@/services/pages/views/page-query-serialization';
import {initializePageViewSnapshot, prepareInitialPageViewSnapshot} from '@/repositories/page-view-initial-snapshot';
import {withPageRowOrderLock} from '@/repositories/page-view-row-order';

export class PageController implements IBaseController<Schema.Page> {
  private db: Model<Schema.Page> = db.pages;

  async all(lookup?: LookupsConfig<Schema.Page>) {
    try {
      const pages = await this.db.findAll(lookup);

      if (!pages) throw new Error("No pages found");

      return pages.map(stripPageQueryInternals);
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

      return stripPageQueryInternals(page);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async latestUpdatedAt(pageId: string): Promise<string | null> {
    try {
      return await readPageLatestUpdatedAt(pageId);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async create(data: CreateValues<Schema.Page>) {
    try {
      const pageId = ulid();
      const createdPage = await this.db.createWithId(pageId, {...data,
        ...(data.data !== undefined && {data:initializePageViewSnapshot(data.data) as Schema.Page['data']}),
        ...titleValueProjection(data.title)}, {
        after: [SystemRoleFactory.defaultStatement("page", pageId)],
      });

      if (!createdPage) throw new Error("Failed to create page");

      return stripPageQueryInternals(createdPage);
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
      const update = async () => {
        const snapshot = data.data !== undefined && pageId ? await prepareInitialPageViewSnapshot(pageId,data.data) : null;
        const payload = {...data, ...(snapshot && {data:snapshot.data as Schema.Page['data']}),
          ...(data.title !== undefined && titleValueProjection(data.title))};
        return this.db.updateAndFind(payload, lookup, {
          ...(snapshot && {before:snapshot.before}),
          after:[...(snapshot?.after ?? []),...targets.map(pageActivityTouchStatement)],
        });
      };
      const page = data.data !== undefined && pageId ? await withPageRowOrderLock(pageId,update) : await update();

      if (!page) throw new Error("Failed to update page");
      return stripPageQueryInternals(page);
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

}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageController();
