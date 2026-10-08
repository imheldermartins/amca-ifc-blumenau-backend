import { describe, expect, it, vi } from 'vitest';

import type { Schema } from '@/db/schemas/index';
import type { ColumnLockStore } from '@/repositories/column-lock-repository';
import type { FlowStore } from '@/repositories/flow-repository';
import type {
  CommitFlowExecutionInput,
  FlowExecutionSource,
} from '@/repositories/types/flow-repository.types';

import { FlowDefinitionService } from './flow-definition-service.js';
import { FlowExecutionError, FlowExecutionService } from './flow-execution-service.js';
import { MacroService } from '../macros/macro-service.js';

const timestamp = '2026-09-30T12:00:00.000Z';

function entity<T extends object>(id: string, input: T): T & {
  id: NonEmptyString;
  created_at: string;
  updated_at: string;
} {
  return { id: id as NonEmptyString, created_at: timestamp, updated_at: timestamp, ...input };
}

function source(): FlowExecutionSource {
  const definition: Schema.FlowDefinition = {
    version: 1,
    trigger: { type: 'manual' },
    nodes: [
      { id: 'start', type: 'start', config: { nextNodeId: 'decision' } },
      {
        id: 'decision',
        type: 'switch',
        config: {
          left: '@columns.score',
          operator: 'greater_than',
          right: 5,
          trueTargetId: 'update',
          falseTargetId: 'done',
        },
      },
      {
        id: 'update',
        type: 'set_value',
        config: { columnId: 'score' as NonEmptyString, value: '42', nextNodeId: 'done' },
      },
      { id: 'done', type: 'callback', config: { message: 'Atualizado para @columns.score' } },
    ],
  };
  const score = entity('score', {
    deleted_at: null,
    name: 'Pontuação',
    type: 'numeric' as const,
    data: {},
    parent_id: 'database' as NonEmptyString,
  });
  const flowColumn = entity('flow', {
    deleted_at: null,
    name: 'Automação',
    type: 'flow' as const,
    data: { flow: definition },
    parent_id: 'database' as NonEmptyString,
  });
  return {
    parent: entity('database', {
      deleted_at: null,
      title: 'Solicitações',
      data: {},
      owner_id: 'owner' as NonEmptyString,
    }),
    row: entity('row', {
      deleted_at: null,
      title: 'Reserva 101',
      data: {},
      owner_id: 'owner' as NonEmptyString,
    }),
    workspace: entity('workspace', {
      name: 'SIRA',
      data: {},
      organization_id: null,
      icon: 'lucide:boxes',
      created_by_user_id: 'owner' as NonEmptyString,
    }),
    columns: [score, flowColumn],
    flowColumn,
    people: [],
    values: [entity('score-value', {
      data: JSON.stringify({ value: 10 }),
      page_column_id: 'score' as NonEmptyString,
      page_id: 'row' as NonEmptyString,
    })],
  };
}

describe('FlowExecutionService', () => {
  it('executa somente o ramo falso v2 e continua depois da condição', async () => {
    const executionSource = source()
    executionSource.flowColumn.data = {
      flow: {
        version: 2,
        trigger: { type: 'manual' },
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'decision', type: 'switch', config: {
            columnId: 'score', operator: 'greater_than', value: 50,
            whenTrue: [{ id: 'yes', type: 'set_value', config: { columnId: 'score', value: '90' } }],
            whenFalse: [{ id: 'no', type: 'set_value', config: { columnId: 'score', value: '1' } }],
          } },
          { id: 'common', type: 'set_value', config: { columnId: 'score', value: '2' } },
          { id: 'done', type: 'callback', config: { message: 'Fim' } },
        ],
      },
    }
    const commitExecution = vi.fn(async (_input: CommitFlowExecutionInput) => true)
    const service = new FlowExecutionService(
      { executionSource: vi.fn(async () => executionSource), commitExecution } as unknown as FlowStore,
      new FlowDefinitionService(),
      new MacroService(),
      { canMutate: vi.fn(async () => true) } as unknown as ColumnLockStore,
      () => new Date(timestamp),
    )

    const outcome = await service.execute('row' as NonEmptyString, 'flow' as NonEmptyString, 'actor' as NonEmptyString)

    expect(outcome.summary.executedNodeIds).toEqual(['start', 'decision', 'no', 'common', 'done'])
    expect(outcome.updatedValues).toEqual([{ columnId: 'score', columnType: 'numeric', value: 2 }])
  })

  it('executa condições v2 aninhadas, usa IDs de select e reencontra a continuação comum', async () => {
    const executionSource = source()
    const approved = '01M40000000000000000000001' as NonEmptyString
    const status = entity('status', {
      deleted_at: null,
      name: 'Status',
      type: 'select' as const,
      data: { options: [{ id: approved, value: 'Aprovado renomeado' }] },
      parent_id: 'database' as NonEmptyString,
    })
    executionSource.columns = [status, ...executionSource.columns]
    executionSource.values.push(entity('status-value', {
      data: JSON.stringify({ value: approved }),
      page_column_id: 'status' as NonEmptyString,
      page_id: 'row' as NonEmptyString,
    }))
    executionSource.flowColumn.data = {
      flow: {
        version: 2,
        trigger: { type: 'manual' },
        nodes: [
          { id: 'start', type: 'start', config: {} },
          {
            id: 'status-decision',
            type: 'switch',
            config: {
              columnId: 'status', operator: 'equals', value: approved,
              whenTrue: [{
                id: 'score-decision',
                type: 'switch',
                config: {
                  columnId: 'score', operator: 'greater_than', value: 5,
                  whenTrue: [{ id: 'lower-score', type: 'set_value', config: { columnId: 'score', value: '2' } }],
                  whenFalse: [{ id: 'nested-false', type: 'set_value', config: { columnId: 'score', value: '90' } }],
                },
              }],
              whenFalse: [{ id: 'status-false', type: 'set_value', config: { columnId: 'score', value: '80' } }],
            },
          },
          {
            id: 'updated-decision',
            type: 'switch',
            config: {
              columnId: 'score', operator: 'less_than', value: 5,
              whenTrue: [{ id: 'uses-updated-value', type: 'set_value', config: { columnId: 'score', value: '7' } }],
              whenFalse: [{ id: 'stale-value-path', type: 'set_value', config: { columnId: 'score', value: '70' } }],
            },
          },
          { id: 'common', type: 'set_value', config: { columnId: 'score', value: '9' } },
          { id: 'done', type: 'callback', config: { message: 'Pontuação @columns.score' } },
        ],
      },
    }
    const commitExecution = vi.fn(async (_input: CommitFlowExecutionInput) => true)
    const service = new FlowExecutionService(
      { executionSource: vi.fn(async () => executionSource), commitExecution } as unknown as FlowStore,
      new FlowDefinitionService(),
      new MacroService(),
      { canMutate: vi.fn(async () => true) } as unknown as ColumnLockStore,
      () => new Date(timestamp),
    )

    const outcome = await service.execute('row' as NonEmptyString, 'flow' as NonEmptyString, 'actor' as NonEmptyString)

    expect(outcome.summary.executedNodeIds).toEqual([
      'start', 'status-decision', 'score-decision', 'lower-score',
      'updated-decision', 'uses-updated-value', 'common', 'done',
    ])
    expect(outcome.summary.executedNodeIds).not.toContain('status-false')
    expect(outcome.summary.executedNodeIds).not.toContain('nested-false')
    expect(outcome.summary.executedNodeIds).not.toContain('stale-value-path')
    expect(outcome.summary.callback).toBe('Pontuação 9')
    expect(outcome.updatedValues).toEqual([{ columnId: 'score', columnType: 'numeric', value: 9 }])
    expect(commitExecution).toHaveBeenCalledTimes(1)
  })

  it('executa branch, atualiza macro em memória e envia um único commit', async () => {
    const executionSource = source();
    const commitExecution = vi.fn(async (_input: CommitFlowExecutionInput) => true);
    const flows = {
      executionSource: vi.fn(async () => executionSource),
      commitExecution,
    } as unknown as FlowStore;
    const canMutate = vi.fn(async () => true);
    const locks = { canMutate } as unknown as ColumnLockStore;
    const clock = new Date(timestamp);
    const service = new FlowExecutionService(
      flows,
      new FlowDefinitionService(),
      new MacroService(),
      locks,
      () => clock,
    );

    const outcome = await service.execute(
      'row' as NonEmptyString,
      'flow' as NonEmptyString,
      'actor' as NonEmptyString,
    );

    expect(outcome.summary).toMatchObject({
      status: 'succeeded',
      startedAt: timestamp,
      finishedAt: timestamp,
      executedNodeIds: ['start', 'decision', 'update', 'done'],
      callback: 'Atualizado para 42',
      effects: { emailsQueued: 0, valuesUpdated: 1 },
    });
    expect(outcome.updatedValues).toEqual([{ columnId: 'score', columnType: 'numeric', value: 42 }]);
    expect(canMutate).toHaveBeenNthCalledWith(1, 'database', 'flow', 'actor');
    expect(canMutate).toHaveBeenNthCalledWith(2, 'database', 'score', 'actor');
    expect(commitExecution).toHaveBeenCalledTimes(1);
    expect(commitExecution.mock.calls[0]![0]).toMatchObject({
      actorUserId: 'actor',
      source: executionSource,
      values: [{ columnId: 'score', data: JSON.stringify({ value: 42 }) }],
      emails: [],
    });
  });

  it('mantém a projeção textual do select depois de atualizar a coluna', async () => {
    const executionSource = source();
    const optionId = '01M40000000000000000000001' as NonEmptyString;
    const room = entity('room', {
      deleted_at: null,
      name: 'Sala',
      type: 'select' as const,
      data: { options: [{ id: optionId, value: 'Laboratório 01' }] },
      parent_id: 'database' as NonEmptyString,
    });
    executionSource.columns = [room, executionSource.flowColumn];
    executionSource.values = [];
    executionSource.flowColumn.data = {
      flow: {
        version: 1,
        trigger: { type: 'manual' },
        nodes: [
          { id: 'start', type: 'start', config: { nextNodeId: 'update' } },
          {
            id: 'update',
            type: 'set_value',
            config: { columnId: room.id, value: optionId, nextNodeId: 'done' },
          },
          { id: 'done', type: 'callback', config: { message: 'Sala: @columns.room' } },
        ],
      },
    };
    const commitExecution = vi.fn(async (_input: CommitFlowExecutionInput) => true);
    const flows = {
      executionSource: vi.fn(async () => executionSource),
      commitExecution,
    } as unknown as FlowStore;
    const locks = { canMutate: vi.fn(async () => true) } as unknown as ColumnLockStore;
    const service = new FlowExecutionService(
      flows,
      new FlowDefinitionService(),
      new MacroService(),
      locks,
      () => new Date(timestamp),
    );

    const outcome = await service.execute(
      'row' as NonEmptyString,
      'flow' as NonEmptyString,
      'actor' as NonEmptyString,
    );

    expect(outcome.summary.callback).toBe('Sala: Laboratório 01');
    expect(outcome.updatedValues).toEqual([{ columnId: 'room', columnType: 'select', value: optionId }]);
    expect(commitExecution.mock.calls[0]![0]).toMatchObject({
      values: [{ columnId: 'room', data: JSON.stringify({ value: optionId }) }],
    });
  });

  it('interrompe antes de interpretar o flow quando a coluna está bloqueada', async () => {
    const commitExecution = vi.fn(async (_input: CommitFlowExecutionInput) => true);
    const flows = {
      executionSource: vi.fn(async () => source()),
      commitExecution,
    } as unknown as FlowStore;
    const locks = { canMutate: vi.fn(async () => false) } as unknown as ColumnLockStore;
    const service = new FlowExecutionService(
      flows,
      new FlowDefinitionService(),
      new MacroService(),
      locks,
    );

    await expect(service.execute(
      'row' as NonEmptyString,
      'flow' as NonEmptyString,
      'actor' as NonEmptyString,
    )).rejects.toMatchObject<Partial<FlowExecutionError>>({
      reason: 'forbidden',
      message: 'Coluna bloqueada para execução',
    });
    expect(commitExecution).not.toHaveBeenCalled();
  });

  it('cria uma entrega independente para cada destinatário sem duplicar membros', async () => {
    const executionSource = source();
    executionSource.people = [
      { id: 'user-1' as NonEmptyString, name: 'Ana', email: 'ana@example.test' },
      { id: 'user-2' as NonEmptyString, name: 'Bruno', email: 'bruno@example.test' },
    ];
    executionSource.flowColumn.data = {
      flow: {
        version: 1,
        trigger: { type: 'manual' },
        nodes: [
          { id: 'start', type: 'start', config: { nextNodeId: 'notify' } },
          {
            id: 'notify',
            type: 'email',
            config: {
              to: '@people.user-1.email, @people.user-2.email, @people.user-1.email',
              subject: 'Reserva @page.title',
              body: 'Workspace @workspace.name',
              nextNodeId: 'done',
            },
          },
          { id: 'done', type: 'callback', config: { message: 'Notificado' } },
        ],
      },
    };
    const commitExecution = vi.fn(async (_input: CommitFlowExecutionInput) => true);
    const flows = {
      executionSource: vi.fn(async () => executionSource),
      commitExecution,
    } as unknown as FlowStore;
    const locks = { canMutate: vi.fn(async () => true) } as unknown as ColumnLockStore;
    const service = new FlowExecutionService(
      flows,
      new FlowDefinitionService(),
      new MacroService(),
      locks,
      () => new Date(timestamp),
    );

    const outcome = await service.execute(
      'row' as NonEmptyString,
      'flow' as NonEmptyString,
      'actor' as NonEmptyString,
    );

    expect(outcome.summary.effects.emailsQueued).toBe(2);
    const committed = commitExecution.mock.calls[0]![0];
    expect(committed.emails).toHaveLength(2);
    expect(committed.emails.map((email) => email.recipientUserId)).toEqual(['user-1', 'user-2']);
    expect(committed.emails.map((email) => email.payload.to.email)).toEqual([
      'ana@example.test',
      'bruno@example.test',
    ]);
  });

  it('resolve page.title e colunas mask=email no contexto da row', async () => {
    const executionSource = source();
    executionSource.row.title = 'externo@example.test';
    executionSource.people = [
      { id: 'user-2' as NonEmptyString, name: 'Bruno', email: 'bruno@example.test' },
    ];
    executionSource.columns.splice(1, 0, entity('contact', {
      deleted_at: null,
      name: 'E-mail de contato',
      type: 'text' as const,
      data: { mask: 'email' as const },
      parent_id: 'database' as NonEmptyString,
    }));
    executionSource.values.push(entity('contact-value', {
      data: JSON.stringify({ value: 'bruno@example.test' }),
      page_column_id: 'contact' as NonEmptyString,
      page_id: 'row' as NonEmptyString,
    }));
    executionSource.flowColumn.data = {
      flow: {
        version: 1,
        trigger: { type: 'manual' },
        nodes: [
          { id: 'start', type: 'start', config: { nextNodeId: 'notify' } },
          {
            id: 'notify',
            type: 'email',
            config: {
              to: '@page.title, @columns.contact',
              subject: 'Reserva @page.title',
              body: 'Workspace @workspace.name',
              nextNodeId: 'done',
            },
          },
          { id: 'done', type: 'callback', config: { message: 'Notificado' } },
        ],
      },
    };
    const commitExecution = vi.fn(async (_input: CommitFlowExecutionInput) => true);
    const flows = {
      executionSource: vi.fn(async () => executionSource),
      commitExecution,
    } as unknown as FlowStore;
    const locks = { canMutate: vi.fn(async () => true) } as unknown as ColumnLockStore;
    const service = new FlowExecutionService(
      flows,
      new FlowDefinitionService(),
      new MacroService(),
      locks,
      () => new Date(timestamp),
    );

    const outcome = await service.execute(
      'row' as NonEmptyString,
      'flow' as NonEmptyString,
      'actor' as NonEmptyString,
    );

    expect(outcome.summary.effects.emailsQueued).toBe(2);
    expect(commitExecution.mock.calls[0]![0].emails).toEqual([
      expect.objectContaining({ recipientUserId: null, recipientEmail: 'externo@example.test' }),
      expect.objectContaining({ recipientUserId: 'user-2', recipientEmail: 'bruno@example.test' }),
    ]);
  });
});
