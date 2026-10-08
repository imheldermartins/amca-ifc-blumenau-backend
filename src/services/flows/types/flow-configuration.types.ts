import type { Schema } from '@/db/schemas/index';

export interface FlowConfigurationDto {
  flow: Schema.FlowDefinition | null;
}

export interface FlowMacroCatalogDto {
  macros: Schema.MacroDescriptor[];
}

export type FlowConfigurableAction =
  | Schema.FlowEmailNode
  | Schema.FlowSetValueNode
  | Schema.FlowEmailStepV2
  | Schema.FlowSetValueStepV2;

export interface FlowConfigurationValidationFailure {
  reason: 'validation' | 'forbidden';
  message: string;
}

export interface FlowConfigurationValidationContext {
  columns: readonly Schema.PageColumn[];
  descriptors: readonly Schema.MacroDescriptor[];
  canMutate(columnId: NonEmptyString): Promise<boolean>;
}

export type FlowConfigurationActionValidator<
  Action extends FlowConfigurableAction = FlowConfigurableAction,
> = (
  action: Action,
  context: FlowConfigurationValidationContext,
) => Promise<FlowConfigurationValidationFailure | null> | FlowConfigurationValidationFailure | null;

export type FlowConfigurationActionValidatorMap = {
  [Type in FlowConfigurableAction['type']]: FlowConfigurationActionValidator<
    Extract<FlowConfigurableAction, { type: Type }>
  >;
};
