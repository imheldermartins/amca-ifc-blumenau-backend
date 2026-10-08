import type { FlowExecutionFailureReason } from '@/services/flows/types/flow-execution.types';

export class FlowExecutionError extends Error {
  public constructor(
    public readonly reason: FlowExecutionFailureReason,
    message: string,
  ) {
    super(message);
  }
}
