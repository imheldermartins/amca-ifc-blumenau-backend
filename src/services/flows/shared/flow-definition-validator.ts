import type { Schema } from '@/db/schemas/index';
import { FLOW_PAGE_TITLE_COLUMN_ID } from '@/services/flows/shared/flow-definition-utils';
import { VALUE_CODECS } from '@/services/value-codec';

const supportsOperator = (
  type: Exclude<Schema.ColumnType, 'flow'>,
  operator: Schema.FlowSwitchOperator,
): boolean => {
  if (operator === 'is_empty' || operator === 'is_not_empty') return type !== 'checkbox';

  switch (type) {
    case 'text':
      return operator === 'equals' || operator === 'not_equals' || operator === 'contains';
    case 'numeric':
      return operator === 'equals' || operator === 'not_equals'
        || operator === 'greater_than' || operator === 'less_than';
    case 'select':
    case 'date':
    case 'checkbox':
      return operator === 'equals' || operator === 'not_equals';
  }
};

const validateComparisonValue = (
  type: Exclude<Schema.ColumnType, 'flow'>,
  value: unknown,
  column: Schema.PageColumn | null,
): void => {
  switch (type) {
    case 'text':
      if (typeof value !== 'string') throw new Error('Valor textual da condição inválido');
      return;
    case 'numeric':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Valor numérico da condição inválido');
      }
      return;
    case 'checkbox':
      if (typeof value !== 'boolean') throw new Error('Valor booleano da condição inválido');
      return;
    case 'select': {
      const options = Array.isArray(column?.data?.options) ? column.data.options : [];
      if (typeof value !== 'string' || !options.some((option) => option.id === value)) {
        throw new Error('Opção da condição não existe mais');
      }
      return;
    }
    case 'date':
      if (!column) throw new Error('Coluna de data inválida');
      try {
        VALUE_CODECS.date.validate(value, column);
      } catch {
        throw new Error('Valor de data da condição inválido');
      }
  }
};

export const validateFlowDefinitionColumns = (
  definition: Schema.FlowDefinition,
  columns: readonly Schema.PageColumn[],
): void => {
  if (definition.version === 1) return;

  const visit = (steps: readonly Schema.FlowStepV2[]): void => {
    for (const step of steps) {
      if (step.type !== 'switch') continue;

      const column = step.config.columnId === FLOW_PAGE_TITLE_COLUMN_ID
        ? null
        : columns.find((candidate) => candidate.id === step.config.columnId);
      if (step.config.columnId !== FLOW_PAGE_TITLE_COLUMN_ID && (!column || column.type === 'flow')) {
        throw new Error('Coluna da condição não existe mais');
      }

      const type = column?.type ?? 'text';
      if (type === 'flow' || !supportsOperator(type, step.config.operator)) {
        throw new Error('Operador incompatível com a coluna da condição');
      }
      if (step.config.operator !== 'is_empty' && step.config.operator !== 'is_not_empty') {
        validateComparisonValue(type, step.config.value, column ?? null);
      }
      visit(step.config.whenTrue);
      visit(step.config.whenFalse);
    }
  };

  visit(definition.nodes.slice(1, -1) as Schema.FlowStepV2[]);
};
