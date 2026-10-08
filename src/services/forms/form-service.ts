import { createHash, timingSafeEqual } from 'node:crypto';
import { ulid } from 'ulid';

import type { Schema } from '@/db/schemas/index';
import columnLockStore, { ColumnLockStore } from '@/repositories/column-lock-repository';
import formStore, { FormStore } from '@/repositories/form-repository';
import flowStore, { FlowStore } from '@/repositories/flow-repository';
import type { FormPublicationRecord } from '@/repositories/types/form-repository.types';
import { FlowExecutionError } from '@/services/flows/flow-execution-error';
import flowExecutionService, { FlowExecutionService } from '@/services/flows/flow-execution-service';
import type { FlowExecutionAuthorization } from '@/services/flows/types/flow-execution.types';
import {
  assertFormFlowColumn,
  isJsonRecord,
  isUlid,
  parsePageViewFormConfig,
} from '@/services/pages/views/page-view-parsers';
import { PageViewContextService } from '@/services/pages/views/page-view-context-service';
import { sanitizePublicKeyMetadata } from '@/services/public-key';
import {
  createOpaqueToken,
  hashOpaqueToken,
  isOpaqueToken,
  opaqueTokenHint,
} from '@/services/opaque-token';
import { VALUE_CODECS } from '@/services/value-codec';
import { TITLE_COLUMN_ID } from '@/services/view-filters-v2';
import type {
  FormPublicationSecrets,
  FormPublicationStatus,
  FormSubmissionOutcome,
  PublicFormDefinition,
  PublicFormField,
  PublicFormReviewPage,
} from '@/services/forms/form.types';

export type FormFailureReason = 'not_found' | 'validation' | 'forbidden' | 'conflict' | 'server_error';

export class FormError extends Error {
  public constructor(public readonly reason: FormFailureReason, message: string) {
    super(message);
  }
}

interface ResolvedField {
  definition: PublicFormField;
  column: Schema.PageColumn | null;
  title: boolean;
  optionIdsByKey: Map<string, string>;
  optionKeysById: Map<string, string>;
}

interface ResolvedForm {
  definition: PublicFormDefinition;
  publication: FormPublicationRecord;
  page: Schema.Page;
  columns: Schema.PageColumn[];
  flowColumn: Schema.PageColumn;
  fields: ResolvedField[];
  fillFields: ResolvedField[];
}

function active(publication: FormPublicationRecord): boolean {
  return publication.revoked_at == null
    && (publication.expires_at == null || Date.parse(publication.expires_at) > Date.now());
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function payloadHash(fields: Array<{ key: string; value: unknown }>): string {
  const canonical = [...fields]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key, value }) => [key, value]);
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function decodeCursor(value: string | undefined): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!isJsonRecord(parsed) || typeof parsed.createdAt !== 'string' || !isUlid(parsed.id)) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

export class FormService {
  public constructor(
    private readonly forms: FormStore = formStore,
    private readonly views = new PageViewContextService(),
    private readonly flows: FlowStore = flowStore,
    private readonly executor: FlowExecutionService = flowExecutionService,
    private readonly locks: ColumnLockStore = columnLockStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async publicationStatus(pageId: string, viewId: string): Promise<FormPublicationStatus | null> {
    if (!isUlid(pageId) || !isUlid(viewId)) throw new FormError('validation', 'Formulário inválido');
    await this.resolveView(pageId, viewId);
    const publication = await this.forms.publicationByPageView(pageId, viewId);
    return publication ? this.status(publication) : null;
  }

  public async publish(
    pageId: string,
    viewId: string,
    userId: string,
    rawExpiresAt: unknown,
  ): Promise<FormPublicationSecrets> {
    if (!isUlid(pageId) || !isUlid(viewId) || !isUlid(userId)) {
      throw new FormError('validation', 'Publicação inválida');
    }
    await this.resolveView(pageId, viewId);
    const expiresAt = rawExpiresAt == null ? null : String(rawExpiresAt);
    if (expiresAt !== null && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      throw new FormError('validation', 'Expiração inválida');
    }
    const fillKey = createOpaqueToken('cubs_form_fill_v1_');
    const reviewKey = createOpaqueToken('cubs_form_review_v1_');
    const publication = await this.forms.publish({
      pageId,
      viewId,
      userId,
      submitTokenHash: hashOpaqueToken(fillKey),
      submitTokenHint: opaqueTokenHint(fillKey),
      reviewTokenHash: hashOpaqueToken(reviewKey),
      reviewTokenHint: opaqueTokenHint(reviewKey),
      expiresAt,
    });
    if (!publication) throw new FormError('server_error', 'Não foi possível publicar o formulário');
    return { ...this.status(publication), fillKey, reviewKey };
  }

  public async revoke(pageId: string, viewId: string): Promise<void> {
    if (!isUlid(pageId) || !isUlid(viewId)) throw new FormError('validation', 'Formulário inválido');
    if (!await this.forms.revoke(pageId, viewId)) {
      throw new FormError('not_found', 'Publicação não encontrada');
    }
  }

  public async publicDefinition(publicationId: string, capability: unknown): Promise<PublicFormDefinition> {
    const publication = await this.authorize(publicationId, capability, 'fill');
    const resolved = await this.resolve(publication);
    const locks = await this.locks.list(publication.page_id);
    if (locks === null) throw new FormError('not_found', 'Base do formulário não encontrada');
    return { ...resolved.definition, fields: resolved.fillFields.map((field) => ({
      ...field.definition, readOnly: Boolean(locks[field.title ? 'title' : field.column!.id]),
    })) };
  }

  public async submitPublic(
    publicationId: string,
    capability: unknown,
    clientRequestId: unknown,
    payload: unknown,
  ): Promise<FormSubmissionOutcome> {
    const publication = await this.authorize(publicationId, capability, 'fill');
    return this.submit(publication, clientRequestId, payload, null, true, hashOpaqueToken(String(capability)));
  }

  public async submitAuthenticated(
    pageId: string,
    viewId: string,
    userId: string,
    clientRequestId: unknown,
    payload: unknown,
  ): Promise<FormSubmissionOutcome> {
    await this.resolveView(pageId, viewId);
    let publication = await this.forms.publicationByPageView(pageId, viewId);
    if (!publication) {
      const fillKey = createOpaqueToken('cubs_form_fill_v1_');
      const reviewKey = createOpaqueToken('cubs_form_review_v1_');
      publication = await this.forms.createDraft({
        pageId,
        viewId,
        userId,
        submitTokenHash: hashOpaqueToken(fillKey),
        submitTokenHint: opaqueTokenHint(fillKey),
        reviewTokenHash: hashOpaqueToken(reviewKey),
        reviewTokenHint: opaqueTokenHint(reviewKey),
      });
    }
    if (!publication) throw new FormError('server_error', 'Não foi possível preparar o formulário');
    return this.submit(publication, clientRequestId, payload, userId, false, null);
  }

  public async review(
    publicationId: string,
    capability: unknown,
    cursorValue: string | undefined,
    rawLimit: unknown,
  ): Promise<PublicFormReviewPage> {
    const publication = await this.authorize(publicationId, capability, 'review');
    const resolved = await this.resolve(publication);
    const cursor = decodeCursor(cursorValue);
    if (cursorValue && !cursor) throw new FormError('validation', 'Cursor inválido');
    const requestedLimit = Number(rawLimit ?? 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const records = await this.forms.reviewPage(publication.id, limit + 1, cursor);
    const page = records.slice(0, limit);
    const rawValues = await this.forms.responseValues(page.map((record) => record.response_page_id));
    const valuesByPage = new Map<string, Map<string, string>>();
    for (const value of rawValues) {
      const map = valuesByPage.get(value.page_id) ?? new Map<string, string>();
      map.set(value.page_column_id, value.data);
      valuesByPage.set(value.page_id, map);
    }
    return {
      version: 1,
      publicationId: publication.id,
      form: {
        title: resolved.definition.title,
        name: resolved.definition.name,
        // Review mostra também campos ocultos do preenchimento, pois o Flow
        // pode materializá-los (ex.: status calculado após o envio).
        fields: resolved.fields.map((field) => field.definition),
      },
      submissions: page.map((record) => {
        const rowValues = valuesByPage.get(record.response_page_id) ?? new Map();
        const summary = record.flow_data
          ? VALUE_CODECS.flow.decode(record.flow_data) as Schema.FlowExecutionSummary
          : null;
        return {
          submissionId: record.id,
          submittedAt: record.created_at,
          answers: resolved.fields.map((field) => {
            if (field.title) return { key: field.definition.key, value: record.page_title ?? null };
            const raw = field.column ? rowValues.get(field.column.id) : undefined;
            let value = raw === undefined || !field.column
              ? null
              : VALUE_CODECS[field.column.type].decode(raw);
            if (field.column?.type === 'select' && typeof value === 'string') {
              value = field.optionKeysById.get(value) ?? null;
            }
            return { key: field.definition.key, value };
          }),
          flow: { status: 'succeeded' as const, callback: summary?.callback ?? null },
        };
      }),
      nextCursor: records.length > limit && page.at(-1)
        ? encodeCursor(page.at(-1)!.created_at, page.at(-1)!.id)
        : null,
    };
  }

  private async submit(
    publication: FormPublicationRecord,
    rawClientRequestId: unknown,
    rawPayload: unknown,
    actorUserId: string | null,
    publicRequest: boolean,
    expectedSubmitTokenHash: string | null,
  ): Promise<FormSubmissionOutcome> {
    const clientRequestId = typeof rawClientRequestId === 'string' ? rawClientRequestId.trim() : '';
    if (!clientRequestId || clientRequestId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(clientRequestId)) {
      throw new FormError('validation', 'Chave de idempotência inválida');
    }
    if (!isJsonRecord(rawPayload) || !Array.isArray(rawPayload.fields)) {
      throw new FormError('validation', 'Payload do formulário inválido');
    }
    const fields = rawPayload.fields.flatMap((field) =>
      isJsonRecord(field) && typeof field.key === 'string' && 'value' in field
        ? [{ key: field.key, value: field.value }]
        : []);
    if (fields.length !== rawPayload.fields.length || fields.length > 500) {
      throw new FormError('validation', 'Campos do formulário inválidos');
    }
    const keys = new Set(fields.map((field) => field.key));
    if (keys.size !== fields.length) throw new FormError('validation', 'Campo duplicado no formulário');
    const hash = payloadHash(fields);
    const existing = await this.forms.submissionByRequest(publication.id, clientRequestId);
    if (existing) {
      if (existing.payload_hash !== hash) throw new FormError('conflict', 'Chave de idempotência já utilizada');
      const summary = existing.flow_data
        ? VALUE_CODECS.flow.decode(existing.flow_data) as Schema.FlowExecutionSummary
        : null;
      return {
        result: {
          submissionId: existing.id,
          submittedAt: existing.created_at,
          callback: summary?.callback ?? null,
        },
        realtime: null,
      };
    }

    const resolved = await this.resolve(publication);
    const fieldsByKey = new Map(resolved.fillFields.map((field) => [field.definition.key, field]));
    const inputLocks = await this.locks.list(publication.page_id);
    if (inputLocks === null) throw new FormError('not_found', 'Base do formulário não encontrada');
    let title: string | null = null;
    const responseValues: Array<{ columnId: NonEmptyString; data: string }> = [];
    const sourceValues: Schema.PageColumnValue[] = [];
    const now = this.now().toISOString();
    const rowId = ulid() as NonEmptyString;
    for (const answer of fields) {
      const field = fieldsByKey.get(answer.key);
      if (!field) throw new FormError('validation', `Campo desconhecido: ${answer.key}`);
      const lock = inputLocks[field.title ? 'title' : field.column!.id];
      if (lock && (!actorUserId || !lock.userIds.includes(actorUserId))) {
        throw new FormError('forbidden', `A coluna ${field.definition.label} está bloqueada`);
      }
      if (field.title) {
        if (typeof answer.value !== 'string') throw new FormError('validation', 'Título inválido');
        title = answer.value;
        continue;
      }
      const column = field.column!;
      let rawValue = answer.value;
      if (column.type === 'select') {
        if (typeof rawValue !== 'string' || !field.optionIdsByKey.has(rawValue)) {
          throw new FormError('validation', `Opção inválida para ${field.definition.label}`);
        }
        rawValue = field.optionIdsByKey.get(rawValue)!;
      }
      let data: string;
      try {
        const codec = VALUE_CODECS[column.type];
        data = codec.encode(codec.validate(rawValue, column));
      } catch (error) {
        throw new FormError('validation', error instanceof Error ? error.message : 'Valor inválido');
      }
      responseValues.push({ columnId: column.id, data });
      sourceValues.push({
        id: ulid() as NonEmptyString,
        page_id: rowId,
        page_column_id: column.id,
        data,
        created_at: now,
        updated_at: now,
      });
    }

    const catalog = await this.flows.macroCatalog(publication.page_id);
    if (!catalog) throw new FormError('not_found', 'Base do formulário não encontrada');
    const source = {
      ...catalog,
      row: {
        id: rowId,
        title,
        data: {},
        owner_id: publication.created_by_user_id,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      } satisfies Schema.Page,
      flowColumn: resolved.flowColumn,
      values: sourceValues,
    };
    const authorizationUserId = (actorUserId ?? publication.created_by_user_id) as NonEmptyString;
    const authorization: FlowExecutionAuthorization = {
      assertFlowWritable: async (candidate) => {
        if (!candidate.flowColumn.parent_id || !await this.locks.canMutate(
          candidate.flowColumn.parent_id,
          candidate.flowColumn.id,
          authorizationUserId,
        )) throw new FlowExecutionError('forbidden', 'Coluna Flow bloqueada');
      },
      assertColumnWritable: async (column) => {
        if (!column.parent_id || !await this.locks.canMutate(column.parent_id, column.id, authorizationUserId)) {
          throw new FlowExecutionError('forbidden', `A coluna ${column.name ?? 'de destino'} está bloqueada`);
        }
      },
    };
    let plan;
    try {
      plan = await this.executor.plan(source, authorization, {
        allowRespondentControlledEmailRecipients: !publicRequest,
      });
    } catch (error) {
      if (error instanceof FlowExecutionError) throw new FormError(error.reason, error.message);
      throw error;
    }
    const submissionId = ulid() as NonEmptyString;
    const committed = await this.forms.commitSubmission({
      publication,
      expectedSubmitTokenHash,
      submissionId,
      rowId,
      title,
      responseValues,
      clientRequestId,
      payloadHash: hash,
      flow: {
        executionId: plan.executionId,
        actorUserId: actorUserId as NonEmptyString | null,
        source,
        flowColumnData: plan.flowColumnData,
        summary: plan.summary,
        values: plan.values,
        emails: plan.emails,
      },
    });
    if (!committed) {
      const raced = await this.forms.submissionByRequest(publication.id, clientRequestId);
      if (raced?.payload_hash === hash) {
        const summary = raced.flow_data
          ? VALUE_CODECS.flow.decode(raced.flow_data) as Schema.FlowExecutionSummary
          : null;
        return {
          result: {
            submissionId: raced.id,
            submittedAt: raced.created_at,
            callback: summary?.callback ?? null,
          },
          realtime: null,
        };
      }
      if (raced) throw new FormError('conflict', 'Chave de idempotência já utilizada');
      throw new FormError('conflict', 'Publicação revogada ou formulário alterado');
    }
    return {
      result: { submissionId, submittedAt: now, callback: plan.summary.callback },
      realtime: {
        pageId: publication.page_id,
        rowId,
        originUserId: actorUserId ?? `public-form:${publication.id}`,
      },
    };
  }

  private async authorize(
    publicationId: string,
    rawCapability: unknown,
    kind: 'fill' | 'review',
  ): Promise<FormPublicationRecord> {
    if (!isUlid(publicationId)) throw new FormError('not_found', 'Formulário não encontrado');
    const prefix = kind === 'fill' ? 'cubs_form_fill_v1_' : 'cubs_form_review_v1_';
    if (!isOpaqueToken(rawCapability, prefix)) throw new FormError('forbidden', 'Chave inválida');
    const publication = await this.forms.publicationById(publicationId);
    const expected = kind === 'fill' ? publication?.submit_token_hash : publication?.review_token_hash;
    const actual = hashOpaqueToken(rawCapability);
    if (!publication || !active(publication) || !expected || !hashesEqual(actual, expected)) {
      throw new FormError('not_found', 'Formulário não encontrado');
    }
    return publication;
  }

  private async resolveView(pageId: string, viewId: string) {
    const context = await this.views.load(pageId);
    const view = context?.snapshot.active(viewId);
    if (!context || !view || view.view !== 'form') throw new FormError('not_found', 'Formulário não encontrado');
    const config = parsePageViewFormConfig(view.form);
    assertFormFlowColumn(config, context.columns);
    return { context, view, config };
  }

  private async resolve(publication: FormPublicationRecord): Promise<ResolvedForm> {
    const { context, view, config } = await this.resolveView(publication.page_id, publication.view_id);
    const titleConfig = isJsonRecord(view.title) ? view.title : null;
    const titleKey = sanitizePublicKeyMetadata(titleConfig?.publicKey);
    if (!titleConfig || typeof titleConfig.column_name !== 'string' || !titleKey) {
      throw new FormError('conflict', 'Chaves públicas do formulário precisam ser reconciliadas');
    }
    const fields: ResolvedField[] = [{
      definition: {
        key: titleKey.key,
        label: titleConfig.column_name,
        type: 'text',
        ...(typeof titleConfig.mask === 'string' && { mask: titleConfig.mask as Schema.TextMask }),
      },
      column: null,
      title: true,
      optionIdsByKey: new Map(),
      optionKeysById: new Map(),
    }];
    for (const column of context.columns) {
      if (column.type === 'flow') continue;
      const key = sanitizePublicKeyMetadata(column.data?.publicKey);
      if (!key) throw new FormError('conflict', 'Chaves públicas do formulário precisam ser reconciliadas');
      const options = column.type === 'select' ? (column.data?.options ?? []).map((option) => {
        const optionKey = sanitizePublicKeyMetadata(option.publicKey);
        if (!optionKey) throw new FormError('conflict', 'Chaves públicas das opções precisam ser reconciliadas');
        return { id: option.id, key: optionKey.key, label: option.value, color: option.color };
      }) : [];
      fields.push({
        definition: {
          key: key.key,
          label: column.name ?? '',
          type: column.type,
          ...(column.type === 'text' && column.data?.mask && { mask: column.data.mask }),
          ...(column.type === 'numeric' && column.data?.format && { format: column.data.format }),
          ...(column.type === 'numeric' && column.data?.currency && { currency: column.data.currency }),
          ...(column.type === 'select' && {
            options: options.map(({ key: optionKey, label, color }) => ({
              key: optionKey,
              label,
              ...(color && { color }),
            })),
          }),
        },
        column,
        title: false,
        optionIdsByKey: new Map(options.map((option) => [option.key, option.id])),
        optionKeysById: new Map(options.map((option) => [option.id, option.key])),
      });
    }
    const order = Array.isArray(view.orderedHeaderCols)
      ? view.orderedHeaderCols.filter((id): id is string => typeof id === 'string')
      : [];
    const indexById = new Map(order.map((id, index) => [id, index]));
    fields.sort((a, b) => {
      const aId = a.title ? TITLE_COLUMN_ID : a.column!.id;
      const bId = b.title ? TITLE_COLUMN_ID : b.column!.id;
      return (indexById.get(aId) ?? Number.MAX_SAFE_INTEGER)
        - (indexById.get(bId) ?? Number.MAX_SAFE_INTEGER);
    });
    const flowColumn = context.columns.find((column) => column.id === config.flowColumnId)!;
    const hiddenFieldIds = new Set(config.hiddenFieldIds ?? []);
    const fillFields = fields.filter((field) => !hiddenFieldIds.has(
      field.title ? TITLE_COLUMN_ID : field.column!.id,
    ));
    return {
      publication,
      page: context.page,
      columns: context.columns,
      flowColumn,
      fields,
      fillFields,
      definition: {
        version: 1,
        publicationId: publication.id,
        title: context.page.title,
        name: typeof view.name === 'string' ? view.name : 'Formulário',
        submitButton: config.submitButton,
        fields: fillFields.map((field) => field.definition),
      },
    };
  }

  private status(publication: FormPublicationRecord): FormPublicationStatus {
    return {
      publicationId: publication.id,
      published: active(publication),
      revokedAt: publication.revoked_at,
      expiresAt: publication.expires_at,
      fillKeyHint: publication.submit_token_hint,
      reviewKeyHint: publication.review_token_hint,
    };
  }
}

export default new FormService();
