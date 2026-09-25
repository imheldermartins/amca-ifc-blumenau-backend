import type { Schema } from "@/db/schemas/index";
import type { JsonRecord } from "@/services/types/json.types";
import { sanitizePublicKeyMetadata } from "@/services/public-key";
import {
  isActivePageView,
  isJsonRecord,
  isPageView,
  isUlid,
} from "@/services/pages/views/page-view-parsers";

export class PageViewSnapshot {
  private constructor(public readonly data: JsonRecord) {}

  public static fromPage(page: Pick<Schema.Page, "data">): PageViewSnapshot {
    return new PageViewSnapshot(isJsonRecord(page.data) ? page.data : {});
  }

  public get(viewId: string): unknown {
    return this.data[viewId];
  }

  public active(viewId: string): JsonRecord | undefined {
    const view = this.get(viewId);
    return isActivePageView(view) ? view : undefined;
  }

  public activeEntries(): Array<[string, JsonRecord]> {
    return Object.entries(this.data).filter(
      (entry): entry is [string, JsonRecord] =>
        isUlid(entry[0]) && isActivePageView(entry[1]),
    );
  }

  public keyEntities(exceptId?: string) {
    return Object.entries(this.data)
      .filter(
        (entry): entry is [string, JsonRecord] =>
          entry[0] !== exceptId && isPageView(entry[1]),
      )
      .map(([id, view]) => ({
        id,
        label: typeof view.name === "string" ? view.name : "",
        ...(sanitizePublicKeyMetadata(view.urlKey) && {
          publicKey: sanitizePublicKeyMetadata(view.urlKey),
        }),
      }));
  }

  public nextOrder(): number {
    const views = this.activeEntries();
    const orders = views
      .map(([, view]) => view.order)
      .filter(
        (order): order is number =>
          typeof order === "number" && Number.isInteger(order) && order >= 0,
      );

    return orders.length > 0 ? Math.max(...orders) + 1 : views.length;
  }

  public withOrders(viewIds: readonly string[]): JsonRecord {
    const data = { ...this.data };
    viewIds.forEach((viewId, order) => {
      const view = this.active(viewId);
      if (view) data[viewId] = { ...view, order };
    });
    return data;
  }
}
