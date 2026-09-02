import type { Schema } from "@/models/schemas/index";

export const VIEW_FILTERS_VERSION = 2 as const;
/** ID canônico da coluna sintética usado hoje pelo frontend/snapshot. */
export const TITLE_COLUMN_ID = "page_title" as const;

const CONDITIONS = new Set<Schema.ViewFilterCondition>([
  "equals",
  "contains",
  "greaterThan",
  "lessThan",
  "between",
]);
const VIEW_FILTER_KEYS = new Set(["version", "clauses", "groupBy", "passthrough"]);

export interface FilterColumnDefinition {
  id: string;
  type: Schema.ColumnType;
  options?: readonly Schema.SelectOption[];
}

export class ViewFiltersValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCondition(value: unknown): value is Schema.ViewFilterCondition {
  return typeof value === "string" && CONDITIONS.has(value as Schema.ViewFilterCondition);
}

function isTuple(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  );
}

function parseClauseStrict(value: unknown): Schema.ViewFilterClause {
  if (!isRecord(value)) throw new ViewFiltersValidationError("Cláusula de filtro inválida");
  if (Object.keys(value).some((key) => !["columnId", "condition", "values"].includes(key))) {
    throw new ViewFiltersValidationError("Cláusula de filtro contém campos desconhecidos");
  }
  if (typeof value.columnId !== "string" || value.columnId.length === 0) {
    throw new ViewFiltersValidationError("Coluna do filtro inválida");
  }
  if (!isCondition(value.condition)) {
    throw new ViewFiltersValidationError("Condição de filtro inválida");
  }
  if (!Array.isArray(value.values) || !value.values.every((item) => typeof item === "string")) {
    throw new ViewFiltersValidationError("Valores do filtro inválidos");
  }
  return {
    columnId: value.columnId,
    condition: value.condition,
    values: value.values,
  };
}

function parseClauseLoose(value: unknown): Schema.ViewFilterClause | null {
  try {
    return parseClauseStrict(value);
  } catch {
    return null;
  }
}

function validDate(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function valuesAreCompatible(
  column: FilterColumnDefinition,
  condition: Schema.ViewFilterCondition,
  values: readonly string[],
): boolean {
  if (column.type === "select") return condition === "equals" && values.length > 0;
  if (column.type === "checkbox") {
    return condition === "equals" && values.length === 1 && ["true", "false"].includes(values[0]!);
  }
  if (column.type === "numeric") {
    return (
      ["equals", "greaterThan", "lessThan"].includes(condition) &&
      values.length === 1 &&
      values[0]!.trim().length > 0 &&
      Number.isFinite(Number(values[0]))
    );
  }
  if (column.type === "date") {
    if (condition === "between") return values.length === 2 && values.every(validDate);
    return (
      ["equals", "greaterThan", "lessThan"].includes(condition) &&
      values.length === 1 &&
      validDate(values[0]!)
    );
  }
  if (condition === "equals") return values.length === 1;
  return condition === "contains" && values.length === 1 && values[0]!.length > 0;
}

function validateWriteClause(
  clause: Schema.ViewFilterClause,
  column: FilterColumnDefinition,
): void {
  if (column.type === "select") {
    if (
      clause.condition !== "equals" ||
      clause.values.length === 0 ||
      clause.values.some((value) => value.trim().length === 0)
    ) {
      throw new ViewFiltersValidationError(
        `Condição ou valores incompatíveis com a coluna ${clause.columnId}`,
      );
    }
    return;
  }

  if (!valuesAreCompatible(column, clause.condition, clause.values)) {
    throw new ViewFiltersValidationError(
      `Condição ou valores incompatíveis com a coluna ${clause.columnId}`,
    );
  }
}

/**
 * Remove apenas referencias/criterios que perderam validade no dominio. O
 * formato do request ja foi validado separadamente; delecoes concorrentes nao
 * transformam o write inteiro em erro.
 */
export function pruneViewFilters(
  document: Schema.ViewFiltersV2,
  columns: readonly FilterColumnDefinition[],
): Schema.ViewFiltersV2 {
  const byId = new Map(columns.map((column) => [column.id, column]));

  const groupBy: string[] = [];
  const seenGroups = new Set<string>();
  for (const columnId of document.groupBy) {
    if (!byId.has(columnId) || seenGroups.has(columnId)) continue;
    seenGroups.add(columnId);
    groupBy.push(columnId);
  }

  const clauses: Schema.ViewFilterClause[] = [];
  for (const clause of document.clauses) {
    const column = byId.get(clause.columnId);
    if (!column) continue;

    let values = clause.values.slice();
    if (column.type === "select") {
      const available = new Set<string>((column.options ?? []).map((option) => String(option.id)));
      values = [...new Set(values.filter((value) => available.has(value)))];
    }
    if (!valuesAreCompatible(column, clause.condition, values)) continue;
    clauses.push({ ...clause, values });
  }

  return { ...document, clauses, groupBy };
}

/** Request publico estrito: `updatedAt` e qualquer outro campo sao recusados. */
export function parseViewFiltersWrite(
  raw: unknown,
  columns: readonly FilterColumnDefinition[],
  updatedAt: string,
): Schema.ViewFiltersV2 {
  if (!isRecord(raw)) throw new ViewFiltersValidationError("Documento de filtros inválido");
  if (Object.keys(raw).some((key) => !VIEW_FILTER_KEYS.has(key))) {
    throw new ViewFiltersValidationError("Documento de filtros contém campos desconhecidos");
  }
  if (raw.version !== VIEW_FILTERS_VERSION) {
    throw new ViewFiltersValidationError("Versão de filtros não suportada");
  }
  if (!Array.isArray(raw.clauses)) throw new ViewFiltersValidationError("Filtros inválidos");
  if (!Array.isArray(raw.groupBy) || !raw.groupBy.every((id) => typeof id === "string")) {
    throw new ViewFiltersValidationError("Agrupamentos inválidos");
  }
  if (!Array.isArray(raw.passthrough) || !raw.passthrough.every(isTuple)) {
    throw new ViewFiltersValidationError("Passthrough inválido");
  }

  const clauses = raw.clauses.map(parseClauseStrict);
  const byId = new Map(columns.map((column) => [column.id, column]));
  for (const clause of clauses) {
    const column = byId.get(clause.columnId);
    // Uma coluna ausente pode ter sido excluída entre o load e o write. A
    // referência será podada abaixo, sem invalidar as demais alterações.
    if (column) validateWriteClause(clause, column);
  }

  return pruneViewFilters(
    {
      version: VIEW_FILTERS_VERSION,
      updatedAt,
      clauses,
      groupBy: raw.groupBy,
      passthrough: raw.passthrough,
    },
    columns,
  );
}

function parseLegacy(raw: string): Schema.ViewFiltersV2 {
  const params = new URLSearchParams(raw);
  const entries = [...params.entries()];
  const versionIndex = entries.findIndex(([key]) => key === "v");
  const version = versionIndex >= 0 ? entries[versionIndex]?.[1] : null;
  const supported = version === null || version === "1";
  const clauses: Schema.ViewFilterClause[] = [];
  const groupBy: string[] = [];
  const passthrough: [string, string][] = [];

  entries.forEach(([key, value], index) => {
    if (index === versionIndex) return;
    if (!supported) {
      passthrough.push([key, value]);
      return;
    }
    if (key === "group" && value.length > 0) {
      groupBy.push(value);
      return;
    }
    if (key === "where" && version === "1") {
      try {
        const clause = parseClauseLoose(JSON.parse(value));
        if (clause) {
          clauses.push(clause);
          return;
        }
      } catch {
        // Cai no passthrough abaixo: a conversao e lossless para lixo legado.
      }
    }
    passthrough.push([key, value]);
  });

  return {
    version: VIEW_FILTERS_VERSION,
    updatedAt: null,
    clauses,
    groupBy,
    passthrough,
  };
}

/** Leitura tolerante usada pelo reconcile de DB legado. */
export function reconcileViewFilters(
  raw: unknown,
  columns: readonly FilterColumnDefinition[],
): Schema.ViewFiltersV2 {
  if (typeof raw === "string") return pruneViewFilters(parseLegacy(raw), columns);

  if (!isRecord(raw) || raw.version !== VIEW_FILTERS_VERSION) {
    return {
      version: VIEW_FILTERS_VERSION,
      updatedAt: null,
      clauses: [],
      groupBy: [],
      passthrough: [],
    };
  }

  const clauses = Array.isArray(raw.clauses)
    ? raw.clauses.map(parseClauseLoose).filter((item): item is Schema.ViewFilterClause => item !== null)
    : [];
  const groupBy = Array.isArray(raw.groupBy)
    ? raw.groupBy.filter((id): id is string => typeof id === "string")
    : [];
  const passthrough = Array.isArray(raw.passthrough)
    ? raw.passthrough.filter(isTuple)
    : [];
  const updatedAt =
    typeof raw.updatedAt === "string" && Number.isFinite(Date.parse(raw.updatedAt))
      ? raw.updatedAt
      : null;

  return pruneViewFilters(
    { version: VIEW_FILTERS_VERSION, updatedAt, clauses, groupBy, passthrough },
    columns,
  );
}

export function filterDocumentsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
