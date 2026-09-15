import { SQLBuilder } from "@db/sql-builder";
import sql, { rqlite } from "@/core/db/shared";
import { ulid } from "ulid";
import {
  HardDeleteSolution,
  type DeleteSolution,
} from "@db/soft-delete-solution";

export interface ModelOptions<T> {
  jsonColumns?: (keyof T)[];
  /** Estratégia de exclusão/escopo. Ausente mantém o DELETE físico legado. */
  deleteSolution?: DeleteSolution<T>;
}

export interface MutationOptions {
  before?: readonly SqlStatement[];
  /** Escritas de domínio que precisam compartilhar a transação do Model. */
  after?: readonly RqliteStatement[];
}

function wire(statement: SqlStatement): RqliteStatement {
  return [statement.text, ...statement.values];
}

async function executeMutation(statement: SqlStatement, options?: MutationOptions): Promise<boolean> {
  if (!options?.before?.length && !options?.after?.length) return !!await sql(statement);
  const writes: RqliteStatement[] = [
    ...(options.before ?? []).map(wire),
    wire(statement),
    ...(options.after ?? []),
  ];
  // Em um batch transacional, zero linhas alteradas precisa lançar erro para
  // reverter todas as escritas anteriores, inclusive o relógio da parent.
  const statements: RqliteStatement[] = writes.flatMap((write) => [
    write,
    ["INSERT INTO pages (id, owner_id) SELECT '!', NULL WHERE changes() = 0"],
  ]);
  const results = await rqlite(statements, 'execute', { transaction: true });
  return results.length === statements.length && writes.every((_, index) => results[index * 2] === true);
}

async function executeMutationAndRead<T>(
  statement: SqlStatement,
  readStatement: SqlStatement,
  operation: 'Create' | 'Update',
  options?: MutationOptions,
): Promise<T | null> {
  const writes: RqliteStatement[] = [
    ...(options?.before ?? []).map(wire),
    wire(statement),
    ...(options?.after ?? []),
  ];
  const guardedWrites: RqliteStatement[] = options?.before?.length || options?.after?.length
    ? writes.flatMap((write) => [
        write,
        ["INSERT INTO pages (id, owner_id) SELECT '!', NULL WHERE changes() = 0"],
      ])
    : writes;

  // A mutação e o SELECT viajam no mesmo /db/request transacional. Em um
  // cluster, isso evita ler logo depois em uma réplica ainda atrasada e
  // responder erro embora a escrita já tenha sido confirmada pelo líder.
  const results = await rqlite<T>(
    [...guardedWrites, wire(readStatement)],
    'request',
    { transaction: true },
  );
  const rows = results[guardedWrites.length];
  const writesSucceeded = guardedWrites.length === writes.length
    ? writes.every((_, index) => results[index] === true)
    : writes.every((_, index) => results[index * 2] === true);
  if (!writesSucceeded || !Array.isArray(rows)) {
    throw new Error(`${operation}::Model response is null.`, { cause: 'MODELERROR' });
  }
  return rows[0] ?? null;
}

export class Model<T> {
  private sql: SQLBuilder<T>;
  // Colunas JSON: gravadas como texto (ver SQLBuilder.toSetValue) e
  // desserializadas de volta para objeto na leitura (ver deserialize).
  private jsonColumns: (keyof T)[];
  private deleteSolution: DeleteSolution<T>;

  public constructor(tableName: string, options?: ModelOptions<T>) {
    this.sql = new SQLBuilder(tableName);
    this.jsonColumns = options?.jsonColumns ?? [];
    this.deleteSolution = options?.deleteSolution ?? new HardDeleteSolution<T>();
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

  public async create(data: CreateValues<T>, options?: MutationOptions): Promise<T | null> {
    const id = ulid();

    // `data` pode trazer um id explícito (ex.: page_root usa o id da workspace);
    // como ele vem depois no spread, sobrescreve o ULID gerado. `insertedId` é,
    // portanto, o id que de fato foi para o banco.
    const insertedId = (data as { id?: unknown }).id ?? id;

    const payload = { id, ...data } as CreateValues<T>;

    const stmt = this.sql.create(payload);
    const read = this.sql.read({
      ...this.deleteSolution.scopeLookup({ id: insertedId } as unknown as LookupValues<T>),
      limit: 1,
    });
    return this.deserialize(await executeMutationAndRead<T>(stmt, read, 'Create', options));
  }

  public async find(lookup: LookupValues<T>): Promise<T | null> {
    const stmt = this.sql.read({ ...this.deleteSolution.scopeLookup(lookup), limit: 1 });

    const [row] = await sql<T>(stmt) as T[];

    return this.deserialize(row ?? null);
  }

  public async findAll(lookup?: LookupsConfig<T>): Promise<T[] | null> {
    const stmt = this.sql.read(this.deleteSolution.scopeRead(lookup));

    const rows = await sql<T>(stmt) as T[];

    return rows.map((row) => this.deserialize(row) as T);
  }

  public async update(values: UpdateValues<T>, lookup: LookupValues<T>, options?: MutationOptions): Promise<boolean> {
    const stmt = this.sql.update(values, this.deleteSolution.scopeLookup(lookup));

    const result = await executeMutation(stmt, options);

    return !!result;
  }

  /**
   * Atualiza e devolve a linha confirmada dentro do mesmo `/db/request`.
   * Isso impede um falso 404 quando o UPDATE foi confirmado pelo líder, mas
   * uma leitura subsequente alcançaria uma réplica ainda atrasada.
   */
  public async updateAndFind(
    values: UpdateValues<T>,
    lookup: LookupValues<T>,
    options?: MutationOptions,
  ): Promise<T | null> {
    const scopedLookup = this.deleteSolution.scopeLookup(lookup);
    const stmt = this.sql.update(values, scopedLookup);
    const read = this.sql.read({ ...scopedLookup, limit: 1 });

    return this.deserialize(await executeMutationAndRead<T>(stmt, read, 'Update', options));
  }

  public async delete(lookup: LookupValues<T>, options?: MutationOptions): Promise<boolean> {
    const scopedLookup = this.deleteSolution.scopeLookup(lookup);
    const stmt = this.deleteSolution.statement(this.sql, scopedLookup);

    const result = await executeMutation(stmt, options);

    return !!result;
  }

  /**
   * Exceção sancionada à regra "SQL só dentro de core/db": executa uma query
   * crua (joins/agregações que o Model/relations não cobre). O executor (sql)
   * continua aqui, em core/db -- quem chama apenas fornece a string SQL.
   * Re-exportado como `db.sqlRaw` em models/index.ts.
   */
  public static async sqlRaw<R = unknown>(
    query: string | SqlStatement,
    endpoint: "query" | "execute" | "request" = "request",
  ): Promise<R[]> {
    // Aceita string crua OU statement parametrizado ({ text, values }). Prefira
    // o parametrizado quando a query levar input do usuário (ex.: breadcrumb),
    // pelo mesmo motivo do resto da camada: bind, nunca concatenação.
    const rows = await sql<R>(query, endpoint);
    return Array.isArray(rows) ? rows : [];
  }
}
