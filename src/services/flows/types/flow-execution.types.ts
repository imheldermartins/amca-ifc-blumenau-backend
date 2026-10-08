import type { Schema } from '@/db/schemas/index';
import type {
  FlowEmailWrite,
  FlowExecutionSource,
  FlowValueWrite,
} from '@/repositories/types/flow-repository.types';
import type { MacroService, MacroResolutionContext } from '@/services/macros/macro-service';

export type FlowExecutionFailureReason = 'not_found' | 'validation' | 'forbidden' | 'server_error';

export interface FlowExecutionOutcome {
  summary: Schema.FlowExecutionSummary;
  updatedValues: { columnId: string; columnType: Schema.ColumnType; value: unknown }[];
}

export interface FlowExecutionAuthorization {
  assertFlowWritable(source: FlowExecutionSource): Promise<void>;
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

export type FlowExecutableAction =
  | Schema.FlowEmailNode
  | Schema.FlowSetValueNode
  | Schema.FlowEmailStepV2
  | Schema.FlowSetValueStepV2;

export type FlowValueWriteWithValue = FlowValueWrite & { value: unknown };

export interface FlowExecutionRuntime {
  source: FlowExecutionSource;
  authorization: FlowExecutionAuthorization;
  policy: FlowExecutionPolicy;
  macros: MacroService;
  context: MacroResolutionContext;
  executedNodeIds: string[];
  valueWrites: Map<string, FlowValueWriteWithValue>;
  emails: FlowEmailWrite[];
  rawValues: Map<string, unknown>;
  callback: string | null;
}

export type FlowActionHandler<Action extends FlowExecutableAction = FlowExecutableAction> = (
  action: Action,
  runtime: FlowExecutionRuntime,
) => Promise<void> | void;

export type FlowActionHandlerMap = {
  [Type in FlowExecutableAction['type']]: FlowActionHandler<Extract<FlowExecutableAction, { type: Type }>>;
};
