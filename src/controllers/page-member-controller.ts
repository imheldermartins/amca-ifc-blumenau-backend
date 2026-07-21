import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

// ULID (26 chars, alfabeto Crockford) -- mesmo guarda usado no page-controller.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export interface AddMembersResult {
  added: Schema.PageMember[]; // vínculos criados agora
  skipped: string[];          // user_ids que já eram membros (idempotência)
}

/**
 * page_members: camada de service (padrão do repo) para o vínculo N:N de acesso
 * entre páginas e usuários. As rotas ficam sob /pages/:id/members:
 *   - listMembers  (GET lista)      -> resumo do USUÁRIO { id, name, email }
 *   - getMember    (GET detalhe)    -> a linha de page_members (o vínculo)
 *   - addMembers   (POST em lote)   -> 201 { added, skipped }
 *   - removeMember (DELETE unitário)-> 204
 *
 * Nas rotas unitárias, `:memberId` é sempre o `user_id` -- o mesmo id que entra
 * no POST. Devolve ServiceResult onde a falha precisa virar status (a rota
 * mapeia reason -> StatusCode).
 */
class PageMemberController {
  private db: Model<Schema.PageMember> = db.pageMembers;

  /**
   * Membros da página como RESUMO DO USUÁRIO (id/name/email), não como vínculo:
   * é o que a UI precisa pra listar gente. JOIN com `users` via `db.sqlRaw`
   * (exceção sancionada) PARAMETRIZADO -- o id da URL vai por bind, nunca
   * concatenado. `password_hash` fica de fora por construção (SELECT explícito).
   */
  async listMembers(pageId: string): Promise<Schema.PageMemberSummary[] | null> {
    try {
      if (!ULID_RE.test(pageId)) return [];

      const text =
        `SELECT u.id, u.name, u.email ` +
        `FROM page_members pm ` +
        `JOIN users u ON u.id = pm.user_id ` +
        `WHERE pm.page_id = ? ` +
        `ORDER BY u.name`;

      return await db.sqlRaw<Schema.PageMemberSummary>({ text, values: [pageId] }, "query");
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  /** Detalhe do VÍNCULO (linha de page_members) do par (página, usuário). */
  async getMember(pageId: string, memberId: string): Promise<ServiceResult<Schema.PageMember>> {
    if (!ULID_RE.test(pageId) || !ULID_RE.test(memberId)) {
      return { ok: false, reason: "validation", message: "id inválido" };
    }

    try {
      const membership = await this.findMembership(pageId, memberId);
      if (!membership) {
        return { ok: false, reason: "not_found", message: `"Page_member" não encontrado` };
      }

      return { ok: true, data: membership };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async addMembers(pageId: string, userIds: unknown): Promise<ServiceResult<AddMembersResult>> {
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
      const added: Schema.PageMember[] = [];
      const skipped: string[] = [];

      for (const userId of ids) {
        const existing = await this.findMembership(pageId, userId);
        if (existing) {
          skipped.push(userId);
          continue;
        }

        const created = await this.db.create({
          page_id: pageId,
          user_id: userId,
        } as unknown as CreateValues<Schema.PageMember>);
        if (!created) return { ok: false, reason: "server_error", message: "Erro no servidor" };

        added.push(created);
      }

      return { ok: true, data: { added, skipped } };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async removeMember(pageId: string, memberId: string): Promise<ServiceResult<null>> {
    if (!ULID_RE.test(pageId) || !ULID_RE.test(memberId)) {
      return { ok: false, reason: "validation", message: "id inválido" };
    }

    try {
      const membership = await this.findMembership(pageId, memberId);
      if (!membership) {
        return { ok: false, reason: "not_found", message: `"Page_member" não encontrado` };
      }

      const deleted = await this.db.delete({ id: membership.id } as LookupValues<Schema.PageMember>);
      if (!deleted) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: null };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  // O vínculo é o par (page_id, user_id) -- único no banco.
  private async findMembership(pageId: string, userId: string) {
    return this.db.find(
      { page_id: pageId, user_id: userId } as LookupValues<Schema.PageMember>,
    );
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageMemberController();
