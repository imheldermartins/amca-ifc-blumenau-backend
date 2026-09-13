import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rqlite } from "@db/shared";

export interface Migration {
  id: string;
  up: string[];
  down?: string[];
}

export class Migrator {

  private static readonly TABLE = '_migrations';

  private static get migrationsDir(): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.join(__dirname, 'migrations');
  }

  private static async ensureMigrationsTable(): Promise<void> {
    await rqlite<any>([
      `CREATE TABLE IF NOT EXISTS ${this.TABLE} (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`
    ], 'execute');
  }

  private static async getAppliedIds(): Promise<Set<string>> {
    const [rows] = await rqlite<{ id: string }>([`SELECT id FROM ${this.TABLE}`], 'query');
    return new Set((rows ?? []).map((r: any) => r.id));
  }

  private static async loadMigrationFiles(): Promise<Migration[]> {
    const dir = this.migrationsDir;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .sort(); // o timestamp no início do nome garante ordem cronológica

    const migrations: Migration[] = [];
    for (const file of files) {
      const fileUrl = pathToFileURL(path.join(dir, file)).href;
      const mod = await import(fileUrl);
      migrations.push(mod.migration as Migration);
    }
    return migrations;
  }

  static async build(): Promise<void> {
  try {
    await this.ensureMigrationsTable();

    const applied = await this.getAppliedIds();
    const all = await this.loadMigrationFiles();
    const pending = all.filter(m => !applied.has(m.id));

    if (pending.length === 0) {
      console.log('[Migrator] Nenhuma migration pendente.');
      return;
    }

    for (const migration of pending) {
      const statements = [
        ...migration.up,
        [`INSERT INTO ${this.TABLE} (id) VALUES (?)`, migration.id]
      ];

      await rqlite<any>(statements as any[], 'execute', { transaction: true });

      console.log(`Migration::${migration.id} aplicada com sucesso.`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[Migrator] ${error.message}`);
    }
    throw error;
  }
}
}
