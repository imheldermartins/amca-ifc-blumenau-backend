import { rqlite } from "./shared.js";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export interface PageColumnJsonUpdate {
  id: string;
  data: Record<string, unknown>;
}

export interface PageJsonPathUpdate {
  /** Caminho JSON completo; todos os segmentos são validados antes do SQL. */
  path: readonly string[];
  value: unknown;
}

function wire(statement: SqlStatement): RqliteStatement {
  return [statement.text, ...statement.values];
}

/**
 * Guard transacional: quando o alvo desapareceu entre leitura e commit, tenta
 * inserir uma página deliberadamente inválida. O erro de constraint faz o
 * rqlite reverter o batch inteiro; quando o alvo existe, o SELECT não produz
 * linhas e nada é escrito.
 */
function existenceGuard(whereSql: string, values: readonly unknown[]): RqliteStatement {
  return [
    "INSERT INTO pages (id, owner_id) SELECT '!', NULL WHERE NOT EXISTS (" + whereSql + ")",
    ...values,
  ];
}

function jsonPath(segments: readonly string[]): string {
  if (segments.length === 0 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error("Invalid JSON path");
  }
  return `$.${segments
    .map((segment, index) => (index === 0 ? `\"${segment}\"` : segment))
    .join(".")}`;
}

/**
 * Atualiza somente os caminhos informados em `pages.data`. Paths e valores
 * viajam como binds; a lista de chamadas `json_set` é montada apenas com
 * placeholders, nunca com ids ou conteúdo fornecido pelo cliente.
 */
export function buildUpdatePageJsonPathsStatement(
  pageId: string,
  patches: readonly PageJsonPathUpdate[],
  requiredViewId?: string,
): SqlStatement {
  if (!ULID_RE.test(pageId) || patches.length === 0) {
    throw new Error("Invalid page id or empty JSON patch");
  }
  if (requiredViewId !== undefined && !ULID_RE.test(requiredViewId)) {
    throw new Error("Invalid view id");
  }

  const pairs = patches.flatMap((patch) => [jsonPath(patch.path), JSON.stringify(patch.value)]);
  const setters = patches.map(() => "?, json(?)").join(", ");
  const values: unknown[] = [...pairs, pageId];
  let where = "WHERE id = ?";
  if (requiredViewId !== undefined) {
    where += " AND json_type(data, ?) = 'object'";
    values.push(jsonPath([requiredViewId]));
  }

  return {
    text:
      "UPDATE pages " +
      `SET data = json_set(CASE WHEN json_valid(data) THEN data ELSE '{}' END, ${setters}), ` +
      "updated_at = CURRENT_TIMESTAMP " +
      where,
    values,
  };
}

/**
 * Statement parametrizado que altera SOMENTE filters da view. O path tambem
 * viaja como bind; nenhum id vindo da URL e concatenado no SQL.
 */
export function buildUpdatePageViewFiltersStatement(
  pageId: string,
  viewId: string,
  filters: Record<string, unknown>,
): SqlStatement {
  if (!ULID_RE.test(pageId) || !ULID_RE.test(viewId)) {
    throw new Error("Invalid page or view id");
  }

  return buildUpdatePageJsonPathsStatement(
    pageId,
    [{ path: [viewId, "filters"], value: filters }],
    viewId,
  );
}

export async function updatePageViewFiltersJson(
  pageId: string,
  viewId: string,
  filters: Record<string, unknown>,
): Promise<boolean> {
  const [updated] = await rqlite(
    [wire(buildUpdatePageViewFiltersStatement(pageId, viewId, filters))],
    "execute",
  );
  return updated === true;
}

export async function updatePageJsonPaths(
  pageId: string,
  patches: readonly PageJsonPathUpdate[],
  requiredViewId?: string,
): Promise<boolean> {
  const [updated] = await rqlite(
    [wire(buildUpdatePageJsonPathsStatement(pageId, patches, requiredViewId))],
    "execute",
  );
  return updated === true;
}

/**
 * Persiste todo o reparo do reconcile em uma unica transacao rqlite. So os
 * registros que realmente mudaram entram no batch, portanto uma segunda
 * execucao idempotente nao recarimba timestamps.
 */
export async function commitFilterKeyReconcile(input: {
  pageId: string;
  pagePatches: readonly PageJsonPathUpdate[];
  columns: readonly PageColumnJsonUpdate[];
}): Promise<boolean> {
  if (!ULID_RE.test(input.pageId)) throw new Error("Invalid page id");

  const writes: RqliteStatement[] = [];
  if (input.pagePatches.length > 0) {
    writes.push(wire(buildUpdatePageJsonPathsStatement(input.pageId, input.pagePatches)));
  }

  for (const column of input.columns) {
    if (!ULID_RE.test(column.id)) throw new Error("Invalid column id");
    writes.push([
      "UPDATE page_columns SET data = json(?), updated_at = CURRENT_TIMESTAMP " +
        "WHERE id = ? AND parent_id = ?",
      JSON.stringify(column.data),
      column.id,
      input.pageId,
    ]);
  }

  if (writes.length === 0) return true;
  const guards: RqliteStatement[] = [
    existenceGuard("SELECT 1 FROM pages WHERE id = ?", [input.pageId]),
    ...input.columns.map((column) =>
      existenceGuard(
        "SELECT 1 FROM page_columns WHERE id = ? AND parent_id = ?",
        [column.id, input.pageId],
      ),
    ),
  ];
  const statements = [...guards, ...writes];
  const results = await rqlite(statements, "execute", { transaction: true });
  const writeResults = results.slice(guards.length);
  return results.length === statements.length && writeResults.length === writes.length && writeResults.every(Boolean);
}
