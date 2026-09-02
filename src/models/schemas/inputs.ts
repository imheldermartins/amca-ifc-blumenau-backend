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

  // --- Page Collaborators (page_collaborators) ---
  // POST /pages/:id/collaborators adiciona em lote: { userIds: [<ULID>, ...] }.
  // A remoção é unitária pela URL (/collaborators/:collaboratorId), sem body.
  export type AddPageCollaborators = { userIds?: string[] };

  // --- Page Columns (payload dinâmico por tipo; `type` normalmente vem da ?type) ---
  // select  -> { options: [{ value, color? }] }  (id gerado no backend)
  // numeric -> { format? } (+ { currency? } quando format = currency)
  // text    -> { mask? }
  // date/checkbox -> sem config
  //
  // O update é PARCIAL e o `data` ACUMULA (o buildData mescla): mandar só
  // `format` não apaga um `mask` já gravado. Ver page-column-controller.
  export type CreatePageColumn = {
    name?: string | null;
    type?: Schema.ColumnType;
    options?: { id?: string; value: string; color?: Schema.ColorOptions }[];
    format?: Schema.NumberFormat;
    currency?: Schema.CurrencyCode;
    mask?: Schema.TextMask;
    parent_id?: Schema.PageColumn["parent_id"];
  };

  // No UPDATE, cada config aceita `null` = LIMPAR aquela chave (ex.: tirar a
  // máscara). `undefined`/ausente = preserva. Ver mergeData no controller.
  export type UpdatePageColumn = {
    name?: string | null;
    type?: Schema.ColumnType;
    options?: { id?: string; value: string; color?: Schema.ColorOptions }[] | null;
    format?: Schema.NumberFormat | null;
    currency?: Schema.CurrencyCode | null;
    mask?: Schema.TextMask | null;
  };

  // --- Page Columns Values (valor "nu", dinâmico por tipo; sem ?type) ---
  // A célula (page_id, page_column_id) vem SEMPRE da URL -- única por banco.
  // date  -> { startDate, endDate } vira "start@end" (ou só value); demais -> { value }
  export type CreatePageColumnValue = Pick<Schema.PageColumnValue, "page_id" | "page_column_id"> & {
    value?: unknown;
    startDate?: string;
    endDate?: string;
  };
  export type UpdatePageColumnValue = {
    value?: unknown;
    startDate?: string;
    endDate?: string;
  };
}
