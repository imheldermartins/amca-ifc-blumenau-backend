import db from "@models/index";

// ULID (26 chars, alfabeto Crockford) -- mesmo guarda dos demais controllers.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * Autorização de acesso a uma página.
 *
 * Regra única do sistema: tem acesso quem é DONO (`pages.owner_id`) **ou**
 * COLABORADOR (linha em `page_collaborators`). Antes disto, cada rota decidia
 * sozinha — `GET /pages/:id` filtrava por `owner_id` (e por isso um colaborador
 * nem conseguia abrir a base compartilhada), enquanto o dataset, as colunas e o
 * breadcrumb NÃO checavam nada: qualquer usuário autenticado lia a base de
 * qualquer página. As duas pontas se resolvem com a mesma pergunta.
 *
 * É também a porta do realtime: o join numa sala `page-database:{pageId}`
 * passa por aqui, senão bastaria adivinhar um id para escutar edição alheia.
 *
 * Uma consulta só (UNION ALL + LIMIT 1): responde no primeiro match, sem
 * carregar a página nem a lista de colaboradores.
 */
class PageAccessController {
  /**
   * O acesso é HERDADO pela árvore: vale para a página ou para QUALQUER
   * ancestral dela. É o que torna a tabela editável por um colaborador — a
   * base compartilhada é o parent, e cada LINHA é uma página filha que ninguém
   * compartilhou explicitamente. Sem a herança, o convidado abriria a base e
   * não conseguiria mexer em célula nenhuma.
   *
   * O CTE recursivo sobe por `page_edges` (mesmo padrão do breadcrumb), e o
   * `UNION ALL ... LIMIT 1` responde no primeiro match — dono OU colaborador.
   */
  async canAccessPage(userId: string, pageId: string): Promise<boolean> {
    if (!ULID_RE.test(userId) || !ULID_RE.test(pageId)) return false;

    try {
      const text =
        `WITH RECURSIVE branch(id) AS (` +
        `SELECT ? ` +
        `UNION ` +
        `SELECT pe.parent_id FROM page_edges pe JOIN branch b ON pe.child_id = b.id` +
        `) ` +
        `SELECT 1 AS ok FROM pages p JOIN branch b ON p.id = b.id WHERE p.owner_id = ? ` +
        `UNION ALL ` +
        `SELECT 1 AS ok FROM page_collaborators pc JOIN branch b ON pc.page_id = b.id WHERE pc.user_id = ? ` +
        `LIMIT 1`;

      const rows = await db.sqlRaw<{ ok: number }>(
        { text, values: [pageId, userId, userId] },
        "query",
      );

      return (rows?.length ?? 0) > 0;
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
        `WHERE pc.user_id = ? AND p.owner_id <> ? ` +
        `ORDER BY p.title`;

      return await db.sqlRaw<SharedPage>({ text, values: [userId, userId] }, "query");
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
