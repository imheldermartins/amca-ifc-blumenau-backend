import type { Schema } from '@/db/schemas/index';

export type PublicFormFieldType = Exclude<Schema.ColumnType, 'flow'>;

export interface PublicFormField {
  readOnly?: boolean;
  key: string;
  label: string;
  type: PublicFormFieldType;
  mask?: Schema.TextMask;
  format?: Schema.NumberFormat;
  currency?: Schema.CurrencyCode;
  options?: Array<{ key: string; label: string; color?: Schema.ColorOptions }>;
}

export interface PublicFormDefinition {
  version: 1;
  publicationId: string;
  title: string | null;
  name: string;
  submitButton: { label: string; icon: string | null };
  fields: PublicFormField[];
}

export interface FormPublicationStatus {
  publicationId: string;
  published: boolean;
  revokedAt: string | null;
  expiresAt: string | null;
  fillKeyHint: string;
  reviewKeyHint: string;
}

export interface FormPublicationSecrets extends FormPublicationStatus {
  fillKey: string;
  reviewKey: string;
}

export interface FormSubmissionPayload {
  fields: Array<{ key: string; value: unknown }>;
}

export interface FormSubmissionResult {
  submissionId: string;
  submittedAt: string;
  callback: string | null;
}

/** Metadados internos para publicar o efeito depois do commit HTTP. */
export interface FormSubmissionOutcome {
  result: FormSubmissionResult;
  realtime: {
    pageId: string;
    rowId: string;
    originUserId: string;
  } | null;
}

export interface PublicFormReviewPage {
  version: 1;
  publicationId: string;
  form: Pick<PublicFormDefinition, 'title' | 'name' | 'fields'>;
  submissions: Array<{
    submissionId: string;
    submittedAt: string;
    answers: Array<{ key: string; value: unknown }>;
    flow: { status: 'succeeded'; callback: string | null };
  }>;
  nextCursor: string | null;
}
