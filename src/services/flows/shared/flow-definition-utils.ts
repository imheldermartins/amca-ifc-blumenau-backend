import type { Schema } from '@/db/schemas/index';
import type { FlowConfigurableAction } from '@/services/flows/types/flow-configuration.types';

export const FLOW_MAX_NODES = 100;
export const FLOW_MAX_TEXT = 20_000;
export const FLOW_PAGE_TITLE_COLUMN_ID = 'page_title';

export const flowRecipientKeys = (value: string): string[] => (
  [...new Set(value.split(/[;,]/).map((entry) => entry.trim()).filter(Boolean))]
);

/** Campos em que `@...` continua sendo macro; literais de condição v2 ficam fora. */
export const flowMacroInputs = (definition: Schema.FlowDefinition): unknown[] => {
  if (definition.version === 1) return [definition];

  const inputs: unknown[] = [];
  const visit = (steps: readonly Schema.FlowStepV2[]): void => {
    for (const step of steps) {
      if (step.type === 'switch') {
        visit(step.config.whenTrue);
        visit(step.config.whenFalse);
        continue;
      }
      inputs.push(step.config);
    }
  };

  visit(definition.nodes.slice(1, -1) as Schema.FlowStepV2[]);
  inputs.push(definition.nodes.at(-1)?.config);
  return inputs;
};

export const configurableFlowActions = (
  definition: Schema.FlowDefinition,
): FlowConfigurableAction[] => {
  if (definition.version === 1) {
    return definition.nodes.filter(
      (node): node is Schema.FlowEmailNode | Schema.FlowSetValueNode => (
        node.type === 'email' || node.type === 'set_value'
      ),
    );
  }

  const actions: FlowConfigurableAction[] = [];
  const visit = (steps: readonly Schema.FlowStepV2[]): void => {
    for (const step of steps) {
      if (step.type === 'switch') {
        visit(step.config.whenTrue);
        visit(step.config.whenFalse);
        continue;
      }
      actions.push(step);
    }
  };

  visit(definition.nodes.slice(1, -1) as Schema.FlowStepV2[]);
  return actions;
};

export const flowTargetsV1 = (node: Schema.FlowNode): string[] => {
  switch (node.type) {
    case 'callback':
      return [];
    case 'switch':
      return [node.config.trueTargetId, node.config.falseTargetId];
    case 'start':
    case 'email':
    case 'set_value':
      return [node.config.nextNodeId];
  }
};
