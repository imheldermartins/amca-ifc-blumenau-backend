import type { Schema } from '@/db/schemas/index';
import type { JsonRecord } from '@/services/types/json.types';
import { isJsonRecord, isUlid, parseStringList } from '@/services/pages/views/page-view-parsers';
import { ViewFiltersValidationError } from '@/services/view-filters-v2';

export const BOARD_UNASSIGNED = '__unassigned__';

/** Only supplied fields are patched, never the complete board document. */
export function parseBoardPatch(raw: unknown, previous: unknown, columns: readonly Schema.PageColumn[]): JsonRecord {
  if (!isJsonRecord(raw)) throw new ViewFiltersValidationError('Configuração do Board inválida');
  if (Object.keys(raw).some((key) => !['selectColumnId', 'optionOrder', 'collapsedOptionIds', 'propertyIds', 'showPropertyLabels'].includes(key))) {
    throw new ViewFiltersValidationError('Configuração do Board contém campos desconhecidos');
  }
  const current = isJsonRecord(previous) ? previous : {};
  const patch: JsonRecord = {};
  const selectedId = raw.selectColumnId ?? current.selectColumnId;
  const column = selectedId === undefined ? columns.find((entry) => entry.type === 'select')
    : columns.find((entry) => entry.id === selectedId && entry.type === 'select');
  if (raw.selectColumnId !== undefined) {
    if (!isUlid(raw.selectColumnId) || !column) throw new ViewFiltersValidationError('Coluna select do Board inválida');
    patch.selectColumnId = raw.selectColumnId;
  }
  for (const key of ['optionOrder', 'collapsedOptionIds', 'propertyIds'] as const) {
    if (raw[key] === undefined) continue;
    const ids = parseStringList(raw[key], 'IDs do Board');
    if (ids.some((id) => key === 'propertyIds'
      ? !isUlid(id) || !columns.some((entry) => entry.id === id)
      : id !== BOARD_UNASSIGNED && (!isUlid(id) || !column?.data?.options?.some((option) => option.id === id)))) {
      throw new ViewFiltersValidationError('Propriedades ou opções do Board inválidas');
    }
    patch[key] = [...new Set(ids)];
  }
  if (raw.showPropertyLabels !== undefined) {
    if (typeof raw.showPropertyLabels !== 'boolean') throw new ViewFiltersValidationError('Visibilidade dos nomes do Board inválida');
    patch.showPropertyLabels = raw.showPropertyLabels;
  }
  return patch;
}
