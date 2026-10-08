import type { Schema } from '@/db/schemas/index';
import {
  configurableFlowActions,
  flowRecipientKeys,
} from '@/services/flows/shared/flow-definition-utils';
import type {
  FlowConfigurableAction,
  FlowConfigurationActionValidator,
  FlowConfigurationActionValidatorMap,
  FlowConfigurationValidationContext,
  FlowConfigurationValidationFailure,
} from '@/services/flows/types/flow-configuration.types';

const validateEmail: FlowConfigurationActionValidator<
  Schema.FlowEmailNode | Schema.FlowEmailStepV2
> = (action, context) => {
  const incompatible = flowRecipientKeys(action.config.to).find((key) => {
    const recipient = context.descriptors.find((macro) => macro.key === key);
    if (!recipient) return true;

    switch (recipient.kind) {
      case 'person':
      case 'column':
        return recipient.valueType !== 'email';
      case 'page':
        return recipient.key !== '@page.title';
      case 'workspace':
        return true;
    }
  });

  return incompatible
    ? { reason: 'validation', message: 'Escolha membros ou variáveis de e-mail disponíveis' }
    : null;
};

const validateSetValue: FlowConfigurationActionValidator<
  Schema.FlowSetValueNode | Schema.FlowSetValueStepV2
> = async (action, context) => {
  const target = context.columns.find((candidate) => candidate.id === action.config.columnId);
  if (!target || target.type === 'flow') {
    return { reason: 'validation', message: 'Coluna de destino inválida' };
  }
  if (!await context.canMutate(target.id)) {
    return {
      reason: 'forbidden',
      message: `A coluna ${target.name ?? 'de destino'} está bloqueada`,
    };
  }
  return null;
};

export const mappedActionValidators = {
  email: validateEmail,
  set_value: validateSetValue,
} satisfies FlowConfigurationActionValidatorMap;

const validateAction = async (
  action: FlowConfigurableAction,
  context: FlowConfigurationValidationContext,
): Promise<FlowConfigurationValidationFailure | null> => {
  const validator = mappedActionValidators[action.type] as FlowConfigurationActionValidator;
  return validator(action, context);
};

export const validateFlowConfigurationActions = async (
  definition: Schema.FlowDefinition,
  context: FlowConfigurationValidationContext,
): Promise<FlowConfigurationValidationFailure | null> => {
  for (const action of configurableFlowActions(definition)) {
    const failure = await validateAction(action, context);
    if (failure) return failure;
  }
  return null;
};
