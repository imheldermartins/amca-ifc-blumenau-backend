import type { Schema } from "@/models/schemas/index";

/**
 * Camada TEMPORÁRIA de tipos de PAYLOAD de request (DTOs de ENTRADA).
 * Planejada para ser substituída por tipos inferidos via `z.infer` (Zod).
 *
 * Diferem de `Schema` (forma no banco): aqui ficam APENAS os campos que o
 * cliente realmente envia. Campos auto-gerenciados (`id`, `created_at`,
 * `updated_at`) e os derivados do contexto de auth (`owner_id`, sempre vindo
 * do token) NUNCA entram pelo body -- por isso não aparecem nestes DTOs.
 */
export namespace Input {
  // --- Pages ---
  export type CreatePage = Partial<Pick<Schema.Page, "title" | "data">>;
  export type UpdatePage = CreatePage;
  export type CreateChildPage = CreatePage;
  export type PageRootQuery = Partial<Pick<Schema.Page, "title">>;

  // --- Workspaces ---
  export type CreateWorkspace = Partial<Pick<Schema.Workspace, "name" | "data">>;
  export type UpdateWorkspace = CreateWorkspace;

  // --- Users (criação é só via /auth/register; aqui é o update administrativo) ---
  export type UpdateUser = Partial<Pick<Schema.User, "name" | "email">>;

  // --- Page Columns (payload dinâmico por tipo; `type` normalmente vem da ?type) ---
  // select  -> { options: [{ value, color? }] }  (id gerado no backend)
  // numeric -> { format? }                        ('percentage' | 'currency')
  // text/date/checkbox -> sem config
  export type CreatePageColumn = {
    name?: string | null;
    type?: Schema.ColumnType;
    options?: { value: string; color?: Schema.ColorOptions }[];
    format?: Schema.NumberFormat;
    page_root_id?: Schema.PageColumn["page_root_id"];
  };
  export type UpdatePageColumn = Omit<CreatePageColumn, "page_root_id">;

  // --- Page Columns Values (valor "nu", dinâmico por tipo; sem ?type) ---
  // date  -> { startDate, endDate } vira "start@end" (ou só value); demais -> { value }
  export type CreatePageColumnValue = Pick<Schema.PageColumnValue, "page_id" | "page_column_id"> & {
    value?: unknown;
    startDate?: string;
    endDate?: string;
  };
  export type UpdatePageColumnValue = Partial<Pick<Schema.PageColumnValue, "page_column_id">> & {
    value?: unknown;
    startDate?: string;
    endDate?: string;
  };
}
