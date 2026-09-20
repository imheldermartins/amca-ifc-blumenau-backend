import type { DeleteSolution } from "@/core/db/types/soft-delete.types";

export interface ModelOptions<T> {
  jsonColumns?: (keyof T)[];
  deleteSolution?: DeleteSolution<T>;
}

export interface MutationOptions {
  before?: readonly SqlStatement[];
  after?: readonly RqliteStatement[];
}
