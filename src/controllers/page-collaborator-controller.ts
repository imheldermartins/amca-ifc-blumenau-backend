import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

// ULID (26 chars, alfabeto Crockford) -- mesmo guarda usado no page-controller.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export interface AddCollaboratorsResult {
  added: Schema.PageCollaborator[]; // vínculos criados agora
  skipped: string[];                // user_ids que já colaboravam (idempotência)
}

/**
 * page_collaborators: camada de service (padrão do repo) para o vínculo N:N de
 * acesso entre páginas e usuários. As rotas ficam sob /pages/:id/collaborators:
 *   - listCollaborators  (GET lista)      -> resumo do USUÁRIO { id, name, email }
 *   - getCollaborator    (GET detalhe)    -> a linha de page_collaborators (o vínculo)
 *   - addCollaborators   (POST em lote)   -> 201 { added, skipped }
 *   - removeCollaborator (DELETE unitário)-> 204
 *
 * Nas rotas unitárias, `:collaboratorId` é sempre o `user_id` -- o mesmo id que
 * entra no POST. Devolve ServiceResult onde a falha precisa virar status (a rota
 * mapeia reason -> StatusCode).
 */
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
        `WHERE pc.page_id = ? ` +
        `ORDER BY u.name`;

      return await db.sqlRaw<Schema.PageCollaboratorSummary>({ text, values: [pageId] }, "query");
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
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

  async addCollaborators(
    pageId: string,
    userIds: unknown,
  ): Promise<ServiceResult<AddCollaboratorsResult>> {
    if (!ULID_RE.test(pageId)) {
      return { ok: false, reason: "validation", message: "id de página inválido" };
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return { ok: false, reason: "validation", message: "userIds deve ser uma lista não vazia" };
    }

    // Dedupe preservando a ordem de chegada.
    const ids = [...new Set(userIds)];

    for (const id of ids) {
      if (typeof id !== "string" || !ULID_RE.test(id)) {
        return { ok: false, reason: "validation", message: `userId inválido: "${String(id)}"` };
      }
    }

    const page = await db.pages.find({ id: pageId } as LookupValues<Schema.Page>);
    if (!page) {
      return { ok: false, reason: "not_found", message: `"Page" não encontrado` };
    }

    // Todos os usuários precisam existir ANTES de qualquer escrita -- evita
    // vínculos órfãos (a FK do rqlite não é reforçada por padrão) e mantém o
    // lote atômico do ponto de vista do cliente.
    for (const userId of ids) {
      const user = await db.users.find({ id: userId } as LookupValues<Schema.User>);
      if (!user) {
        return { ok: false, reason: "not_found", message: `Usuário "${userId}" não encontrado` };
      }
    }

    try {
      const added: Schema.PageCollaborator[] = [];
      const skipped: string[] = [];

      for (const userId of ids) {
        const existing = await this.findLink(pageId, userId);
        if (existing) {
          skipped.push(userId);
          continue;
        }

        const created = await this.db.create({
          page_id: pageId,
          user_id: userId,
        } as unknown as CreateValues<Schema.PageCollaborator>);
        if (!created) return { ok: false, reason: "server_error", message: "Erro no servidor" };

        added.push(created);
      }

      return { ok: true, data: { added, skipped } };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async removeCollaborator(pageId: string, collaboratorId: string): Promise<ServiceResult<null>> {
    if (!ULID_RE.test(pageId) || !ULID_RE.test(collaboratorId)) {
      return { ok: false, reason: "validation", message: "id inválido" };
    }

    try {
      const link = await this.findLink(pageId, collaboratorId);
      if (!link) {
        return { ok: false, reason: "not_found", message: `"Page_collaborator" não encontrado` };
      }

      const deleted = await this.db.delete({ id: link.id } as LookupValues<Schema.PageCollaborator>);
      if (!deleted) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: null };
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
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageCollaboratorController();
