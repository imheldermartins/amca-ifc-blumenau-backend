import type { Schema } from "@/db/schemas/index";
import type { JsonRecord } from "@/services/types/json.types";
import type { FilterColumnDefinition } from "@/services/types/view-filters.types";
import type {
  PageViewCreateInput,
  PageViewFormConfig,
  PageViewHeatmapConfig,
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
  "form",
  "heatmap",
]);
const TITLE_MASKS = new Set<Schema.TextMask>(["cpf", "cep", "phone-br", "date", "email"]);
const VIEW_PATCH_FIELDS = new Set([
  "view",
  "name",
  "title",
  "orderedHeaderCols",
  "orderedRows",
  "columnWidths",
  "tileSize",
  "gridPropertyIds",
  "dateColumnId",
  "colorColumnId",
  "calendarPropertyIds",
  "calendarShowPropertyLabels",
  "board",
  "form",
  "heatmap",
]);

const FORM_ICON_PATTERN = /^(?:cuida|lucide):[a-z0-9][a-z0-9-]*$/i;

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

export function parsePageViewFormConfig(value: unknown): PageViewFormConfig {
  if (
    !isJsonRecord(value) ||
    Object.keys(value).some((key) => !["version", "flowColumnId", "hiddenFieldIds", "submitButton"].includes(key)) ||
    value.version !== 1 ||
    !isUlid(value.flowColumnId) ||
    !isJsonRecord(value.submitButton) ||
    Object.keys(value.submitButton).some((key) => !["label", "icon"].includes(key))
  ) {
    throw new ViewFiltersValidationError("Configuração do formulário inválida");
  }

  const label = typeof value.submitButton.label === "string"
    ? value.submitButton.label.trim()
    : "";
  const icon = value.submitButton.icon;
  const hiddenFieldIds = value.hiddenFieldIds === undefined
    ? []
    : parseStringList(value.hiddenFieldIds, "Campos ocultos");
  if (
    !label ||
    label.length > 80 ||
    (icon !== null &&
      (typeof icon !== "string" || icon.length > 120 || !FORM_ICON_PATTERN.test(icon))) ||
    hiddenFieldIds.length > 500 ||
    hiddenFieldIds.some((id) => id !== TITLE_COLUMN_ID && !isUlid(id))
  ) {
    throw new ViewFiltersValidationError("Botão do formulário inválido");
  }

  return {
    version: 1,
    flowColumnId: value.flowColumnId,
    ...(value.hiddenFieldIds !== undefined && { hiddenFieldIds }),
    submitButton: { label, icon },
  };
}

export function parsePageViewHeatmapConfig(value: unknown): PageViewHeatmapConfig {
  if (!isJsonRecord(value)
    || Object.keys(value).some((key) => !['version', 'dateColumnId', value.version === 1 ? 'checkboxColumnId' : 'checkboxColumnIds', 'period'].includes(key))
    || (value.version !== 1 && value.version !== 2) || !isUlid(value.dateColumnId)
    || !isJsonRecord(value.period)) {
    throw new ViewFiltersValidationError('Configuração do Mapa de calor inválida');
  }
  const checkboxColumnIds = value.version === 1 ? [value.checkboxColumnId] : value.checkboxColumnIds;
  if (!Array.isArray(checkboxColumnIds)
    || !checkboxColumnIds.length || !checkboxColumnIds.every(isUlid)
    || new Set(checkboxColumnIds).size !== checkboxColumnIds.length) {
    throw new ViewFiltersValidationError('Selecione pelo menos uma coluna checkbox, sem duplicatas');
  }
  const period = value.period;
  if (period.mode === 'year' && Object.keys(period).every((key) => key === 'mode')) {
    return { version: 2, dateColumnId: value.dateColumnId, checkboxColumnIds, period: { mode: 'year' } };
  }
  if (period.mode === 'months' && Object.keys(period).every((key) => ['mode', 'monthCount'].includes(key))
    && Number.isInteger(period.monthCount) && Number(period.monthCount) >= 1 && Number(period.monthCount) <= 12) {
    return { version: 2, dateColumnId: value.dateColumnId, checkboxColumnIds,
      period: { mode: 'months', monthCount: Number(period.monthCount) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 } };
  }
  throw new ViewFiltersValidationError('Período do Mapa de calor inválido');
}

export function assertHeatmapColumns(config: PageViewHeatmapConfig, columns: readonly Pick<Schema.PageColumn, 'id' | 'type'>[]): void {
  if (!columns.some((column) => column.id === config.dateColumnId && column.type === 'date')
    || !config.checkboxColumnIds.length
    || !config.checkboxColumnIds.every((id) => columns.some((column) => column.id === id && column.type === 'checkbox'))) {
    throw new ViewFiltersValidationError('O Mapa de calor exige uma coluna de data e pelo menos uma coluna checkbox da base');
  }
}

export function assertFormFlowColumn(
  config: PageViewFormConfig,
  columns: readonly Schema.PageColumn[],
): void {
  const flowColumn = columns.find((column) => column.id === config.flowColumnId);
  if (!flowColumn || flowColumn.type !== "flow") {
    throw new ViewFiltersValidationError("Coluna Flow do formulário inválida");
  }
  const hidden = new Set(config.hiddenFieldIds ?? []);
  if (columns.some((column) => column.type === "flow" && hidden.has(column.id))) {
    throw new ViewFiltersValidationError("Coluna Flow não pode ser campo oculto do formulário");
  }
}

export function pageUsesFlowColumn(data: unknown, columnId: string): boolean {
  if (!isJsonRecord(data)) return false;
  return Object.values(data).some((value) => {
    if (!isActivePageView(value) || value.view !== "form" || !isJsonRecord(value.form)) {
      return false;
    }
    return value.form.flowColumnId === columnId;
  });
}

export function parsePageViewCreate(
  raw: unknown,
  queryType?: unknown,
): PageViewCreateInput {
  if (
    !isJsonRecord(raw) ||
    Object.keys(raw).some((key) => !["type", "view", "name", "title", "form", "heatmap"].includes(key))
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

  const form = raw.form === undefined ? undefined : parsePageViewFormConfig(raw.form);
  const heatmap = raw.heatmap === undefined ? undefined : parsePageViewHeatmapConfig(raw.heatmap);
  if (kind === "form" && !form) {
    throw new ViewFiltersValidationError("Configuração do formulário obrigatória");
  }
  if (kind !== "form" && form) {
    throw new ViewFiltersValidationError("Configuração de formulário incompatível com a view");
  }
  if (kind === 'heatmap' && !heatmap) throw new ViewFiltersValidationError('Configuração do Mapa de calor obrigatória');
  if (kind !== 'heatmap' && heatmap) throw new ViewFiltersValidationError('Configuração de Mapa de calor incompatível com a view');

  return {
    kind: kind as PageViewKind,
    name,
    title:
      raw.title === undefined
        ? { key: "title", column_name: "Título" }
        : parsePageViewTitle(raw.title),
    ...(form && { form }),
    ...(heatmap && { heatmap }),
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
