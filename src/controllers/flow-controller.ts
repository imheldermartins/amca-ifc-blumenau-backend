import type { ServiceResult } from '@/controllers/types/service-result.types';
import type { Schema } from '@/db/schemas/index';
import columnLockStore, { ColumnLockStore } from '@/repositories/column-lock-repository';
import flowStore, { FlowStore } from '@/repositories/flow-repository';
import flowDefinitionService, { FlowDefinitionService, flowRecipientKeys } from '@/services/flows/flow-definition-service';
import flowExecutionService, {
  FlowExecutionError,
  FlowExecutionService,
  type FlowExecutionOutcome,
} from '@/services/flows/flow-execution-service';
import macroService, { MacroService } from '@/services/macros/macro-service';

export interface FlowConfigurationDto {
  flow: Schema.FlowDefinition | null;
}

export interface FlowMacroCatalogDto {
  macros: Schema.MacroDescriptor[];
}

export class FlowController {
  public constructor(
    private readonly store: FlowStore = flowStore,
    private readonly definitions: FlowDefinitionService = flowDefinitionService,
    private readonly macros: MacroService = macroService,
    private readonly execution: FlowExecutionService = flowExecutionService,
    private readonly locks: ColumnLockStore = columnLockStore,
  ) {}

  public async getConfiguration(
    parentId: NonEmptyString,
    columnId: NonEmptyString,
  ): Promise<ServiceResult<FlowConfigurationDto>> {
    try {
      const column = await this.store.findFlowColumn(parentId, columnId);
      if (!column) return { ok: false, reason: 'not_found', message: 'Coluna Flow não encontrada' };
      return { ok: true, data: { flow: column.data?.flow ?? null } };
    } catch {
      return { ok: false, reason: 'server_error', message: 'Erro no servidor' };
    }
  }

  public async saveConfiguration(
    parentId: NonEmptyString,
    columnId: NonEmptyString,
    actorId: NonEmptyString,
    input: unknown,
  ): Promise<ServiceResult<FlowConfigurationDto>> {
    try {
      const column = await this.store.findFlowColumn(parentId, columnId);
      if (!column) return { ok: false, reason: 'not_found', message: 'Coluna Flow não encontrada' };
      const body = input && typeof input === 'object' && !Array.isArray(input)
        ? input as Record<string, unknown>
        : null;
      let flow: Schema.FlowDefinition;
      try { flow = this.definitions.parse(body?.flow); }
      catch (error) {
        return { ok: false, reason: 'validation', message: error instanceof Error ? error.message : 'Definição de flow inválida' };
      }

      const source = await this.store.macroCatalog(parentId);
      if (!source) return { ok: false, reason: 'not_found', message: 'Página da database não encontrada' };
      const catalog = this.macros.catalog({
        page: source.parent,
        workspace: source.workspace,
        columns: source.columns,
        people: source.people,
      });
      try { this.macros.assertKnown(flow, catalog.descriptors); }
      catch (error) {
        return { ok: false, reason: 'validation', message: error instanceof Error ? error.message : 'Macro inválida' };
      }

      for (const node of flow.nodes) {
        if (node.type === 'email') {
          const recipients = flowRecipientKeys(node.config.to);
          const incompatible = recipients.find((key) => {
            const recipient = catalog.descriptors.find((macro) => macro.key === key);
            return !recipient || !(
              (recipient.kind === 'person' && recipient.valueType === 'email')
              || (recipient.kind === 'column' && recipient.valueType === 'email')
              || recipient.key === '@page.title'
            );
          });
          if (incompatible) {
            return { ok: false, reason: 'validation', message: 'Escolha membros ou variáveis de e-mail disponíveis' };
          }
        }
        if (node.type === 'set_value') {
          const target = source.columns.find((candidate) => candidate.id === node.config.columnId);
          if (!target || target.type === 'flow') {
            return { ok: false, reason: 'validation', message: 'Coluna de destino inválida' };
          }
          if (!await this.locks.canMutate(parentId, target.id, actorId)) {
            return { ok: false, reason: 'forbidden', message: `A coluna ${target.name ?? 'de destino'} está bloqueada` };
          }
        }
      }

      const saved = await this.store.saveDefinition(parentId, columnId, flow);
      return saved
        ? { ok: true, data: { flow } }
        : { ok: false, reason: 'server_error', message: 'Não foi possível salvar o flow' };
    } catch {
      return { ok: false, reason: 'server_error', message: 'Erro no servidor' };
    }
  }

  public async listMacros(
    parentId: NonEmptyString,
    columnId: NonEmptyString,
    rowId?: NonEmptyString,
  ): Promise<ServiceResult<FlowMacroCatalogDto>> {
    try {
      const column = await this.store.findFlowColumn(parentId, columnId);
      if (!column) return { ok: false, reason: 'not_found', message: 'Coluna Flow não encontrada' };
      let catalog;
      if (rowId) {
        const source = await this.store.executionSource(rowId, columnId);
        if (!source || source.flowColumn.parent_id !== parentId) {
          return { ok: false, reason: 'not_found', message: 'Página não encontrada nesta database' };
        }
        catalog = this.macros.catalog({
          page: source.row,
          workspace: source.workspace,
          columns: source.columns,
          people: source.people,
          values: source.values,
        });
      } else {
        const source = await this.store.macroCatalog(parentId);
        if (!source) {
          return { ok: false, reason: 'not_found', message: 'Página da database não encontrada' };
        }
        catalog = this.macros.catalog({
          page: source.parent,
          workspace: source.workspace,
          columns: source.columns,
          people: source.people,
        });
      }
      const descriptors = rowId
        ? [...catalog.descriptors]
        : catalog.descriptors.map((descriptor) => descriptor.key === '@page.title'
          ? { ...descriptor, preview: null }
          : descriptor);
      return { ok: true, data: { macros: descriptors } };
    } catch {
      return { ok: false, reason: 'server_error', message: 'Erro no servidor' };
    }
  }

  public async execute(
    rowId: NonEmptyString,
    columnId: NonEmptyString,
    actorId: NonEmptyString,
  ): Promise<ServiceResult<FlowExecutionOutcome>> {
    try {
      return { ok: true, data: await this.execution.execute(rowId, columnId, actorId) };
    } catch (error) {
      if (error instanceof FlowExecutionError) {
        return { ok: false, reason: error.reason, message: error.message };
      }
      return { ok: false, reason: 'server_error', message: 'Erro no servidor' };
    }
  }
}

export default new FlowController();
