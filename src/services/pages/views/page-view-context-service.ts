import db from "@models/index";
import type { Schema } from "@/db/schemas/index";
import type { PageViewContext } from "@/services/pages/views/types/page-view.types";
import { PageViewSnapshot } from "@/services/pages/views/page-view-snapshot";
import { isUlid } from "@/services/pages/views/page-view-parsers";

export class PageViewContextService {
  public async load(pageId: string): Promise<PageViewContext | null> {
    if (!isUlid(pageId)) return null;

    const page = await db.pages.find({ id: pageId } as LookupValues<Schema.Page>);
    if (!page) return null;
    const columns =
      (await db.pageColumns.findAll({
        parent_id: pageId,
      } as LookupsConfig<Schema.PageColumn>)) ?? [];

    return { page, columns, snapshot: PageViewSnapshot.fromPage(page) };
  }

  public async reloadSnapshot(pageId: string): Promise<PageViewSnapshot | null> {
    const page = await db.pages.find({ id: pageId } as LookupValues<Schema.Page>);
    return page ? PageViewSnapshot.fromPage(page) : null;
  }

  public async reloadColumns(pageId: string): Promise<Schema.PageColumn[]> {
    return (
      (await db.pageColumns.findAll({
        parent_id: pageId,
      } as LookupsConfig<Schema.PageColumn>)) ?? []
    );
  }
}
