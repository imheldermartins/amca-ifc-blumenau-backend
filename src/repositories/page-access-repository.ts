import { rqlite } from "@/db/client-db";
import type { SharedPage } from "@/repositories/types/page-access-repository.types";

/** Consultas persistidas que alimentam a política de acesso a páginas. */
export class PageAccessStore {
  public async listDirectSharesForUser(userId: string): Promise<SharedPage[]> {
    const [rows] = await rqlite<SharedPage>([[
      `SELECT p.id, p.title, p.owner_id, u.name AS owner_name, u.email AS owner_email
       FROM page_collaborators pc
       JOIN pages p ON p.id = pc.page_id
       JOIN users u ON u.id = p.owner_id
       WHERE pc.user_id = ?
         AND pc.deleted_at IS NULL
         AND p.owner_id <> ?
         AND p.deleted_at IS NULL
       ORDER BY p.title`,
      userId,
      userId,
    ]], "query");

    return rows ?? [];
  }
}

export default new PageAccessStore();
