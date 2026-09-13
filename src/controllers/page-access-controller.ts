import accessStore from "@db/scoped-access-store";
import db from "@models/index";

// ULID (26 chars, alfabeto Crockford) -- mesmo guarda dos demais controllers.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** Consultas de acesso delegadas à política de roles e herança por escopo. */
class PageAccessController {
  /** Falhas de consulta negam o acesso; ownership e roles são resolvidos no banco. */
  async canAccessPage(userId: string, pageId: string): Promise<boolean> {
    if (!ULID_RE.test(userId) || !ULID_RE.test(pageId)) return false;

    try {
      return await accessStore.can("page", pageId, userId, "read", "view");
    } catch (error) {
      // Falha de infra NUNCA vira permissão: nega e deixa o log contar por quê.
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return false;
    }
  }

  /**
   * Parent DIRETO de uma página (ou `null` na raiz). É o que decide a SALA de
   * um evento de célula: quem edita a linha `X` mexe na tabela que está aberta
   * — a página parent —, e é essa sala que os espectadores assinaram.
   */
  async getParentId(pageId: string): Promise<string | null> {
    if (!ULID_RE.test(pageId)) return null;

    try {
      const rows = await db.sqlRaw<{ parent_id: string }>(
        { text: `SELECT parent_id FROM page_edges WHERE child_id = ? LIMIT 1`, values: [pageId] },
        "query",
      );
      return rows?.[0]?.parent_id ?? null;
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  /**
   * Páginas que o usuário acessa como COLABORADOR (e não como dono) — a aba
   * "Colaborando" do frontend. Traz o dono junto porque o card mostra de quem
   * é a página; `password_hash` fica de fora por construção (SELECT explícito).
   */
  async listSharedPages(userId: string): Promise<SharedPage[] | null> {
    if (!ULID_RE.test(userId)) return [];

    try {
      const text =
        `SELECT p.id, p.title, p.owner_id, u.name AS owner_name, u.email AS owner_email ` +
        `FROM page_collaborators pc ` +
        `JOIN pages p ON p.id = pc.page_id ` +
        `JOIN users u ON u.id = p.owner_id ` +
        `WHERE pc.user_id = ? AND pc.deleted_at IS NULL AND p.owner_id <> ? AND p.deleted_at IS NULL ` +
        `ORDER BY p.title`;

      const rows = await db.sqlRaw<SharedPage>({ text, values: [userId, userId] }, "query");
      const visible = await Promise.all((rows ?? []).map(async row => await this.canAccessPage(userId, row.id) ? row : null));
      return visible.filter((row): row is SharedPage => row !== null);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }
}

/** Página compartilhada COMIGO, com o dono resolvido para exibição. */
export interface SharedPage {
  id: string;
  title: string | null;
  owner_id: string;
  owner_name: string | null;
  owner_email: string;
}

export default new PageAccessController();
