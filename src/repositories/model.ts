import {CompatibilityModel} from '@cubs/rqlite-client/compat';
import type {TableDescriptor} from '@cubs/rqlite-client/schema';
import sql,{rqlite} from '../db/client-db.js';
import type {ModelOptions,MutationOptions} from '@cubs/rqlite-client/compat';
export type {ModelOptions,MutationOptions} from '@cubs/rqlite-client/compat';

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

// Cub's supplies only its page transaction guards and the old response contract.
export class Model<T> extends CompatibilityModel<T> {
 constructor(table:string|TableDescriptor,options?:ModelOptions<T>){super(table,{query:sql,mutate:executeMutation,mutateAndRead:executeMutationAndRead},options);}
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
