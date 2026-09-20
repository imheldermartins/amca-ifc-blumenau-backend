export type RqliteEndpoint = "query" | "execute" | "request";

export interface RqliteOptions {
  transaction?: boolean;
}
