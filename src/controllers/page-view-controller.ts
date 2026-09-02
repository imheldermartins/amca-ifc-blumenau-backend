import db from "@models/index";
import type { Schema } from "@/models/schemas/index";
import {
  commitFilterKeyReconcile,
  updatePageJsonPaths,
  updatePageViewFiltersJson,
  type PageJsonPathUpdate,
} from "@/core/db/page-json";
import {
  collectReservedPublicKeys,
  reconcilePublicKeyMetadata,
  reconcilePublicKeyScope,
  sanitizePublicKeyMetadata,
} from "@/services/public-key";
import {
  collectPageColumnReservations,
  readDeletedColumnKeys,
  sanitizeReservedOptionKeys,
} from "@/services/filter-key-registry";
import {
  TITLE_COLUMN_ID,
  filterDocumentsEqual,
  parseViewFiltersWrite,
  reconcileViewFilters,
  ViewFiltersValidationError,
  type FilterColumnDefinition,
} from "@/services/view-filters-v2";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const VIEW_KINDS = new Set(["table", "board", "calendar"]);
const TITLE_MASKS = new Set<Schema.TextMask>(["cpf", "cep", "phone-br", "date"]);
const VIEW_PATCH_KEYS = new Set([
  "view",
  "name",
  "title",
  "orderedHeaderCols",
  "orderedRows",
  "columnWidths",
]);

type JsonRecord = Record<string, unknown>;

export interface PageViewPatchResult {
  viewId: string;
  view: JsonRecord;
  data: JsonRecord;
  changed: boolean;
}

export interface FilterWriteResult {
  viewId: string;
  filters: Schema.ViewFiltersV2;
  data: JsonRecord;
}

export interface FilterKeyCatalog {
  views: Array<{ id: string; urlKey: Schema.PublicKeyMetadata }>;
  columns: Array<{
    id: string;
    publicKey: Schema.PublicKeyMetadata;
    options: Array<{ id: string; publicKey: Schema.PublicKeyMetadata }>;
  }>;
}

export interface FilterKeyReconcileResult {
  pageId: string;
  data: JsonRecord;
  columns: Schema.PageColumn[];
  catalog: FilterKeyCatalog;
  changedPage: boolean;
  changedColumnIds: string[];
}

export type PageViewFailure =
  | { ok: false; reason: "not_found" | "validation" | "server_error"; message: string };
export type PageViewResult<T> = { ok: true; data: T } | PageViewFailure;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isView(value: unknown): value is JsonRecord {
  return isRecord(value) && typeof value.view === "string" && VIEW_KINDS.has(value.view);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pageData(page: Schema.Page): JsonRecord {
  return isRecord(page.data) ? page.data : {};
}

function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ViewFiltersValidationError(`${field} inválido`);
  }
  return [...new Set(value)];
}

function parseColumnWidths(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new ViewFiltersValidationError("Larguras inválidas");
  const entries = Object.entries(value);
  if (
    entries.some(
      ([id, width]) =>
        id.length === 0 || typeof width !== "number" || !Number.isFinite(width) || width <= 0,
    )
  ) {
    throw new ViewFiltersValidationError("Larguras inválidas");
  }
  return Object.fromEntries(entries) as Record<string, number>;
}

function parseTitle(value: unknown): { key: "title"; column_name: string; mask?: Schema.TextMask } {
  if (!isRecord(value) || value.key !== "title" || typeof value.column_name !== "string") {
    throw new ViewFiltersValidationError("Coluna de título inválida");
  }
  if (Object.keys(value).some((key) => !["key", "column_name", "mask"].includes(key))) {
    throw new ViewFiltersValidationError("Coluna de título contém campos desconhecidos");
  }
  if (value.mask !== undefined && !TITLE_MASKS.has(value.mask as Schema.TextMask)) {
    throw new ViewFiltersValidationError("Máscara da coluna de título inválida");
  }
  return {
    key: "title",
    column_name: value.column_name,
    ...(value.mask !== undefined && { mask: value.mask as Schema.TextMask }),
  };
}

function definitions(columns: readonly Schema.PageColumn[]): FilterColumnDefinition[] {
  return [
    { id: TITLE_COLUMN_ID, type: "text" },
    ...columns.map((column) => ({
      id: String(column.id),
      type: column.type,
      ...(Array.isArray(column.data?.options) && { options: column.data.options }),
    })),
  ];
}

class PageViewController {
  private async context(pageId: string): Promise<{
    page: Schema.Page;
    columns: Schema.PageColumn[];
  } | null> {
    if (!ULID_RE.test(pageId)) return null;
    const page = await db.pages.find({ id: pageId } as LookupValues<Schema.Page>);
    if (!page) return null;
    const columns =
      (await db.pageColumns.findAll({ parent_id: pageId } as LookupsConfig<Schema.PageColumn>)) ?? [];
    return { page, columns };
  }

  async updateFilters(
    pageId: string,
    viewId: string,
    raw: unknown,
  ): Promise<PageViewResult<FilterWriteResult>> {
    if (!ULID_RE.test(viewId)) {
      return { ok: false, reason: "validation", message: "View inválida" };
    }

    try {
      const context = await this.context(pageId);
      if (!context) return { ok: false, reason: "not_found", message: "Página não encontrada" };
      const currentData = pageData(context.page);
      if (!isView(currentData[viewId])) {
        return { ok: false, reason: "not_found", message: "View não encontrada" };
      }

      const filters = parseViewFiltersWrite(raw, definitions(context.columns), new Date().toISOString());
      const updated = await updatePageViewFiltersJson(
        pageId,
        viewId,
        filters as unknown as Record<string, unknown>,
      );
      if (!updated) {
        return { ok: false, reason: "not_found", message: "View não encontrada" };
      }
      const page = await db.pages.find({ id: pageId } as LookupValues<Schema.Page>);
      if (!page) return { ok: false, reason: "server_error", message: "Erro no servidor" };
      return { ok: true, data: { viewId, filters, data: pageData(page) } };
    } catch (error) {
      if (error instanceof ViewFiltersValidationError) {
        return { ok: false, reason: "validation", message: error.message };
      }
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async patchView(
    pageId: string,
    viewId: string,
    raw: unknown,
  ): Promise<PageViewResult<PageViewPatchResult>> {
    if (!ULID_RE.test(viewId) || !isRecord(raw)) {
      return { ok: false, reason: "validation", message: "Patch de view inválido" };
    }
    if (Object.keys(raw).length === 0 || Object.keys(raw).some((key) => !VIEW_PATCH_KEYS.has(key))) {
      return { ok: false, reason: "validation", message: "Patch de view contém campos inválidos" };
    }

    try {
      const context = await this.context(pageId);
      if (!context) return { ok: false, reason: "not_found", message: "Página não encontrada" };
      const currentData = pageData(context.page);
      const current = currentData[viewId];
      if (!isView(current)) {
        return { ok: false, reason: "not_found", message: "View não encontrada" };
      }

      const patches: PageJsonPathUpdate[] = [];
      const next: JsonRecord = { ...current };
      const set = (field: string, value: unknown) => {
        if (same(current[field], value)) return;
        next[field] = value;
        patches.push({ path: [viewId, field], value });
      };

      if (raw.view !== undefined) {
        if (typeof raw.view !== "string" || !VIEW_KINDS.has(raw.view)) {
          throw new ViewFiltersValidationError("Tipo de view inválido");
        }
        set("view", raw.view);
      }
      if (raw.name !== undefined) {
        if (typeof raw.name !== "string") throw new ViewFiltersValidationError("Nome inválido");
        set("name", raw.name);
        const otherViews = Object.entries(currentData)
          .filter(
            (entry): entry is [string, JsonRecord] =>
              entry[0] !== viewId && isView(entry[1]),
          )
          .map(([id, view]) => ({
            id,
            label: typeof view.name === "string" ? view.name : "",
            ...(sanitizePublicKeyMetadata(view.urlKey) && {
              publicKey: sanitizePublicKeyMetadata(view.urlKey),
            }),
          }));
        const urlKey = reconcilePublicKeyMetadata(
          raw.name,
          "view",
          current.urlKey,
          collectReservedPublicKeys(otherViews, "view"),
          { forceRename: raw.name !== current.name },
        );
        set("urlKey", urlKey);
      }
      if (raw.title !== undefined) {
        const title = parseTitle(raw.title);
        const realColumns = context.columns.map((column) => ({
          id: String(column.id),
          label: column.name,
          ...(sanitizePublicKeyMetadata(column.data?.publicKey) && {
            publicKey: sanitizePublicKeyMetadata(column.data?.publicKey),
          }),
        }));
        const reserved = collectReservedPublicKeys(realColumns, "coluna");
        readDeletedColumnKeys(currentData).forEach((key) => reserved.add(key));
        const previousTitle = isRecord(current.title) ? current.title : undefined;
        const publicKey = reconcilePublicKeyMetadata(
          title.column_name,
          "coluna",
          previousTitle?.publicKey,
          reserved,
          { forceRename: title.column_name !== previousTitle?.column_name },
        );
        set("title", { ...title, publicKey });
      }
      if (raw.orderedHeaderCols !== undefined) {
        set("orderedHeaderCols", parseStringList(raw.orderedHeaderCols, "Ordem de colunas"));
      }
      if (raw.orderedRows !== undefined) {
        set("orderedRows", parseStringList(raw.orderedRows, "Ordem de linhas"));
      }
      if (raw.columnWidths !== undefined) set("columnWidths", parseColumnWidths(raw.columnWidths));

      if (patches.length > 0) {
        const updated = await updatePageJsonPaths(pageId, patches, viewId);
        if (!updated) return { ok: false, reason: "not_found", message: "View não encontrada" };
      }
      const page =
        patches.length > 0
          ? await db.pages.find({ id: pageId } as LookupValues<Schema.Page>)
          : context.page;
      if (!page) return { ok: false, reason: "server_error", message: "Erro no servidor" };
      const data = pageData(page);
      const view = data[viewId];
      if (!isRecord(view)) return { ok: false, reason: "server_error", message: "Erro no servidor" };
      return { ok: true, data: { viewId, view, data, changed: patches.length > 0 } };
    } catch (error) {
      if (error instanceof ViewFiltersValidationError) {
        return { ok: false, reason: "validation", message: error.message };
      }
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async reconcile(pageId: string): Promise<PageViewResult<FilterKeyReconcileResult>> {
    try {
      const context = await this.context(pageId);
      if (!context) return { ok: false, reason: "not_found", message: "Página não encontrada" };
      const currentData = pageData(context.page);
      const views = Object.entries(currentData).filter(
        (entry): entry is [string, JsonRecord] => ULID_RE.test(entry[0]) && isView(entry[1]),
      );

      const viewKeys = reconcilePublicKeyScope(
        views.map(([id, view]) => ({
          id,
          label: typeof view.name === "string" ? view.name : "",
          ...(sanitizePublicKeyMetadata(view.urlKey) && {
            publicKey: sanitizePublicKeyMetadata(view.urlKey),
          }),
        })),
        "view",
      );

      const columnKeys = reconcilePublicKeyScope(
        context.columns.map((column) => ({
          id: String(column.id),
          label: column.name,
          ...(sanitizePublicKeyMetadata(column.data?.publicKey) && {
            publicKey: sanitizePublicKeyMetadata(column.data?.publicKey),
          }),
        })),
        "coluna",
        collectPageColumnReservations(currentData),
      );
      const columnUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
      const reconciledColumns: Schema.PageColumn[] = [];
      const catalogColumns: FilterKeyCatalog["columns"] = [];

      for (const column of context.columns) {
        const publicKey = columnKeys.get(String(column.id))!;
        const currentOptions = Array.isArray(column.data?.options) ? column.data.options : [];
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
          ...(isRecord(column.data) ? column.data : {}),
          publicKey,
          ...(currentOptions.length > 0 && { options }),
        };
        const reconciled = { ...column, data };
        reconciledColumns.push(reconciled);
        if (!same(column.data, data)) {
          columnUpdates.push({
            id: String(column.id),
            data: data as unknown as Record<string, unknown>,
          });
        }
        catalogColumns.push({
          id: String(column.id),
          publicKey,
          options: options.map((option) => ({ id: String(option.id), publicKey: option.publicKey })),
        });
      }

      const filterColumns = definitions(reconciledColumns);
      const pagePatches: PageJsonPathUpdate[] = [];
      const catalogViews: FilterKeyCatalog["views"] = [];
      for (const [viewId, view] of views) {
        const urlKey = viewKeys.get(viewId)!;
        catalogViews.push({ id: viewId, urlKey });
        if (!same(view.urlKey, urlKey)) pagePatches.push({ path: [viewId, "urlKey"], value: urlKey });

        const previousTitle = isRecord(view.title) ? view.title : undefined;
        const columnName =
          typeof previousTitle?.column_name === "string" ? previousTitle.column_name : "Título";
        const titleKey = reconcilePublicKeyMetadata(
          columnName,
          "coluna",
          previousTitle?.publicKey,
          collectReservedPublicKeys(
            reconciledColumns.map((column) => ({
              id: String(column.id),
              label: column.name,
              ...(column.data.publicKey && { publicKey: column.data.publicKey }),
            })),
            "coluna",
          ),
        );
        const title = {
          key: "title",
          column_name: columnName,
          ...(previousTitle?.mask !== undefined && TITLE_MASKS.has(previousTitle.mask as Schema.TextMask)
            ? { mask: previousTitle.mask }
            : {}),
          publicKey: titleKey,
        };
        if (!same(view.title, title)) pagePatches.push({ path: [viewId, "title"], value: title });

        const filters = reconcileViewFilters(view.filters, filterColumns);
        if (!filterDocumentsEqual(view.filters, filters)) {
          pagePatches.push({ path: [viewId, "filters"], value: filters });
        }
      }

      const committed = await commitFilterKeyReconcile({
        pageId,
        pagePatches,
        columns: columnUpdates,
      });
      if (!committed) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      const page =
        pagePatches.length > 0
          ? await db.pages.find({ id: pageId } as LookupValues<Schema.Page>)
          : context.page;
      const columns =
        columnUpdates.length > 0
          ? (await db.pageColumns.findAll({ parent_id: pageId } as LookupsConfig<Schema.PageColumn>)) ?? []
          : reconciledColumns;
      if (!page) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return {
        ok: true,
        data: {
          pageId,
          data: pageData(page),
          columns,
          catalog: { views: catalogViews, columns: catalogColumns },
          changedPage: pagePatches.length > 0,
          changedColumnIds: columnUpdates.map((column) => column.id),
        },
      };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }
}

export default new PageViewController();
