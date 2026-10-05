import type { Schema } from '@/db/schemas/index';
import type { EmailOutboxPayload } from '@/repositories/types/notification-repository.types';

export interface FlowMacroPerson extends Schema.PageCollaboratorSummary {}

export interface FlowMacroCatalogSource {
  parent: Schema.Page;
  workspace: Schema.Workspace;
  columns: Schema.PageColumn[];
  people: FlowMacroPerson[];
}

export interface FlowExecutionSource extends FlowMacroCatalogSource {
  row: Schema.Page;
  flowColumn: Schema.PageColumn;
  values: Schema.PageColumnValue[];
}

export interface FlowValueWrite {
  columnId: NonEmptyString;
  data: string;
}

export interface FlowEmailWrite {
  nodeId: string;
  recipientUserId: NonEmptyString | null;
  recipientEmail: string;
  payload: EmailOutboxPayload;
}

export interface CommitFlowExecutionInput {
  executionId: NonEmptyString;
  actorUserId: NonEmptyString | null;
  source: FlowExecutionSource;
  flowColumnData: string;
  summary: Schema.FlowExecutionSummary;
  values: FlowValueWrite[];
  emails: FlowEmailWrite[];
}
