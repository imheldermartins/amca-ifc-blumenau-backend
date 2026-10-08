import { ulid } from 'ulid';

import columnLockStore, { ColumnLockStore } from '@/repositories/column-lock-repository';
import flowStore, { FlowStore } from '@/repositories/flow-repository';
import type { FlowExecutionSource } from '@/repositories/types/flow-repository.types';
import flowDefinitionService, { FlowDefinitionService } from '@/services/flows/flow-definition-service';
import { FlowExecutionError } from '@/services/flows/flow-execution-error';
import { executeFlowDefinition } from '@/services/flows/shared/flow-action-executor';
import { flowMacroInputs } from '@/services/flows/shared/flow-definition-utils';
import {
  buildFlowExecutionPlan,
  decodeFlowValues,
} from '@/services/flows/shared/flow-execution-utils';
import type {
  FlowExecutionAuthorization,
  FlowExecutionOutcome,
  FlowExecutionPlan,
  FlowExecutionPolicy,
  FlowExecutionRuntime,
} from '@/services/flows/types/flow-execution.types';
import macroService, { MacroService } from '@/services/macros/macro-service';

export { FlowExecutionError } from '@/services/flows/flow-execution-error';
export type {
  FlowExecutionAuthorization,
  FlowExecutionFailureReason,
  FlowExecutionOutcome,
  FlowExecutionPlan,
  FlowExecutionPolicy,
} from '@/services/flows/types/flow-execution.types';

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
          throw new FlowExecutionError(
            'forbidden',
            `A coluna ${column.name ?? 'de destino'} está bloqueada`,
          );
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
    source: FlowExecutionSource,
    authorization: FlowExecutionAuthorization,
    policy: FlowExecutionPolicy,
  ): Promise<FlowExecutionPlan> {
    await authorization.assertFlowWritable(source);

    const definition = this.parseDefinition(source);
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
      throw new FlowExecutionError(
        'validation',
        error instanceof Error ? error.message : 'Macro inválida',
      );
    }

    const startedAt = this.now().toISOString();
    const executionId = ulid() as NonEmptyString;
    const runtime: FlowExecutionRuntime = {
      source,
      authorization,
      policy,
      macros: this.macros,
      context,
      executedNodeIds: [],
      valueWrites: new Map(),
      emails: [],
      rawValues: decodeFlowValues(source),
      callback: null,
    };

    await executeFlowDefinition(definition, runtime);
    return buildFlowExecutionPlan(
      executionId,
      startedAt,
      this.now().toISOString(),
      runtime,
    );
  }

  private parseDefinition(source: FlowExecutionSource) {
    try {
      const definition = this.definitions.parse(source.flowColumn.data?.flow);
      this.definitions.validateAgainstColumns(definition, source.columns);
      return definition;
    } catch (error) {
      throw new FlowExecutionError(
        'validation',
        error instanceof Error ? error.message : 'Flow não configurado',
      );
    }
  }
}

export default new FlowExecutionService();
