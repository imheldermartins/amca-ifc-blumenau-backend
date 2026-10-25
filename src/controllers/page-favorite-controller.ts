import favorites, { PageFavoriteStore, type FavoriteCursor } from '@/repositories/page-favorite-repository';
import { isJsonRecord, isUlid } from '@/services/pages/views/page-view-parsers';

export class PageFavoriteController {
  constructor(private readonly store: PageFavoriteStore = favorites) {}
  async list(actor: string, query: unknown) {
    if (!isJsonRecord(query) || Object.keys(query).some((key) => !['limit', 'cursor'].includes(key))) return { status: 400, data: { message: 'Paginação inválida' } };
    const limit = query.limit === undefined ? 50 : typeof query.limit === 'string' ? Number(query.limit) : NaN;
    let cursor: FavoriteCursor | undefined;
    try {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid limit');
      if (query.cursor !== undefined) {
        if (typeof query.cursor !== 'string' || query.cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error('Invalid cursor');
        const value: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
        if (!isJsonRecord(value) || Object.keys(value).some((key) => !['id', 'at'].includes(key)) || !isUlid(value.id)
          || typeof value.at !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(value.at)) throw new Error('Invalid cursor');
        cursor = { id: value.id, at: value.at };
      }
    } catch { return { status: 400, data: { message: 'Paginação inválida' } }; }
    try { return { status: 200, data: await this.store.list(actor, limit, cursor) }; }
    catch { return { status: 500, data: { message: 'Não foi possível carregar os favoritos' } }; }
  }
  async state(actor: string, pageId: string) {
    if (!isUlid(pageId)) return { status: 400, data: { message: 'Página inválida' } };
    try {
      const favorite = await this.store.state(actor, pageId);
      return favorite === null ? { status: 404, data: { message: 'Página não encontrada' } } : { status: 200, data: { pageId, favorite } };
    } catch { return { status: 500, data: { message: 'Não foi possível carregar o favorito' } }; }
  }
  async set(actor: string, pageId: string, favorite: boolean) {
    if (!isUlid(pageId)) return { status: 400, data: { message: 'Página inválida' } };
    try {
      if (favorite && !await this.store.add(actor, pageId)) return { status: 404, data: { message: 'Página não encontrada' } };
      if (!favorite) await this.store.remove(actor, pageId);
      return { status: 200, data: { pageId, favorite } };
    } catch { return { status: 500, data: { message: 'Não foi possível atualizar o favorito' } }; }
  }
}
export default new PageFavoriteController();
