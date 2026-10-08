import type { Schema } from '@/db/schemas/index';
import type { FlowExecutionSource } from '@/repositories/types/flow-repository.types';
import type {
  FlowExecutionPlan,
  FlowExecutionRuntime,
} from '@/services/flows/types/flow-execution.types';
import { VALUE_CODECS } from '@/services/value-codec';

const isEmpty = (value: unknown): boolean => (
  value === null
  || value === undefined
  || value === ''
  || (Array.isArray(value) && value.length === 0)
);

export const compareFlowValues = (
  operator: Schema.FlowSwitchOperator,
  left: unknown,
  right: unknown,
): boolean => {
  switch (operator) {
    case 'is_empty':
      return isEmpty(left);
    case 'is_not_empty':
      return !isEmpty(left);
    case 'contains':
      return String(left ?? '').includes(String(right ?? ''));
    case 'greater_than':
    case 'less_than': {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
      return operator === 'greater_than' ? leftNumber > rightNumber : leftNumber < rightNumber;
    }
    case 'equals':
    case 'not_equals': {
      const equal = Object.is(left, right) || String(left ?? '') === String(right ?? '');
      return operator === 'equals' ? equal : !equal;
    }
  }
};

export const normalizeFlowCellValue = (
  type: Schema.ColumnType,
  value: unknown,
): unknown => {
  switch (type) {
    case 'numeric': {
      if (typeof value !== 'string' || value.trim() === '') return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    case 'checkbox':
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    case 'text':
      return typeof value === 'string' ? value : String(value ?? '');
    case 'select':
    case 'date':
    case 'flow':
      return value;
  }
};

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[character]!);

export const flowMailHtml = (body: string): string => (
  `<p>${escapeHtml(body).replace(/\r?\n/g, '<br>')}</p>`
);

export const isEmailAddress = (value: string): boolean => (
  value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
);

export const decodeFlowValues = (source: FlowExecutionSource): Map<string, unknown> => {
  const values = new Map<string, unknown>();
  for (const storedValue of source.values) {
    const column = source.columns.find((candidate) => candidate.id === storedValue.page_column_id);
    if (!column || column.type === 'flow') continue;
    try {
      values.set(column.id, VALUE_CODECS[column.type].decode(storedValue.data));
    } catch {
      values.set(column.id, undefined);
    }
  }
  return values;
};

export const buildFlowExecutionPlan = (
  executionId: NonEmptyString,
  startedAt: string,
  finishedAt: string,
  runtime: FlowExecutionRuntime,
): FlowExecutionPlan => {
  const summary: Schema.FlowExecutionSummary = {
    executionId,
    status: 'succeeded',
    startedAt,
    finishedAt,
    executedNodeIds: runtime.executedNodeIds,
    callback: runtime.callback,
    effects: {
      emailsQueued: runtime.emails.length,
      valuesUpdated: runtime.valueWrites.size,
    },
  };

  return {
    executionId,
    flowColumnData: VALUE_CODECS.flow.encode(summary),
    summary,
    updatedValues: [...runtime.valueWrites.values()].map(({ columnId, value }) => ({
      columnId,
      columnType: runtime.source.columns.find((column) => column.id === columnId)!.type,
      value,
    })),
    values: [...runtime.valueWrites.values()].map(({ columnId, data }) => ({
      columnId: columnId as NonEmptyString,
      data,
    })),
    emails: runtime.emails,
  };
};
