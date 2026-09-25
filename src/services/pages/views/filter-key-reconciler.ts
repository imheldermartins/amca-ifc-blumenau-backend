import type { Schema } from "@/db/schemas/index";
import type {
  FilterKeyCatalog,
  FilterKeyReconcilePlan,
} from "@/services/pages/views/types/page-view.types";
import { PageViewSnapshot } from "@/services/pages/views/page-view-snapshot";
import {
  isJsonRecord,
  isSupportedTitleMask,
  toColumnKeyEntities,
  toFilterColumnDefinitions,
  valuesEqual,
} from "@/services/pages/views/page-view-parsers";
import {
  collectReservedPublicKeys,
  reconcilePublicKeyMetadata,
  reconcilePublicKeyScope,
  sanitizePublicKeyMetadata,
} from "@/services/public-key";
import {
  collectPageColumnReservations,
  sanitizeReservedOptionKeys,
} from "@/services/filter-key-registry";
import {
  filterDocumentsEqual,
  reconcileViewFilters,
} from "@/services/view-filters-v2";

export class FilterKeyReconciler {
  public plan(
    snapshot: PageViewSnapshot,
    columns: readonly Schema.PageColumn[],
  ): FilterKeyReconcilePlan {
    const views = snapshot.activeEntries();
    const activeViewIds = new Set(views.map(([viewId]) => viewId));
    const viewKeys = reconcilePublicKeyScope(
      views.map(([id, view]) => ({
        id,
        label: typeof view.name === "string" ? view.name : "",
        ...(sanitizePublicKeyMetadata(view.urlKey) && {
          publicKey: sanitizePublicKeyMetadata(view.urlKey),
        }),
      })),
      "view",
      collectReservedPublicKeys(
        snapshot.keyEntities().filter((entry) => !activeViewIds.has(entry.id)),
        "view",
      ),
    );

    const columnKeys = reconcilePublicKeyScope(
      toColumnKeyEntities(columns),
      "coluna",
      collectPageColumnReservations(snapshot.data),
    );
    const columnUpdates: FilterKeyReconcilePlan["columnUpdates"] = [];
    const reconciledColumns: Schema.PageColumn[] = [];
    const catalogColumns: FilterKeyCatalog["columns"] = [];

    for (const column of columns) {
      const publicKey = columnKeys.get(String(column.id))!;
      const currentOptions = Array.isArray(column.data?.options)
        ? column.data.options
        : [];
      const optionKeys = reconcilePublicKeyScope(
        currentOptions.map((option) => ({
          id: String(option.id),
          label: option.value,
          ...(sanitizePublicKeyMetadata(option.publicKey) && {
            publicKey: sanitizePublicKeyMetadata(option.publicKey),
          }),
        })),
        "opcao",
        new Set(sanitizeReservedOptionKeys(column.data?.reservedOptionKeys)),
      );
      const options = currentOptions.map((option) => ({
        ...option,
        publicKey: optionKeys.get(String(option.id))!,
      }));
      const data: Schema.PageColumnData = {
        ...(isJsonRecord(column.data) ? column.data : {}),
        publicKey,
        ...(currentOptions.length > 0 && { options }),
      };
      const reconciled = { ...column, data };
      reconciledColumns.push(reconciled);

      if (!valuesEqual(column.data, data)) {
        columnUpdates.push({
          id: String(column.id),
          data: data as unknown as Record<string, unknown>,
        });
      }
      catalogColumns.push({
        id: String(column.id),
        publicKey,
        options: options.map((option) => ({
          id: String(option.id),
          publicKey: option.publicKey,
        })),
      });
    }

    const pagePatches: FilterKeyReconcilePlan["pagePatches"] = [];
    const catalogViews: FilterKeyCatalog["views"] = [];
    const filterColumns = toFilterColumnDefinitions(reconciledColumns);
    const realColumnKeys = collectReservedPublicKeys(
      toColumnKeyEntities(reconciledColumns),
      "coluna",
    );

    for (const [viewId, view] of views) {
      const urlKey = viewKeys.get(viewId)!;
      catalogViews.push({ id: viewId, urlKey });
      if (!valuesEqual(view.urlKey, urlKey)) {
        pagePatches.push({ path: [viewId, "urlKey"], value: urlKey });
      }

      const previousTitle = isJsonRecord(view.title) ? view.title : undefined;
      const columnName =
        typeof previousTitle?.column_name === "string"
          ? previousTitle.column_name
          : "Título";
      const title = {
        key: "title",
        column_name: columnName,
        ...(isSupportedTitleMask(previousTitle?.mask)
          ? { mask: previousTitle.mask }
          : {}),
        publicKey: reconcilePublicKeyMetadata(
          columnName,
          "coluna",
          previousTitle?.publicKey,
          realColumnKeys,
        ),
      };
      if (!valuesEqual(view.title, title)) {
        pagePatches.push({ path: [viewId, "title"], value: title });
      }

      const filters = reconcileViewFilters(view.filters, filterColumns);
      if (!filterDocumentsEqual(view.filters, filters)) {
        pagePatches.push({ path: [viewId, "filters"], value: filters });
      }
    }

    return {
      pagePatches,
      columnUpdates,
      reconciledColumns,
      catalog: { views: catalogViews, columns: catalogColumns },
    };
  }
}
