import type { Schema } from '@/db/schemas/index';

const NODE_TYPES = new Set(['start', 'email', 'set_value', 'switch', 'callback']);
const OPERATORS = new Set<Schema.FlowSwitchOperator>([
  'equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty',
]);
const MAX_NODES = 100;
const MAX_TEXT = 20_000;
const EMAIL_RECIPIENT = /^(?:@people\.[0-9A-Za-z_-]+\.email|@page\.title|@columns\.[0-9A-Za-z_-]+)$/;

export function flowRecipientKeys(value: string): string[] {
  return [...new Set(value.split(/[;,]/).map((entry) => entry.trim()).filter(Boolean))];
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

/** Valida e normaliza o documento antes de qualquer persistência. */
export class FlowDefinitionService {
  public parse(input: unknown): Schema.FlowDefinition {
    const root = record(input);
    const trigger = record(root?.trigger);
    if (root?.version !== 1 || trigger?.type !== 'manual' || !Array.isArray(root.nodes)) {
      throw new Error('Definição de flow inválida');
    }
    if (root.nodes.length < 2 || root.nodes.length > MAX_NODES) {
      throw new Error(`O flow deve ter entre 2 e ${MAX_NODES} nodes`);
    }

    const nodes = root.nodes.map((raw) => this.parseNode(raw));
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
      for (const target of this.targets(node)) {
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

  private parseNode(input: unknown): Schema.FlowNode {
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
      if (typeof config.operator !== 'string' || !OPERATORS.has(config.operator as Schema.FlowSwitchOperator)) {
        throw new Error('Operador do switch inválido');
      }
      if (!['is_empty', 'is_not_empty'].includes(config.operator) && config.right === undefined) {
        throw new Error('Comparação do switch exige valor à direita');
      }
      return {
        id,
        type,
        config: {
          left: requiredText(config.left, 'Valor do switch'),
          operator: config.operator as Schema.FlowSwitchOperator,
          ...(config.right !== undefined && { right: config.right }),
          trueTargetId: nextId(config.trueTargetId),
          falseTargetId: nextId(config.falseTargetId),
        },
      };
    }
    const message = config.message;
    if (message !== undefined && (typeof message !== 'string' || message.length > MAX_TEXT)) {
      throw new Error('Mensagem do callback inválida');
    }
    return { id, type: 'callback', config: { ...(typeof message === 'string' && { message }) } };
  }

  private targets(node: Schema.FlowNode): string[] {
    if (node.type === 'callback') return [];
    if (node.type === 'switch') return [node.config.trueTargetId, node.config.falseTargetId];
    return [node.config.nextNodeId];
  }
}

export default new FlowDefinitionService();
