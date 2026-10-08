import type { Schema } from '@/db/schemas/index';
import { parseFlowDefinition } from '@/services/flows/shared/flow-definition-parser';
import {
  flowMacroInputs,
  flowRecipientKeys,
} from '@/services/flows/shared/flow-definition-utils';
import { validateFlowDefinitionColumns } from '@/services/flows/shared/flow-definition-validator';

export { flowMacroInputs, flowRecipientKeys };

/** Fachada de validação e normalização do documento antes da persistência. */
export class FlowDefinitionService {
  public parse(input: unknown): Schema.FlowDefinition {
    return parseFlowDefinition(input);
  }

  /** Validação semântica do v2 contra as colunas atuais da database. */
  public validateAgainstColumns(
    definition: Schema.FlowDefinition,
    columns: readonly Schema.PageColumn[],
  ): void {
    validateFlowDefinitionColumns(definition, columns);
  }
}

export default new FlowDefinitionService();
