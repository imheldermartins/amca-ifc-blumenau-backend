import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

// ULID (26 chars, alfabeto Crockford) -- mesmo guarda usado no page-controller.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function exactEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return clean.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : null;
}

/** Consultas dos vínculos de página. Escritas passam por RoleStore. */
class PageCollaboratorController {
  private db: Model<Schema.PageCollaborator> = db.pageCollaborators;

  /**
   * Colaboradores da página como RESUMO DO USUÁRIO (id/name/email), não como
   * vínculo: é o que a UI precisa pra listar gente. JOIN com `users` via
   * `db.sqlRaw` (exceção sancionada) PARAMETRIZADO -- o id da URL vai por bind,
   * nunca concatenado. `password_hash` fica de fora por construção (SELECT
   * explícito).
   */
  async listCollaborators(pageId: string): Promise<Schema.PageCollaboratorSummary[] | null> {
    try {
      if (!ULID_RE.test(pageId)) return [];

      const text =
        `SELECT u.id, u.name, u.email ` +
        `FROM page_collaborators pc ` +
        `JOIN users u ON u.id = pc.user_id ` +
        `WHERE pc.page_id = ? AND pc.deleted_at IS NULL ` +
        `ORDER BY u.name`;

      return await db.sqlRaw<Schema.PageCollaboratorSummary>({ text, values: [pageId] }, "query");
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  /**
   * Candidatos vêm exclusivamente da workspace à qual a árvore desta página
   * pertence. O owner e quem já colabora são omitidos; a busca mantém a mesma
   * prioridade prefixo -> ocorrência usada na gestão da organização.
   */
  async listCandidates(
    pageId: string,
    query: unknown,
  ): Promise<ServiceResult<Schema.PageCollaboratorSummary[]>> {
    const email = exactEmail(query);
    if (!ULID_RE.test(pageId) || !email) {
      return { ok: false, reason: "validation", message: "Busca inválida" };
    }

    try {
      const workspaceId = await this.resolveWorkspaceId(pageId);
      if (!workspaceId) {
        return { ok: false, reason: "not_found", message: "Workspace da página não encontrada" };
      }

      const text =
        `SELECT u.id, u.name, u.email ` +
        `FROM workspace_members wm ` +
        `JOIN users u ON u.id = wm.user_id ` +
        `JOIN pages selected_page ON selected_page.id = ? AND selected_page.deleted_at IS NULL ` +
        `WHERE wm.workspace_id = ? AND wm.deleted_at IS NULL AND u.email_verified_at IS NOT NULL AND u.id <> selected_page.owner_id ` +
        `AND NOT EXISTS (` +
          `SELECT 1 FROM page_collaborators pc ` +
          `WHERE pc.page_id = selected_page.id AND pc.user_id = u.id AND pc.deleted_at IS NULL` +
        `) ` +
        `AND lower(trim(u.email)) = ? LIMIT 1`;
      const rows = await db.sqlRaw<Schema.PageCollaboratorSummary>({
        text,
        values: [
          pageId,
          workspaceId,
          email,
        ],
      }, "query");
      return { ok: true, data: rows ?? [] };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  /** Detalhe do VÍNCULO (linha de page_collaborators) do par (página, usuário). */
  async getCollaborator(
    pageId: string,
    collaboratorId: string,
  ): Promise<ServiceResult<Schema.PageCollaborator>> {
    if (!ULID_RE.test(pageId) || !ULID_RE.test(collaboratorId)) {
      return { ok: false, reason: "validation", message: "id inválido" };
    }

    try {
      const link = await this.findLink(pageId, collaboratorId);
      if (!link) {
        return { ok: false, reason: "not_found", message: `"Page_collaborator" não encontrado` };
      }

      return { ok: true, data: link };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  // O vínculo é o par (page_id, user_id) -- único no banco.
  private async findLink(pageId: string, userId: string) {
    return this.db.find(
      { page_id: pageId, user_id: userId } as LookupValues<Schema.PageCollaborator>,
    );
  }

  /** Resolve a workspace pela page-root encontrada entre a página e seus ancestrais. */
  private async resolveWorkspaceId(pageId: string): Promise<string | null> {
    const text =
      `WITH RECURSIVE branch(id) AS (` +
        `SELECT p.id FROM pages p WHERE p.id = ? AND p.deleted_at IS NULL ` +
        `UNION ` +
        `SELECT pe.parent_id FROM page_edges pe ` +
        `JOIN branch child ON child.id = pe.child_id ` +
        `JOIN pages parent ON parent.id = pe.parent_id AND parent.deleted_at IS NULL` +
      `) ` +
      `SELECT wm.workspace_id ` +
      `FROM workspace_members wm JOIN branch ON branch.id = wm.page_root_id WHERE wm.deleted_at IS NULL ` +
      `LIMIT 1`;
    const rows = await db.sqlRaw<{ workspace_id: string }>(
      { text, values: [pageId] },
      "query",
    );
    return rows?.[0]?.workspace_id ?? null;
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageCollaboratorController();
