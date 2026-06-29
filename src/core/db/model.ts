import { SQLBuilder } from "@db/sql-builder";
import sql from "@/core/db/shared";
import { ulid } from "ulid";

export class Model<T> {
  private sql: SQLBuilder<T>;
  // Colunas JSON: gravadas como texto (ver SQLBuilder.toSetValue) e
  // desserializadas de volta para objeto na leitura (ver deserialize).
  private jsonColumns: (keyof T)[];

  public constructor(tableName: string, options?: { jsonColumns?: (keyof T)[] }) {
    this.sql = new SQLBuilder(tableName);
    this.jsonColumns = options?.jsonColumns ?? [];
  }

  /**
   * Converte as colunas JSON (string vinda do rqlite) de volta para objeto.
   * Tolerante: se o valor não for JSON válido, mantém o texto original.
   */
  private deserialize(row: T | null): T | null {
    if (!row || this.jsonColumns.length === 0) return row;

    const out = { ...row } as Record<string, unknown>;
    for (const column of this.jsonColumns) {
      const value = out[column as string];
      if (typeof value === "string") {
        try {
          out[column as string] = JSON.parse(value);
        } catch {
          /* não é JSON válido -- deixa como está */
        }
      }
    }

    return out as T;
  }

  public async create(data: CreateValues<T>): Promise<T | null> {
    const id = ulid();

    // `data` pode trazer um id explícito (ex.: page_root usa o id da workspace);
    // como ele vem depois no spread, sobrescreve o ULID gerado. `insertedId` é,
    // portanto, o id que de fato foi para o banco.
    const insertedId = (data as { id?: unknown }).id ?? id;

    const payload = { id, ...data } as CreateValues<T>;

    const raw = this.sql.create(payload);

    const result = await sql(raw);
    if (!result)
      throw new Error('Create::Model response is null.', { cause: 'MODELERROR' });

    // Recupera pela CHAVE inserida (não por todos os campos) -- confiável mesmo
    // com colunas JSON ou valores repetidos entre linhas.
    return this.find({ id: insertedId } as unknown as LookupValues<T>);
  }

  public async find(lookup: LookupValues<T>): Promise<T | null> {
    const raw = this.sql.read({ ...lookup, limit: 1 });

    const [row] = await sql<T>(raw) as T[];

    return this.deserialize(row ?? null);
  }

  public async findAll(lookup?: LookupsConfig<T>): Promise<T[] | null> {
    const raw = this.sql.read(lookup);

    const rows = await sql<T>(raw) as T[];

    return rows.map((row) => this.deserialize(row) as T);
  }

  public async update(values: UpdateValues<T>, lookup: LookupValues<T>): Promise<boolean> {
    const raw = this.sql.update(values, lookup);

    const result = await sql(raw);

    return !!result;
  }

  public async delete(lookup: LookupValues<T>): Promise<boolean> {
    const raw = this.sql.delete(lookup);

    const result = await sql(raw);

    return !!result;
  }

  /**
   * Exceção sancionada à regra "SQL só dentro de core/db": executa uma query
   * crua (joins/agregações que o Model/relations não cobre). O executor (sql)
   * continua aqui, em core/db -- quem chama apenas fornece a string SQL.
   * Re-exportado como `db.sqlRaw` em models/index.ts.
   */
  public static async sqlRaw<R = unknown>(
    query: string,
    endpoint: "query" | "execute" | "request" = "request",
  ): Promise<R[]> {
    const rows = await sql<R>(query, endpoint);
    return Array.isArray(rows) ? rows : [];
  }
}