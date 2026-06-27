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
}
