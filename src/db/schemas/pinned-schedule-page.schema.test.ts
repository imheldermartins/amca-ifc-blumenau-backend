import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { loadChain } from "@cubs/rqlite-client/migrations";
import { expect, it } from "vitest";
import { ulid } from "ulid";

it("aplica FKs e unicidade de pinned_schedule_pages", async () => {
  const chain = await loadChain(fileURLToPath(new URL("../migrations", import.meta.url)));
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON");
    for (const migration of chain.migrations) {
      for (const statement of migration.up) {
        if (typeof statement !== "string") throw new Error("Migration inválida");
        database.exec(statement);
      }
    }

    const userId = ulid();
    const workspaceId = ulid();
    const pageId = ulid();
    const columnId = ulid();
    database.prepare("INSERT INTO users(id,email) VALUES(?,?)").run(userId, "pin@example.test");
    database.prepare("INSERT INTO pages(id,owner_id) VALUES(?,?)").run(pageId, userId);
    database.prepare("INSERT INTO workspaces(id,created_by_user_id) VALUES(?,?)").run(workspaceId, userId);
    database.prepare("INSERT INTO page_columns(id,type,parent_id) VALUES(?, 'date', ?)").run(columnId, pageId);

    const insert = database.prepare(`INSERT INTO pinned_schedule_pages(
      id, workspace_id, page_id, pinned_by_user_id, date_column_id
    ) VALUES(?,?,?,?,?)`);
    insert.run(ulid(), workspaceId, pageId, userId, columnId);
    expect(() => insert.run(ulid(), workspaceId, pageId, userId, columnId)).toThrow();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    database.close();
  }
});
