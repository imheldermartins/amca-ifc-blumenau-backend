import type { Schema } from "@/db/schemas/index";
import type { ServiceResult } from "@/controllers/types/service-result.types";
import pageCollaboratorStore from "@/db/repositories/page-collaborator-store";
import type { PageCollaboratorStoreContract } from "@/db/types/page-collaborator-store.types";
import roleStore, { type RoleStore } from "@/db/repositories/role-store";

// ULID (26 chars, alfabeto Crockford) -- mesmo guarda usado no page-controller.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function isUlid(value: string): value is NonEmptyString {
  return ULID_RE.test(value);
}

function exactEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return clean.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : null;
}

/** Consultas dos vínculos de página. Escritas passam por RoleStore. */
export class PageCollaboratorController {
  public constructor(
    private readonly collaborators: PageCollaboratorStoreContract = pageCollaboratorStore,
    private readonly roles: RoleStore = roleStore,
  ) {}

  public async removeCollaborator(
    pageId: string,
    actorId: string,
    collaboratorId: string,
  ): Promise<ServiceResult<null>> {
    if (!isUlid(pageId) || !isUlid(actorId) || !isUlid(collaboratorId)) {
      return { ok: false, reason: "validation", message: "id inválido" };
    }

    try {
      const removed = await this.roles.removeMember("page", pageId, actorId, collaboratorId);
      return removed
        ? { ok: true, data: null }
        : { ok: false, reason: "forbidden", message: "Acesso não permitido" };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  /**
   * Colaboradores da página como RESUMO DO USUÁRIO (id/name/email), não como
   * vínculo: é o que a UI precisa pra listar gente. A store faz o JOIN
   * parametrizado e seleciona explicitamente apenas os campos públicos.
   */
  async listCollaborators(pageId: string): Promise<Schema.PageCollaboratorSummary[] | null> {
    try {
      if (!isUlid(pageId)) return [];

      return await this.collaborators.listCollaborators(pageId);
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
    if (!isUlid(pageId) || !email) {
      return { ok: false, reason: "validation", message: "Busca inválida" };
    }

    try {
      const workspaceId = await this.collaborators.resolveWorkspaceId(pageId);
      if (!workspaceId) {
        return { ok: false, reason: "not_found", message: "Workspace da página não encontrada" };
      }

      const rows = await this.collaborators.listCandidates(pageId, workspaceId, email);
      return { ok: true, data: rows };
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
    if (!isUlid(pageId) || !isUlid(collaboratorId)) {
      return { ok: false, reason: "validation", message: "id inválido" };
    }

    try {
      const link = await this.collaborators.findLink(pageId, collaboratorId);
      if (!link) {
        return { ok: false, reason: "not_found", message: `"Page_collaborator" não encontrado` };
      }

      return { ok: true, data: link };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageCollaboratorController();
