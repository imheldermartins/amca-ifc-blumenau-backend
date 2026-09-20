import type { SQLBuilder } from "@db/sql-builder";

export interface DeleteSolution<T> {
  scopeRead(lookup?: LookupsConfig<T>): LookupsConfig<T> | undefined;
  scopeLookup(lookup: LookupValues<T>): LookupValues<T>;
  statement(sql: SQLBuilder<T>, lookup: LookupValues<T>): SqlStatement;
}
