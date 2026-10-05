import pageDocumentStore, { PageDocumentStore } from '@/repositories/page-document-repository';
import { isJsonRecord, isUlid } from '@/services/pages/views/page-view-parsers';

export class PageDocumentController {
  public constructor(private readonly documents: PageDocumentStore = pageDocumentStore) {}

  public async get(pageId: string) {
    if (!isUlid(pageId)) return { ok: false as const, reason: 'validation' as const, message: 'Página inválida' };
    try {
      return { ok: true as const, data: await this.documents.find(pageId) };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false as const, reason: 'server_error' as const, message: 'Erro no servidor' };
    }
  }

  public async save(pageId: string, body: unknown) {
    if (!isUlid(pageId) || !isJsonRecord(body) || !isJsonRecord(body.content)) {
      return { ok: false as const, reason: 'validation' as const, message: 'Documento inválido' };
    }
    let encoded: string;
    try { encoded = JSON.stringify(body.content); } catch { encoded = ''; }
    if (!encoded || encoded.length > 240_000 || body.content.type !== 'doc') {
      return { ok: false as const, reason: 'validation' as const, message: 'Documento inválido' };
    }
    try {
      const saved = await this.documents.save(pageId, body.content);
      return saved
        ? { ok: true as const, data: saved }
        : { ok: false as const, reason: 'not_found' as const, message: 'Página não encontrada' };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false as const, reason: 'server_error' as const, message: 'Erro no servidor' };
    }
  }
}

export default new PageDocumentController();
