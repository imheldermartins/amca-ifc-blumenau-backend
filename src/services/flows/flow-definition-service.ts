import type { Schema } from '@/db/schemas/index';
import { VALUE_CODECS } from '@/services/value-codec';

const NODE_TYPES = new Set(['start', 'email', 'set_value', 'switch', 'callback']);
const STEP_TYPES = new Set(['email', 'set_value', 'switch']);
const OPERATORS = new Set<Schema.FlowSwitchOperator>([
  'equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty',
]);
const MAX_NODES = 100;
const MAX_TEXT = 20_000;
const PAGE_TITLE_COLUMN_ID = 'page_title';
const EMAIL_RECIPIENT = /^(?:@people\.[0-9A-Za-z_-]+\.email|@page\.title|@columns\.[0-9A-Za-z_-]+)$/;

export function flowRecipientKeys(value: string): string[] {
  return [...new Set(value.split(/[;,]/).map((entry) => entry.trim()).filter(Boolean))];
}

/** Campos em que `@...` continua sendo macro; literais de condição v2 ficam fora. */
export function flowMacroInputs(definition: Schema.FlowDefinition): unknown[] {
  if (definition.version === 1) return [definition];
  const inputs: unknown[] = [];
  const visit = (steps: readonly Schema.FlowStepV2[]) => {
    for (const step of steps) {
      if (step.type === 'switch') {
        visit(step.config.whenTrue);
        visit(step.config.whenFalse);
      } else {
        inputs.push(step.config);
      }
    }
  };
  visit(definition.nodes.slice(1, -1) as Schema.FlowStepV2[]);
  inputs.push(definition.nodes.at(-1)?.config);
  return inputs;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${label} inválido`);
  }
  return value;
}

function nodeId(value: unknown): string {
  const id = requiredText(value, 'ID do node', 128).trim();
  if (/\p{C}/u.test(id)) throw new Error('ID do node inválido');
  return id;
}

function nextId(value: unknown): string {
  return requiredText(value, 'Destino do node', 128).trim();
}

function parseOperator(value: unknown): Schema.FlowSwitchOperator {
  if (typeof value !== 'string' || !OPERATORS.has(value as Schema.FlowSwitchOperator)) {
    throw new Error('Operador do switch inválido');
  }
  return value as Schema.FlowSwitchOperator;
}

function parseEmailConfig(config: Record<string, unknown>, includeNext: boolean) {
  const to = requiredText(config.to, 'Destinatário do e-mail', 512);
  const recipients = flowRecipientKeys(to);
  if (!recipients.length || recipients.some((recipient) => !EMAIL_RECIPIENT.test(recipient))) {
    throw new Error('Destinatários devem ser membros ou variáveis de e-mail disponíveis');
  }
  return {
    to,
    subject: requiredText(config.subject, 'Assunto do e-mail', 998),
    body: requiredText(config.body, 'Corpo do e-mail'),
    ...(includeNext && { nextNodeId: nextId(config.nextNodeId) }),
  };
}

function parseCallbackConfig(config: Record<string, unknown>): { message?: string } {
  const message = config.message;
  if (message !== undefined && (typeof message !== 'string' || message.length > MAX_TEXT)) {
    throw new Error('Mensagem do callback inválida');
  }
  return { ...(typeof message === 'string' && { message }) };
}

function supportsOperator(
  type: Exclude<Schema.ColumnType, 'flow'>,
  candidate: Schema.FlowSwitchOperator,
): boolean {
  if (candidate === 'is_empty' || candidate === 'is_not_empty') return type !== 'checkbox';
  if (type === 'text') return ['equals', 'not_equals', 'contains'].includes(candidate);
  if (type === 'numeric') return ['equals', 'not_equals', 'greater_than', 'less_than'].includes(candidate);
  if (type === 'select' || type === 'date' || type === 'checkbox') {
    return candidate === 'equals' || candidate === 'not_equals';
  }
  return false;
}

/** Valida e normaliza o documento antes de qualquer persistência. */
export class FlowDefinitionService {
  public parse(input: unknown): Schema.FlowDefinition {
    const root = record(input);
    const trigger = record(root?.trigger);
    if (root?.version === 2) return this.parseV2(root, trigger);
    if (root?.version !== 1 || trigger?.type !== 'manual' || !Array.isArray(root.nodes)) {
      throw new Error('Definição de flow inválida');
    }
    if (root.nodes.length < 2 || root.nodes.length > MAX_NODES) {
      throw new Error(`O flow deve ter entre 2 e ${MAX_NODES} nodes`);
    }

    const nodes = root.nodes.map((raw) => this.parseNodeV1(raw));
    const ids = new Set<string>();
    for (const node of nodes) {
      if (ids.has(node.id)) throw new Error('IDs de nodes devem ser únicos');
      ids.add(node.id);
    }
    if (nodes[0]?.type !== 'start' || nodes.at(-1)?.type !== 'callback') {
      throw new Error('O flow deve iniciar com start e terminar com callback');
    }
    if (nodes.filter((node) => node.type === 'start').length !== 1
      || nodes.filter((node) => node.type === 'callback').length !== 1) {
      throw new Error('Start e callback são nodes únicos e fixos');
    }
    if (nodes.filter((node) => node.type === 'switch').length > 1) {
      throw new Error('Switch aninhado não é suportado nesta versão');
    }

    const index = new Map(nodes.map((node, position) => [node.id, position]));
    const incoming = new Set<string>();
    nodes.forEach((node, position) => {
      for (const target of this.targetsV1(node)) {
        const targetPosition = index.get(target);
        if (targetPosition === undefined) throw new Error(`Destino inexistente: ${target}`);
        if (targetPosition <= position) throw new Error('O flow não pode conter ciclos ou retornos');
        if (nodes[targetPosition]?.type === 'start') throw new Error('Start não pode ser destino');
        if (node.type === 'switch' && nodes[targetPosition]?.type === 'switch') {
          throw new Error('Switch aninhado não é suportado nesta versão');
        }
        incoming.add(target);
      }
    });

    for (const node of nodes.slice(1)) {
      if (!incoming.has(node.id)) throw new Error(`Node desconectado: ${node.id}`);
    }

    return { version: 1, trigger: { type: 'manual' }, nodes };
  }

  /** Validação semântica do v2 contra as colunas atuais da database. */
  public validateAgainstColumns(
    definition: Schema.FlowDefinition,
    columns: readonly Schema.PageColumn[],
  ): void {
    if (definition.version === 1) return;
    const visit = (steps: readonly Schema.FlowStepV2[]) => {
      for (const step of steps) {
        if (step.type !== 'switch') continue;
        const column = step.config.columnId === PAGE_TITLE_COLUMN_ID
          ? null
          : columns.find((candidate) => candidate.id === step.config.columnId);
        if (step.config.columnId !== PAGE_TITLE_COLUMN_ID && (!column || column.type === 'flow')) {
          throw new Error('Coluna da condição não existe mais');
        }
        const type = column?.type ?? 'text';
        if (type === 'flow' || !supportsOperator(type, step.config.operator)) {
          throw new Error('Operador incompatível com a coluna da condição');
        }
        if (!['is_empty', 'is_not_empty'].includes(step.config.operator)) {
          this.validateComparisonValue(type, step.config.value, column ?? null);
        }
        visit(step.config.whenTrue);
        visit(step.config.whenFalse);
      }
    };
    visit(definition.nodes.slice(1, -1) as Schema.FlowStepV2[]);
  }

  private validateComparisonValue(
    type: Exclude<Schema.ColumnType, 'flow'>,
    value: unknown,
    column: Schema.PageColumn | null,
  ): void {
    if (type === 'text') {
      if (typeof value !== 'string') throw new Error('Valor textual da condição inválido');
      return;
    }
    if (type === 'numeric') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Valor numérico da condição inválido');
      }
      return;
    }
    if (type === 'checkbox') {
      if (typeof value !== 'boolean') throw new Error('Valor booleano da condição inválido');
      return;
    }
    if (type === 'select') {
      const options = Array.isArray(column?.data?.options) ? column.data.options : [];
      if (typeof value !== 'string' || !options.some((option) => option.id === value)) {
        throw new Error('Opção da condição não existe mais');
      }
      return;
    }
    if (!column) throw new Error('Coluna de data inválida');
    try {
      VALUE_CODECS.date.validate(value, column);
    } catch {
      throw new Error('Valor de data da condição inválido');
    }
  }

  private parseV2(
    root: Record<string, unknown>,
    trigger: Record<string, unknown> | null,
  ): Schema.FlowDefinitionV2 {
    if (trigger?.type !== 'manual' || !Array.isArray(root.nodes) || root.nodes.length < 2) {
      throw new Error('Definição de flow inválida');
    }
    const ids = new Set<string>();
    let count = 0;
    const register = (id: string) => {
      count += 1;
      if (count > MAX_NODES) throw new Error(`O flow deve ter no máximo ${MAX_NODES} nodes`);
      if (ids.has(id)) throw new Error('IDs de nodes devem ser únicos');
      ids.add(id);
    };
    const first = this.parseRootV2(root.nodes[0], 'start');
    register(first.id);
    const last = this.parseRootV2(root.nodes.at(-1), 'callback');
    register(last.id);
    const steps = root.nodes.slice(1, -1).map((raw) => this.parseStepV2(raw, register));
    return {
      version: 2,
      trigger: { type: 'manual' },
      nodes: [first as Schema.FlowStartNodeV2, ...steps, last as Schema.FlowCallbackNodeV2],
    };
  }

  private parseRootV2(input: unknown, expected: 'start' | 'callback') {
    const raw = record(input);
    const config = record(raw?.config);
    if (raw?.type !== expected || !config) throw new Error('Start e callback são nodes únicos e fixos');
    const id = nodeId(raw.id);
    return expected === 'start'
      ? { id, type: 'start' as const, config: {} }
      : { id, type: 'callback' as const, config: parseCallbackConfig(config) };
  }

  private parseStepV2(input: unknown, register: (id: string) => void): Schema.FlowStepV2 {
    const raw = record(input);
    const config = record(raw?.config);
    if (!raw || typeof raw.type !== 'string' || !STEP_TYPES.has(raw.type) || !config) {
      throw new Error('Tipo de ação inválido');
    }
    const id = nodeId(raw.id);
    register(id);
    if (raw.type === 'email') {
      return { id, type: 'email', config: parseEmailConfig(config, false) };
    }
    if (raw.type === 'set_value') {
      return {
        id,
        type: 'set_value',
        config: {
          columnId: requiredText(config.columnId, 'Coluna de destino', 128) as NonEmptyString,
          value: config.value,
        },
      };
    }
    const parsedOperator = parseOperator(config.operator);
    if (!['is_empty', 'is_not_empty'].includes(parsedOperator) && config.value === undefined) {
      throw new Error('Comparação do switch exige valor');
    }
    if (!Array.isArray(config.whenTrue) || !Array.isArray(config.whenFalse)) {
      throw new Error('Ramos da condição inválidos');
    }
    return {
      id,
      type: 'switch',
      config: {
        columnId: requiredText(config.columnId, 'Coluna da condição', 128),
        operator: parsedOperator,
        ...(!['is_empty', 'is_not_empty'].includes(parsedOperator) && { value: config.value }),
        whenTrue: config.whenTrue.map((step) => this.parseStepV2(step, register)),
        whenFalse: config.whenFalse.map((step) => this.parseStepV2(step, register)),
      },
    };
  }

  private parseNodeV1(input: unknown): Schema.FlowNode {
    const raw = record(input);
    const type = raw?.type;
    if (typeof type !== 'string' || !NODE_TYPES.has(type)) throw new Error('Tipo de node inválido');
    const id = nodeId(raw?.id);
    const config = record(raw?.config);
    if (!config) throw new Error('Configuração do node inválida');
    if (type === 'start') return { id, type, config: { nextNodeId: nextId(config.nextNodeId) } };
    if (type === 'email') {
      const to = requiredText(config.to, 'Destinatário do e-mail', 512);
      const recipients = flowRecipientKeys(to);
      if (!recipients.length || recipients.some((recipient) => !EMAIL_RECIPIENT.test(recipient))) {
        throw new Error('Destinatários devem ser membros ou variáveis de e-mail disponíveis');
      }
      return {
        id,
        type,
        config: {
          to,
          subject: requiredText(config.subject, 'Assunto do e-mail', 998),
          body: requiredText(config.body, 'Corpo do e-mail'),
          nextNodeId: nextId(config.nextNodeId),
        },
      };
    }
    if (type === 'set_value') {
      return {
        id,
        type,
        config: {
          columnId: requiredText(config.columnId, 'Coluna de destino', 128) as NonEmptyString,
          value: config.value,
          nextNodeId: nextId(config.nextNodeId),
        },
      };
    }
    if (type === 'switch') {
      const parsedOperator = parseOperator(config.operator);
      if (!['is_empty', 'is_not_empty'].includes(parsedOperator) && config.right === undefined) {
        throw new Error('Comparação do switch exige valor à direita');
      }
      return {
        id,
        type,
        config: {
          left: requiredText(config.left, 'Valor do switch'),
          operator: parsedOperator,
          ...(config.right !== undefined && { right: config.right }),
          trueTargetId: nextId(config.trueTargetId),
          falseTargetId: nextId(config.falseTargetId),
        },
      };
    }
    return { id, type: 'callback', config: parseCallbackConfig(config) };
  }

  private targetsV1(node: Schema.FlowNode): string[] {
    if (node.type === 'callback') return [];
    if (node.type === 'switch') return [node.config.trueTargetId, node.config.falseTargetId];
    return [node.config.nextNodeId];
  }
}

export default new FlowDefinitionService();
