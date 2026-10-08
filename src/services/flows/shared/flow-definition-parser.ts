import type { Schema } from '@/db/schemas/index';
import {
  FLOW_MAX_NODES,
  FLOW_MAX_TEXT,
  flowRecipientKeys,
  flowTargetsV1,
} from '@/services/flows/shared/flow-definition-utils';

const NODE_TYPES = new Set(['start', 'email', 'set_value', 'switch', 'callback']);
const STEP_TYPES = new Set(['email', 'set_value', 'switch']);
const OPERATORS = new Set<Schema.FlowSwitchOperator>([
  'equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty',
]);
const EMAIL_RECIPIENT = /^(?:@people\.[0-9A-Za-z_-]+\.email|@page\.title|@columns\.[0-9A-Za-z_-]+)$/;

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const requiredText = (value: unknown, label: string, max = FLOW_MAX_TEXT): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${label} inválido`);
  }
  return value;
};

const nodeId = (value: unknown): string => {
  const id = requiredText(value, 'ID do node', 128).trim();
  if (/\p{C}/u.test(id)) throw new Error('ID do node inválido');
  return id;
};

const nextId = (value: unknown): string => requiredText(value, 'Destino do node', 128).trim();

const parseOperator = (value: unknown): Schema.FlowSwitchOperator => {
  if (typeof value !== 'string' || !OPERATORS.has(value as Schema.FlowSwitchOperator)) {
    throw new Error('Operador do switch inválido');
  }
  return value as Schema.FlowSwitchOperator;
};

const parseEmailConfig = (config: Record<string, unknown>) => {
  const to = requiredText(config.to, 'Destinatário do e-mail', 512);
  const recipients = flowRecipientKeys(to);
  if (!recipients.length || recipients.some((recipient) => !EMAIL_RECIPIENT.test(recipient))) {
    throw new Error('Destinatários devem ser membros ou variáveis de e-mail disponíveis');
  }
  return {
    to,
    subject: requiredText(config.subject, 'Assunto do e-mail', 998),
    body: requiredText(config.body, 'Corpo do e-mail'),
  };
};

const parseCallbackConfig = (config: Record<string, unknown>): { message?: string } => {
  const message = config.message;
  if (message !== undefined && (typeof message !== 'string' || message.length > FLOW_MAX_TEXT)) {
    throw new Error('Mensagem do callback inválida');
  }
  return { ...(typeof message === 'string' && { message }) };
};

const parseNodeV1 = (input: unknown): Schema.FlowNode => {
  const raw = asRecord(input);
  const type = raw?.type;
  if (typeof type !== 'string' || !NODE_TYPES.has(type)) throw new Error('Tipo de node inválido');

  const id = nodeId(raw?.id);
  const config = asRecord(raw?.config);
  if (!config) throw new Error('Configuração do node inválida');

  switch (type) {
    case 'start':
      return { id, type, config: { nextNodeId: nextId(config.nextNodeId) } };
    case 'email':
      return {
        id,
        type,
        config: { ...parseEmailConfig(config), nextNodeId: nextId(config.nextNodeId) },
      };
    case 'set_value':
      return {
        id,
        type,
        config: {
          columnId: requiredText(config.columnId, 'Coluna de destino', 128) as NonEmptyString,
          value: config.value,
          nextNodeId: nextId(config.nextNodeId),
        },
      };
    case 'switch': {
      const operator = parseOperator(config.operator);
      if (!['is_empty', 'is_not_empty'].includes(operator) && config.right === undefined) {
        throw new Error('Comparação do switch exige valor à direita');
      }
      return {
        id,
        type,
        config: {
          left: requiredText(config.left, 'Valor do switch'),
          operator,
          ...(config.right !== undefined && { right: config.right }),
          trueTargetId: nextId(config.trueTargetId),
          falseTargetId: nextId(config.falseTargetId),
        },
      };
    }
    case 'callback':
      return { id, type, config: parseCallbackConfig(config) };
    default:
      throw new Error('Tipo de node inválido');
  }
};

const parseRootV2 = (
  input: unknown,
  expected: 'start' | 'callback',
): Schema.FlowStartNodeV2 | Schema.FlowCallbackNodeV2 => {
  const raw = asRecord(input);
  const config = asRecord(raw?.config);
  if (raw?.type !== expected || !config) throw new Error('Start e callback são nodes únicos e fixos');

  const id = nodeId(raw.id);
  return expected === 'start'
    ? { id, type: 'start', config: {} }
    : { id, type: 'callback', config: parseCallbackConfig(config) };
};

const parseStepV2 = (
  input: unknown,
  register: (id: string) => void,
): Schema.FlowStepV2 => {
  const raw = asRecord(input);
  const config = asRecord(raw?.config);
  if (!raw || typeof raw.type !== 'string' || !STEP_TYPES.has(raw.type) || !config) {
    throw new Error('Tipo de ação inválido');
  }

  const id = nodeId(raw.id);
  register(id);
  switch (raw.type) {
    case 'email':
      return { id, type: 'email', config: parseEmailConfig(config) };
    case 'set_value':
      return {
        id,
        type: 'set_value',
        config: {
          columnId: requiredText(config.columnId, 'Coluna de destino', 128) as NonEmptyString,
          value: config.value,
        },
      };
    case 'switch': {
      const operator = parseOperator(config.operator);
      if (!['is_empty', 'is_not_empty'].includes(operator) && config.value === undefined) {
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
          operator,
          ...(!['is_empty', 'is_not_empty'].includes(operator) && { value: config.value }),
          whenTrue: config.whenTrue.map((step) => parseStepV2(step, register)),
          whenFalse: config.whenFalse.map((step) => parseStepV2(step, register)),
        },
      };
    }
    default:
      throw new Error('Tipo de ação inválido');
  }
};

const parseV1 = (root: Record<string, unknown>): Schema.FlowDefinitionV1 => {
  const trigger = asRecord(root.trigger);
  if (trigger?.type !== 'manual' || !Array.isArray(root.nodes)) {
    throw new Error('Definição de flow inválida');
  }
  if (root.nodes.length < 2 || root.nodes.length > FLOW_MAX_NODES) {
    throw new Error(`O flow deve ter entre 2 e ${FLOW_MAX_NODES} nodes`);
  }

  const nodes = root.nodes.map(parseNodeV1);
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
    for (const target of flowTargetsV1(node)) {
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
};

const parseV2 = (root: Record<string, unknown>): Schema.FlowDefinitionV2 => {
  const trigger = asRecord(root.trigger);
  if (trigger?.type !== 'manual' || !Array.isArray(root.nodes) || root.nodes.length < 2) {
    throw new Error('Definição de flow inválida');
  }

  const ids = new Set<string>();
  let count = 0;
  const register = (id: string): void => {
    count += 1;
    if (count > FLOW_MAX_NODES) throw new Error(`O flow deve ter no máximo ${FLOW_MAX_NODES} nodes`);
    if (ids.has(id)) throw new Error('IDs de nodes devem ser únicos');
    ids.add(id);
  };

  const first = parseRootV2(root.nodes[0], 'start') as Schema.FlowStartNodeV2;
  register(first.id);
  const last = parseRootV2(root.nodes.at(-1), 'callback') as Schema.FlowCallbackNodeV2;
  register(last.id);
  const steps = root.nodes.slice(1, -1).map((step) => parseStepV2(step, register));
  return {
    version: 2,
    trigger: { type: 'manual' },
    nodes: [first, ...steps, last],
  };
};

export const parseFlowDefinition = (input: unknown): Schema.FlowDefinition => {
  const root = asRecord(input);
  switch (root?.version) {
    case 1:
      return parseV1(root);
    case 2:
      return parseV2(root);
    default:
      throw new Error('Definição de flow inválida');
  }
};
