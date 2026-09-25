/** Smoke HTTP dos recursos de Page contra API e rqlite descartáveis. */
import assert from "node:assert/strict";
import { ulid } from "ulid";
import db from "@models/index";
import type { Schema } from "@/db/schemas/index";
import jwtService from "@/services/auth/jwt-service";

if (process.env.DATABASE_URL !== "http://127.0.0.1:18012") {
  throw new Error("Use exclusivamente DATABASE_URL=http://127.0.0.1:18012.");
}

const origin = process.env.API_VALIDATION_ORIGIN ?? "http://127.0.0.1:3008/api/v1";

async function call<T>(
  method: string,
  path: string,
  token: string,
  expected: number,
  body?: unknown,
): Promise<T> {
  const response = await fetch(origin + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as T & { message?: string } : null as T;
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${data && typeof data === "object" && "message" in data ? data.message : response.status}`,
  );
  return data;
}

async function createUser(label: string): Promise<Schema.User> {
  const suffix = ulid().toLowerCase();
  const user = await db.users.create({
    name: label,
    email: `${label.toLowerCase().replaceAll(" ", "-")}-${suffix}@example.test`,
    email_verified_at: new Date().toISOString(),
  } as CreateValues<Schema.User>);
  assert.ok(user, `Não foi possível criar ${label}.`);
  return user;
}

const owner = await createUser("Owner Page");
const stranger = await createUser("Stranger Page");
const ownerToken = jwtService.signAccessToken({ sub: owner.id });
const strangerToken = jwtService.signAccessToken({ sub: stranger.id });

const page = await call<Schema.Page>("POST", "/pages", ownerToken, 201, {
  title: "Página HTTP",
  data: {},
});
assert.equal(page.owner_id, owner.id);

await call("GET", `/pages/${page.id}`, strangerToken, 404);

const updatedPage = await call<Schema.Page>("PUT", `/pages/${page.id}`, ownerToken, 200, {
  title: "Página HTTP atualizada",
});
assert.equal(updatedPage.title, "Página HTTP atualizada");

const firstView = await call<{ viewId: string; view: Record<string, unknown> }>(
  "POST",
  `/pages/${page.id}/views?type=table`,
  ownerToken,
  201,
  { name: "Tabela principal" },
);
const duplicatedView = await call<{ viewId: string; view: Record<string, unknown> }>(
  "POST",
  `/pages/${page.id}/views/${firstView.viewId}/duplicate`,
  ownerToken,
  201,
);
await call("PATCH", `/pages/${page.id}/views/${firstView.viewId}`, ownerToken, 200, {
  name: "Tabela validada",
});
await call("PUT", `/pages/${page.id}/views/order`, ownerToken, 200, {
  viewIds: [duplicatedView.viewId, firstView.viewId],
});
await call("DELETE", `/pages/${page.id}/views/${duplicatedView.viewId}`, ownerToken, 204);

const child = await call<Schema.Page>("POST", `/pages/${page.id}/page`, ownerToken, 201, {
  title: "Linha HTTP",
  data: {},
});
assert.equal(child.owner_id, owner.id);

const breadcrumb = await call<Array<{ id: string; parent_id: string; depth: number }>>(
  "GET",
  `/pages/${child.id}/breadcrumb`,
  ownerToken,
  200,
);
assert.ok(breadcrumb.some((entry) => entry.id === child.id && entry.parent_id === page.id));

const column = await call<Schema.PageColumn>(
  "POST",
  `/pages/parent/${page.id}/columns?type=text`,
  ownerToken,
  201,
  { name: "Resumo" },
);
assert.equal(column.parent_id, page.id);

const cellPath = `/pages/${child.id}/column/${column.id}/value`;
const createdCell = await call<Schema.DecodedColumnValue>("POST", cellPath, ownerToken, 201, {
  value: "Primeiro valor",
});
assert.equal(createdCell.value, "Primeiro valor");
await call("POST", cellPath, ownerToken, 409, { value: "Duplicado" });

const fetchedCell = await call<Schema.DecodedColumnValue>("GET", cellPath, ownerToken, 200);
assert.equal(fetchedCell.value, "Primeiro valor");
const changedCell = await call<Schema.DecodedColumnValue>("PUT", cellPath, ownerToken, 200, {
  value: "Valor atualizado",
});
assert.equal(changedCell.value, "Valor atualizado");

const dataset = await call<Array<{
  page_id: string;
  page_title: string | null;
  page_columns: Record<string, { row_data: string }>;
}>>("GET", `/pages/${page.id}/page`, ownerToken, 200);
const persistedRow = dataset.find((row) => row.page_id === child.id);
assert.ok(persistedRow);
assert.ok(column.id in persistedRow.page_columns);

const [databaseRows] = await db.sqlRaw<{
  page_updated_at: string;
  column_updated_at: string;
  cell_data: string;
}>(
  {
    text: `SELECT page.updated_at AS page_updated_at,
      column.updated_at AS column_updated_at, cell.data AS cell_data
      FROM pages page
      JOIN page_columns column ON column.parent_id = page.id
      JOIN page_columns_values cell ON cell.page_column_id = column.id
      WHERE page.id = ? AND column.id = ? AND cell.page_id = ?`,
    values: [page.id, column.id, child.id],
  },
  "query",
);
assert.ok(databaseRows);
assert.notEqual(databaseRows.page_updated_at.toUpperCase(), "CURRENT_TIMESTAMP");
assert.notEqual(databaseRows.column_updated_at.toUpperCase(), "CURRENT_TIMESTAMP");
assert.deepEqual(JSON.parse(databaseRows.cell_data), { value: "Valor atualizado" });

await call("DELETE", cellPath, ownerToken, 204);
await call("DELETE", `/pages/parent/${page.id}/columns/${column.id}`, ownerToken, 204);
await call("DELETE", `/pages/${child.id}`, ownerToken, 204);
await call("DELETE", `/pages/${page.id}`, ownerToken, 204);

console.log("Smoke HTTP de Page aprovado: CRUD, views, hierarquia, coluna, célula, acesso e persistência.");
console.log(`page=${page.id}`);
console.log(`child=${child.id}`);
console.log(`column=${column.id}`);
