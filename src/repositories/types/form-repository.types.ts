import type { Schema } from '@/db/schemas/index';
import type { CommitFlowExecutionInput } from '@/repositories/types/flow-repository.types';

export interface FormPublicationRecord extends Schema.PageFormPublication {}

export interface FormSubmissionRecord extends Schema.PageFormSubmission {
  page_title?: string | null;
  flow_data?: string | null;
}

export interface CommitFormSubmissionInput {
  publication: FormPublicationRecord;
  expectedSubmitTokenHash: string | null;
  submissionId: NonEmptyString;
  rowId: NonEmptyString;
  title: string | null;
  responseValues: Array<{ columnId: NonEmptyString; data: string }>;
  clientRequestId: string;
  payloadHash: string;
  flow: CommitFlowExecutionInput;
}

export interface FormReviewCursor {
  createdAt: string;
  id: string;
}
