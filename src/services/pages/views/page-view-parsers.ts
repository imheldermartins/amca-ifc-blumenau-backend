import type { Schema } from "@/db/schemas/index";
import type { JsonRecord } from "@/services/types/json.types";
import type { FilterColumnDefinition } from "@/services/types/view-filters.types";
import type {
  PageViewCreateInput,
  PageViewKind,
  PageViewTitleInput,
} from "@/services/pages/views/types/page-view.types";
import {
  TITLE_COLUMN_ID,
  ViewFiltersValidationError,
} from "@/services/view-filters-v2";
import { sanitizePublicKeyMetadata } from "@/services/public-key";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const VIEW_KINDS = new Set<PageViewKind>([
  "table",
  "grid",
  "board",
  "calendar",
  "timeline",
  "graph",
]);
const TITLE_MASKS = new Set<Schema.TextMask>(["cpf", "cep", "phone-br", "date", "email"]);
const VIEW_PATCH_FIELDS = new Set([
  "view",
  "name",
  "title",
  "orderedHeaderCols",
  "orderedRows",
  "columnWidths",
  "dateColumnId",
  "colorColumnId",
  "calendarPropertyIds",
  "calendarShowPropertyLabels",
]);

export function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isUlid(value: unknown): value is string {
  return typeof value === "string" && ULID_PATTERN.test(value);
}

export function isPageView(value: unknown): value is JsonRecord {
  return (
    isJsonRecord(value) &&
    typeof value.view === "string" &&
    VIEW_KINDS.has(value.view as PageViewKind)
  );
}

export function isActivePageView(value: unknown): value is JsonRecord {
  return isPageView(value) && value.deletedAt == null;
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parsePageViewTitle(value: unknown): PageViewTitleInput {
  if (!isJsonRecord(value) || value.key !== "title" || typeof value.column_name !== "string") {
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

export function parsePageViewCreate(
  raw: unknown,
  queryType?: unknown,
): PageViewCreateInput {
  if (
    !isJsonRecord(raw) ||
    Object.keys(raw).some((key) => !["type", "view", "name", "title"].includes(key))
  ) {
    throw new ViewFiltersValidationError("View inválida");
  }

  const requestedTypes = [raw.type, raw.view, queryType].filter(
    (value) => value !== undefined,
  );
  const kind = requestedTypes[0] ?? "table";
  if (
    typeof kind !== "string" ||
    !VIEW_KINDS.has(kind as PageViewKind) ||
    requestedTypes.some((value) => value !== kind)
  ) {
    throw new ViewFiltersValidationError("Tipo de view inválido");
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 120) {
    throw new ViewFiltersValidationError("Nome de view inválido");
  }

  return {
    kind: kind as PageViewKind,
    name,
    title:
      raw.title === undefined
        ? { key: "title", column_name: "Título" }
        : parsePageViewTitle(raw.title),
  };
}

export function parsePageViewOrder(raw: unknown): string[] {
  if (
    !isJsonRecord(raw) ||
    Object.keys(raw).some((key) => key !== "viewIds") ||
    !Array.isArray(raw.viewIds) ||
    raw.viewIds.length === 0 ||
    raw.viewIds.some((viewId) => !isUlid(viewId)) ||
    new Set(raw.viewIds).size !== raw.viewIds.length
  ) {
    throw new ViewFiltersValidationError("Ordem de views inválida");
  }

  return [...raw.viewIds] as string[];
}

export function parsePageViewPatch(viewId: unknown, raw: unknown): JsonRecord {
  if (!isUlid(viewId) || !isJsonRecord(raw)) {
    throw new ViewFiltersValidationError("Patch de view inválido");
  }
  if (
    Object.keys(raw).length === 0 ||
    Object.keys(raw).some((key) => !VIEW_PATCH_FIELDS.has(key))
  ) {
    throw new ViewFiltersValidationError("Patch de view contém campos inválidos");
  }

  return raw;
}

export function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ViewFiltersValidationError(`${field} inválido`);
  }
  return [...new Set(value)];
}

export function parseColumnWidths(value: unknown): Record<string, number> {
  if (!isJsonRecord(value)) {
    throw new ViewFiltersValidationError("Larguras inválidas");
  }
  const entries = Object.entries(value);
  if (
    entries.some(
      ([id, width]) =>
        id.length === 0 ||
        typeof width !== "number" ||
        !Number.isFinite(width) ||
        width <= 0,
    )
  ) {
    throw new ViewFiltersValidationError("Larguras inválidas");
  }

  return Object.fromEntries(entries) as Record<string, number>;
}

export function toFilterColumnDefinitions(
  columns: readonly Schema.PageColumn[],
): FilterColumnDefinition[] {
  return [
    { id: TITLE_COLUMN_ID, type: "text" },
    ...columns.map((column) => ({
      id: String(column.id),
      type: column.type,
      ...(Array.isArray(column.data?.options) && { options: column.data.options }),
    })),
  ];
}

export function toColumnKeyEntities(columns: readonly Schema.PageColumn[]) {
  return columns.map((column) => ({
    id: String(column.id),
    label: column.name,
    ...(sanitizePublicKeyMetadata(column.data?.publicKey) && {
      publicKey: sanitizePublicKeyMetadata(column.data?.publicKey),
    }),
  }));
}

export function isSupportedTitleMask(value: unknown): value is Schema.TextMask {
  return TITLE_MASKS.has(value as Schema.TextMask);
}

export function isSupportedViewKind(value: unknown): value is PageViewKind {
  return typeof value === "string" && VIEW_KINDS.has(value as PageViewKind);
}
