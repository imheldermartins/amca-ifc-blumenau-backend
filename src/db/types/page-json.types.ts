export interface PageColumnJsonUpdate {
  id: string;
  data: Record<string, unknown>;
}

export interface PageJsonPathUpdate {
  path: readonly string[];
  value: unknown;
}
