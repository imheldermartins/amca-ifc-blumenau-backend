import { ulid } from 'ulid';

import type { Schema } from '@/db/schemas/index';
import columnLockStore, { ColumnLockStore } from '@/repositories/column-lock-repository';
import flowStore, { FlowStore } from '@/repositories/flow-repository';
import type { FlowEmailWrite, FlowValueWrite } from '@/repositories/types/flow-repository.types';
import flowDefinitionService, { FlowDefinitionService, flowMacroInputs, flowRecipientKeys } from '@/services/flows/flow-definition-service';
import macroService, {
  MacroService,
  parseColumnMacroValue,
  type MacroResolutionContext,
} from '@/services/macros/macro-service';
import { VALUE_CODECS } from '@/services/value-codec';

export type FlowExecutionFailureReason = 'not_found' | 'validation' | 'forbidden' | 'server_error';

export class FlowExecutionError extends Error {
  public constructor(
    public readonly reason: FlowExecutionFailureReason,
    message: string,
  ) {
    super(message);
  }
}

export interface FlowExecutionOutcome {
  summary: Schema.FlowExecutionSummary;
  updatedValues: { columnId: string; value: unknown }[];
}

export interface FlowExecutionAuthorization {
  assertFlowWritable(source: import('@/repositories/types/flow-repository.types').FlowExecutionSource): Promise<void>;
  assertColumnWritable(column: Schema.PageColumn): Promise<void>;
}

export interface FlowExecutionPlan extends FlowExecutionOutcome {
  executionId: NonEmptyString;
  flowColumnData: string;
  values: FlowValueWrite[];
  emails: FlowEmailWrite[];
}

export interface FlowExecutionPolicy {
  /** Formulários públicos não podem transformar respostas em destinatários. */
  allowRespondentControlledEmailRecipients: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!);
}

function mailHtml(body: string): string {
  return `<p>${escapeHtml(body).replace(/\r?\n/g, '<br>')}</p>`;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function compare(operator: Schema.FlowSwitchOperator, left: unknown, right: unknown): boolean {
  if (operator === 'is_empty') return isEmpty(left);
  if (operator === 'is_not_empty') return !isEmpty(left);
  if (operator === 'contains') return String(left ?? '').includes(String(right ?? ''));
  if (operator === 'greater_than' || operator === 'less_than') {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
    return operator === 'greater_than' ? leftNumber > rightNumber : leftNumber < rightNumber;
  }
  const equal = Object.is(left, right) || String(left ?? '') === String(right ?? '');
  return operator === 'equals' ? equal : !equal;
}

function normalizeCellValue(type: Schema.ColumnType, value: unknown): unknown {
  if (type === 'numeric' && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === 'checkbox' && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (type === 'text' && typeof value !== 'string') return String(value ?? '');
  return value;
}

function isEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export class FlowExecutionService {
  public constructor(
    private readonly flows: FlowStore = flowStore,
    private readonly definitions: FlowDefinitionService = flowDefinitionService,
    private readonly macros: MacroService = macroService,
    private readonly locks: ColumnLockStore = columnLockStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(
    rowId: NonEmptyString,
    columnId: NonEmptyString,
    actorUserId: NonEmptyString,
  ): Promise<FlowExecutionOutcome> {
    const source = await this.flows.executionSource(rowId, columnId);
    if (!source) throw new FlowExecutionError('not_found', 'Flow não encontrado para esta página');
    const authorization: FlowExecutionAuthorization = {
      assertFlowWritable: async (candidate) => {
        if (!await this.locks.canMutate(candidate.flowColumn.parent_id!, columnId, actorUserId)) {
          throw new FlowExecutionError('forbidden', 'Coluna bloqueada para execução');
        }
      },
      assertColumnWritable: async (column) => {
        if (!column.parent_id || !await this.locks.canMutate(column.parent_id, column.id, actorUserId)) {
          throw new FlowExecutionError('forbidden', `A coluna ${column.name ?? 'de destino'} está bloqueada`);
        }
      },
    };
    const plan = await this.plan(source, authorization, {
      allowRespondentControlledEmailRecipients: true,
    });
    const committed = await this.flows.commitExecution({
      executionId: plan.executionId,
      actorUserId,
      source,
      flowColumnData: plan.flowColumnData,
      summary: plan.summary,
      values: plan.values,
      emails: plan.emails,
    });
    if (!committed) throw new FlowExecutionError('server_error', 'Não foi possível concluir o flow');
    return { summary: plan.summary, updatedValues: plan.updatedValues };
  }

  /** Planeja o mesmo Flow sem persistir, para composição transacional externa. */
  public async plan(
    source: import('@/repositories/types/flow-repository.types').FlowExecutionSource,
    authorization: FlowExecutionAuthorization,
    policy: FlowExecutionPolicy,
  ): Promise<FlowExecutionPlan> {
    await authorization.assertFlowWritable(source);

    let definition: Schema.FlowDefinition;
    try {
      definition = this.definitions.parse(source.flowColumn.data?.flow);
      this.definitions.validateAgainstColumns(definition, source.columns);
    } catch (error) {
      throw new FlowExecutionError(
        'validation',
        error instanceof Error ? error.message : 'Flow não configurado',
      );
    }

    // A página corrente é a linha, não a database parent: @page.title precisa
    // mudar por execução, enquanto workspace/colunas/pessoas permanecem no catálogo.
    const context = this.macros.catalog({
      page: source.row,
      workspace: source.workspace,
      columns: source.columns,
      people: source.people,
      values: source.values,
    });
    try {
      this.macros.assertKnown(flowMacroInputs(definition), context.descriptors);
    } catch (error) {
      throw new FlowExecutionError('validation', error instanceof Error ? error.message : 'Macro inválida');
    }

    const startedAt = this.now().toISOString();
    const executionId = ulid() as NonEmptyString;
    const executedNodeIds: string[] = [];
    const valueWrites = new Map<string, FlowValueWrite & { value: unknown }>();
    const emails: FlowEmailWrite[] = [];
    let callback: string | null = null;
    const rawValues = new Map<string, unknown>();
    for (const value of source.values) {
      const column = source.columns.find((candidate) => candidate.id === value.page_column_id);
      if (!column || column.type === 'flow') continue;
      try {
        rawValues.set(column.id, VALUE_CODECS[column.type].decode(value.data));
      } catch {
        rawValues.set(column.id, undefined);
      }
    }

    const enqueueEmail = (
      nodeId: string,
      config: { to: string; subject: string; body: string },
    ) => {
        const recipients = new Map<string, {
          userId: NonEmptyString | null;
          name: string;
          email: string;
        }>();
        for (const recipientKey of flowRecipientKeys(config.to)) {
          const exactKey = this.macros.exactKey(recipientKey);
          const descriptor = context.descriptors.find((entry) => entry.key === exactKey);
          const supported = descriptor && (
            (descriptor.kind === 'person' && descriptor.valueType === 'email')
            || (descriptor.kind === 'column' && descriptor.valueType === 'email')
            || descriptor.key === '@page.title'
          );
          if (!supported) {
            throw new FlowExecutionError('validation', 'Variável de destinatário incompatível');
          }
          if (
            !policy.allowRespondentControlledEmailRecipients
            && (descriptor.kind === 'column' || descriptor.key === '@page.title')
          ) {
            throw new FlowExecutionError(
              'forbidden',
              'Formulário público não pode usar uma resposta como destinatário de e-mail',
            );
          }
          const email = String(this.macros.resolve(recipientKey, context) ?? '').trim();
          if (!isEmail(email)) {
            throw new FlowExecutionError(
              'validation',
              `${descriptor.label} não contém um e-mail válido nesta página`,
            );
          }
          const member = source.people.find((person) =>
            person.email.localeCompare(email, undefined, { sensitivity: 'accent' }) === 0);
          recipients.set(email.toLocaleLowerCase(), {
            userId: member?.id ?? null,
            name: member?.name ?? email,
            email,
          });
        }
        const subject = String(this.macros.resolve(config.subject, context));
        const body = String(this.macros.resolve(config.body, context));
        if (!subject.trim() || /[\r\n]/.test(subject)) {
          throw new FlowExecutionError('validation', 'Assunto do e-mail inválido');
        }
        for (const recipient of recipients.values()) {
          emails.push({
            nodeId,
            recipientUserId: recipient.userId,
            recipientEmail: recipient.email,
            payload: {
              to: { name: recipient.name, email: recipient.email },
              subject,
              html: mailHtml(body),
              text: body,
            },
          });
        }
    };

    const writeValue = async (
      config: { columnId: string; value: unknown },
    ) => {
      const target = source.columns.find((column) => column.id === config.columnId);
      if (!target || target.type === 'flow' || !target.parent_id) {
        throw new FlowExecutionError('validation', 'Coluna de destino inválida');
      }
      await authorization.assertColumnWritable(target);
      const raw = normalizeCellValue(
        target.type,
        this.macros.resolve(config.value, context),
      );
      let data: string;
      try {
        const codec = VALUE_CODECS[target.type];
        data = codec.encode(codec.validate(raw, target));
      } catch (error) {
        throw new FlowExecutionError(
          'validation',
          error instanceof Error ? error.message : 'Valor de destino inválido',
        );
      }
      valueWrites.set(target.id, { columnId: target.id, data, value: raw });
      context.values.set(
        `@columns.${target.id}`,
        parseColumnMacroValue(target, raw),
      );
      rawValues.set(target.id, raw);
    };

    if (definition.version === 1) {
      const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
      let current: Schema.FlowNode | undefined = definition.nodes[0];
      for (let step = 0; current && step <= definition.nodes.length; step += 1) {
        if (executedNodeIds.includes(current.id)) {
          throw new FlowExecutionError('validation', 'O flow contém um ciclo');
        }
        executedNodeIds.push(current.id);
        if (current.type === 'callback') {
          callback = String(this.macros.resolve(current.config.message ?? '', context));
          current = undefined;
          break;
        }
        if (current.type === 'start') {
          current = nodes.get(current.config.nextNodeId);
          continue;
        }
        if (current.type === 'switch') {
          const left = this.macros.resolve(current.config.left, context);
          const right = this.macros.resolve(current.config.right, context);
          current = nodes.get(compare(current.config.operator, left, right)
            ? current.config.trueTargetId
            : current.config.falseTargetId);
          continue;
        }
        if (current.type === 'email') {
          enqueueEmail(current.id, current.config);
          current = nodes.get(current.config.nextNodeId);
          continue;
        }
        await writeValue(current.config);
        current = nodes.get(current.config.nextNodeId);
      }
      if (current || definition.nodes.at(-1)?.id !== executedNodeIds.at(-1)) {
        throw new FlowExecutionError('validation', 'O flow não alcançou o callback final');
      }
    } else {
      const start = definition.nodes[0] as Schema.FlowStartNodeV2;
      const end = definition.nodes.at(-1) as Schema.FlowCallbackNodeV2;
      executedNodeIds.push(start.id);
      const run = async (steps: readonly Schema.FlowStepV2[]): Promise<void> => {
        for (const step of steps) {
          executedNodeIds.push(step.id);
          if (step.type === 'email') {
            enqueueEmail(step.id, step.config);
            continue;
          }
          if (step.type === 'set_value') {
            await writeValue(step.config);
            continue;
          }
          const left = step.config.columnId === 'page_title'
            ? source.row.title
            : rawValues.get(step.config.columnId);
          const branch = compare(step.config.operator, left, step.config.value)
            ? step.config.whenTrue
            : step.config.whenFalse;
          await run(branch);
        }
      };
      await run(definition.nodes.slice(1, -1) as Schema.FlowStepV2[]);
      executedNodeIds.push(end.id);
      callback = String(this.macros.resolve(end.config.message ?? '', context));
    }

    const finishedAt = this.now().toISOString();
    const summary: Schema.FlowExecutionSummary = {
      executionId,
      status: 'succeeded',
      startedAt,
      finishedAt,
      executedNodeIds,
      callback,
      effects: { emailsQueued: emails.length, valuesUpdated: valueWrites.size },
    };
    const flowColumnData = VALUE_CODECS.flow.encode(summary);
    return {
      executionId,
      flowColumnData,
      summary,
      updatedValues: [...valueWrites.values()].map(({ columnId: targetId, value }) => ({ columnId: targetId, value })),
      values: [...valueWrites.values()].map(({ columnId: targetId, data }) => ({
        columnId: targetId as NonEmptyString,
        data,
      })),
      emails,
    };
  }
}

export default new FlowExecutionService();
