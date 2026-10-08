import type { Schema } from '@/db/schemas/index';
import { FlowExecutionError } from '@/services/flows/flow-execution-error';
import { flowRecipientKeys } from '@/services/flows/shared/flow-definition-utils';
import {
  compareFlowValues,
  flowMailHtml,
  isEmailAddress,
  normalizeFlowCellValue,
} from '@/services/flows/shared/flow-execution-utils';
import type {
  FlowActionHandler,
  FlowActionHandlerMap,
  FlowExecutableAction,
  FlowExecutionRuntime,
} from '@/services/flows/types/flow-execution.types';
import { parseColumnMacroValue } from '@/services/macros/macro-service';
import { VALUE_CODECS } from '@/services/value-codec';

const enqueueEmail: FlowActionHandler<Schema.FlowEmailNode | Schema.FlowEmailStepV2> = (
  action,
  runtime,
) => {
  const recipients = new Map<string, {
    userId: NonEmptyString | null;
    name: string;
    email: string;
  }>();

  for (const recipientKey of flowRecipientKeys(action.config.to)) {
    const exactKey = runtime.macros.exactKey(recipientKey);
    const descriptor = runtime.context.descriptors.find((entry) => entry.key === exactKey);
    const supported = descriptor && (
      (descriptor.kind === 'person' && descriptor.valueType === 'email')
      || (descriptor.kind === 'column' && descriptor.valueType === 'email')
      || descriptor.key === '@page.title'
    );
    if (!supported) {
      throw new FlowExecutionError('validation', 'Variável de destinatário incompatível');
    }
    if (
      !runtime.policy.allowRespondentControlledEmailRecipients
      && (descriptor.kind === 'column' || descriptor.key === '@page.title')
    ) {
      throw new FlowExecutionError(
        'forbidden',
        'Formulário público não pode usar uma resposta como destinatário de e-mail',
      );
    }

    const email = String(runtime.macros.resolve(recipientKey, runtime.context) ?? '').trim();
    if (!isEmailAddress(email)) {
      throw new FlowExecutionError(
        'validation',
        `${descriptor.label} não contém um e-mail válido nesta página`,
      );
    }
    const member = runtime.source.people.find((person) => (
      person.email.localeCompare(email, undefined, { sensitivity: 'accent' }) === 0
    ));
    recipients.set(email.toLocaleLowerCase(), {
      userId: member?.id ?? null,
      name: member?.name ?? email,
      email,
    });
  }

  const subject = String(runtime.macros.resolve(action.config.subject, runtime.context));
  const body = String(runtime.macros.resolve(action.config.body, runtime.context));
  if (!subject.trim() || /[\r\n]/.test(subject)) {
    throw new FlowExecutionError('validation', 'Assunto do e-mail inválido');
  }

  for (const recipient of recipients.values()) {
    runtime.emails.push({
      nodeId: action.id,
      recipientUserId: recipient.userId,
      recipientEmail: recipient.email,
      payload: {
        to: { name: recipient.name, email: recipient.email },
        subject,
        content: { html: flowMailHtml(body), text: body },
      },
    });
  }
};

const writeValue: FlowActionHandler<Schema.FlowSetValueNode | Schema.FlowSetValueStepV2> = async (
  action,
  runtime,
) => {
  const target = runtime.source.columns.find((column) => column.id === action.config.columnId);
  if (!target || target.type === 'flow' || !target.parent_id) {
    throw new FlowExecutionError('validation', 'Coluna de destino inválida');
  }

  await runtime.authorization.assertColumnWritable(target);
  const raw = normalizeFlowCellValue(
    target.type,
    runtime.macros.resolve(action.config.value, runtime.context),
  );

  let data: string;
  let value: unknown;
  try {
    const codec = VALUE_CODECS[target.type];
    value = codec.validate(raw, target);
    data = codec.encode(value);
  } catch (error) {
    throw new FlowExecutionError(
      'validation',
      error instanceof Error ? error.message : 'Valor de destino inválido',
    );
  }

  runtime.valueWrites.set(target.id, { columnId: target.id, data, value });
  runtime.context.values.set(`@columns.${target.id}`, parseColumnMacroValue(target, value));
  runtime.rawValues.set(target.id, value);
};

/** Registro único das ações com efeito; adicionar um bloco novo começa por este mapa. */
export const mappedActions = {
  email: enqueueEmail,
  set_value: writeValue,
} satisfies FlowActionHandlerMap;

const executeAction = async (
  action: FlowExecutableAction,
  runtime: FlowExecutionRuntime,
): Promise<void> => {
  const handler = mappedActions[action.type] as FlowActionHandler;
  await handler(action, runtime);
};

const executeV1 = async (
  definition: Schema.FlowDefinitionV1,
  runtime: FlowExecutionRuntime,
): Promise<void> => {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));

  const executeNode = async (nodeId: string): Promise<void> => {
    const node = nodes.get(nodeId);
    if (!node) throw new FlowExecutionError('validation', `Destino inexistente: ${nodeId}`);
    if (runtime.executedNodeIds.includes(node.id)) {
      throw new FlowExecutionError('validation', 'O flow contém um ciclo');
    }
    runtime.executedNodeIds.push(node.id);

    switch (node.type) {
      case 'callback':
        runtime.callback = String(runtime.macros.resolve(node.config.message ?? '', runtime.context));
        return;
      case 'start':
        return executeNode(node.config.nextNodeId);
      case 'switch': {
        const left = runtime.macros.resolve(node.config.left, runtime.context);
        const right = runtime.macros.resolve(node.config.right, runtime.context);
        return executeNode(compareFlowValues(node.config.operator, left, right)
          ? node.config.trueTargetId
          : node.config.falseTargetId);
      }
      case 'email':
      case 'set_value':
        await executeAction(node, runtime);
        return executeNode(node.config.nextNodeId);
    }
  };

  const first = definition.nodes[0];
  if (!first) throw new FlowExecutionError('validation', 'Flow não configurado');
  await executeNode(first.id);
  if (definition.nodes.at(-1)?.id !== runtime.executedNodeIds.at(-1)) {
    throw new FlowExecutionError('validation', 'O flow não alcançou o callback final');
  }
};

const executeV2 = async (
  definition: Schema.FlowDefinitionV2,
  runtime: FlowExecutionRuntime,
): Promise<void> => {
  const start = definition.nodes[0] as Schema.FlowStartNodeV2;
  const end = definition.nodes.at(-1) as Schema.FlowCallbackNodeV2;
  runtime.executedNodeIds.push(start.id);

  const executeSteps = async (steps: readonly Schema.FlowStepV2[]): Promise<void> => {
    for (const step of steps) {
      runtime.executedNodeIds.push(step.id);
      if (step.type === 'switch') {
        const left = step.config.columnId === 'page_title'
          ? runtime.source.row.title
          : runtime.rawValues.get(step.config.columnId);
        const branch = compareFlowValues(step.config.operator, left, step.config.value)
          ? step.config.whenTrue
          : step.config.whenFalse;
        await executeSteps(branch);
        continue;
      }
      await executeAction(step, runtime);
    }
  };

  await executeSteps(definition.nodes.slice(1, -1) as Schema.FlowStepV2[]);
  runtime.executedNodeIds.push(end.id);
  runtime.callback = String(runtime.macros.resolve(end.config.message ?? '', runtime.context));
};

export const executeFlowDefinition = async (
  definition: Schema.FlowDefinition,
  runtime: FlowExecutionRuntime,
): Promise<void> => {
  switch (definition.version) {
    case 1:
      return executeV1(definition, runtime);
    case 2:
      return executeV2(definition, runtime);
  }
};
