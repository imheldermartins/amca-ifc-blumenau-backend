import store, {PageViewRowMoveError, PageViewRowMoveStore} from '@/repositories/page-view-row-move-repository';
import type {PageViewRowMoveInput, PageViewRowMoveResult} from '@/services/pages/views/page-view-query-contract';
import {isJsonRecord, isUlid} from '@/services/pages/views/page-view-parsers';
import type {ServiceResult} from '@/controllers/types/service-result.types';

export function parsePageViewRowMove(raw: unknown): PageViewRowMoveInput {
  if (!isJsonRecord(raw) || Object.keys(raw).some((key) => !['rowId','beforeId','afterId','boundary','expectedOrderRevision','targetOptionId','previousOptionId'].includes(key))
    || !isUlid(raw.rowId) || !Number.isSafeInteger(raw.expectedOrderRevision) || Number(raw.expectedOrderRevision) < 0
    || (raw.beforeId !== undefined && (!isUlid(raw.beforeId) || raw.beforeId === raw.rowId))
    || (raw.afterId !== undefined && (!isUlid(raw.afterId) || raw.afterId === raw.rowId))
    || (raw.boundary !== undefined && !['start', 'end'].includes(String(raw.boundary)))
    || [raw.beforeId, raw.afterId, raw.boundary].filter((value) => value !== undefined).length > 1
    || (raw.targetOptionId !== undefined && raw.targetOptionId !== null && !isUlid(raw.targetOptionId))
    || (raw.previousOptionId !== undefined && raw.previousOptionId !== null && !isUlid(raw.previousOptionId))
    || (Object.prototype.hasOwnProperty.call(raw, 'targetOptionId') && !Object.prototype.hasOwnProperty.call(raw, 'previousOptionId'))) {
    throw new PageViewRowMoveError('validation', 'Movimento de página inválido');
  }
  return raw as unknown as PageViewRowMoveInput;
}

export class PageViewRowMoveController {
  constructor(private readonly positions: PageViewRowMoveStore = store) {}
  async move(parentId: string, viewId: string, userId: string, raw: unknown): Promise<ServiceResult<PageViewRowMoveResult> & {confirmed?: PageViewRowMoveResult}> {
    try {
      if (!isUlid(parentId) || !isUlid(viewId) || !isUlid(userId)) throw new PageViewRowMoveError('validation', 'Página ou view inválida');
      return {ok: true, data: await this.positions.move(parentId, viewId, userId, parsePageViewRowMove(raw))};
    } catch (error) {
      if (error instanceof PageViewRowMoveError) return {ok: false, reason: error.reason, message: error.message,
        ...(error.confirmed && {confirmed: error.confirmed})};
      console.error('[page-view-row-move] Movimento não confirmado', error instanceof Error ? error.message : error);
      return {ok: false, reason: 'server_error', message: 'Erro no servidor'};
    }
  }
}
export default new PageViewRowMoveController();
