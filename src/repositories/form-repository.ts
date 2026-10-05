import { ulid } from 'ulid';
import {titleValueProjection} from '@/repositories/page-value-projection';
import {appendCreatedRowOrderStatements, checkedOrderWrite, withPageRowOrderLock} from '@/repositories/page-view-row-order';

import { rqlite } from '@/db/client-db';
import db from '@models/index';
import flowStore, { FlowStore } from '@/repositories/flow-repository';
import { pageActivityTouchStatement } from '@/repositories/page-activity';
import { pageCellUpsertStatement } from '@/repositories/page-cell-statements';
import { pageChildEdgeStatement } from '@/repositories/page-child-creation';
import { SystemRoleFactory } from '@/repositories/system-role-factory';
import type {
  CommitFormSubmissionInput,
  FormPublicationRecord,
  FormReviewCursor,
  FormSubmissionRecord,
} from '@/repositories/types/form-repository.types';

export class FormStore {
  public constructor(private readonly flows: FlowStore = flowStore) {}

  public async publicationByPageView(pageId: string, viewId: string): Promise<FormPublicationRecord | null> {
    const rows = await db.sqlRaw<FormPublicationRecord>({
      text: `SELECT * FROM page_form_publications WHERE page_id = ? AND view_id = ? LIMIT 1`,
      values: [pageId, viewId],
    }, 'query');
    return rows[0] ?? null;
  }

  public async publicationById(publicationId: string): Promise<FormPublicationRecord | null> {
    const rows = await db.sqlRaw<FormPublicationRecord>({
      text: `SELECT * FROM page_form_publications WHERE id = ? LIMIT 1`,
      values: [publicationId],
    }, 'query');
    return rows[0] ?? null;
  }

  public async publish(input: {
    pageId: string;
    viewId: string;
    userId: string;
    submitTokenHash: string;
    submitTokenHint: string;
    reviewTokenHash: string;
    reviewTokenHint: string;
    expiresAt: string | null;
  }): Promise<FormPublicationRecord | null> {
    const id = ulid();
    const rows = await db.sqlRaw<FormPublicationRecord>({
      text: `INSERT INTO page_form_publications (
          id, page_id, view_id, created_by_user_id,
          submit_token_hash, submit_token_hint, review_token_hash, review_token_hint, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(page_id, view_id) DO UPDATE SET
          created_by_user_id = excluded.created_by_user_id,
          submit_token_hash = excluded.submit_token_hash,
          submit_token_hint = excluded.submit_token_hint,
          review_token_hash = excluded.review_token_hash,
          review_token_hint = excluded.review_token_hint,
          expires_at = excluded.expires_at,
          revoked_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
      values: [
        id, input.pageId, input.viewId, input.userId,
        input.submitTokenHash, input.submitTokenHint,
        input.reviewTokenHash, input.reviewTokenHint, input.expiresAt,
      ],
    }, 'request');
    return rows[0] ?? null;
  }

  /**
   * Garante o ledger usado pelo preview autenticado sem tornar o formulário
   * acessível por capability. Um publish posterior reaproveita a mesma linha.
   */
  public async createDraft(input: {
    pageId: string;
    viewId: string;
    userId: string;
    submitTokenHash: string;
    submitTokenHint: string;
    reviewTokenHash: string;
    reviewTokenHint: string;
  }): Promise<FormPublicationRecord | null> {
    const id = ulid();
    const rows = await db.sqlRaw<FormPublicationRecord>({
      text: `INSERT INTO page_form_publications (
          id, page_id, view_id, created_by_user_id,
          submit_token_hash, submit_token_hint, review_token_hash, review_token_hint, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(page_id, view_id) DO NOTHING
        RETURNING *`,
      values: [
        id, input.pageId, input.viewId, input.userId,
        input.submitTokenHash, input.submitTokenHint,
        input.reviewTokenHash, input.reviewTokenHint,
      ],
    }, 'request');
    return rows[0] ?? this.publicationByPageView(input.pageId, input.viewId);
  }

  public async revoke(pageId: string, viewId: string): Promise<boolean> {
    const rows = await db.sqlRaw<{ id: string }>({
      text: `UPDATE page_form_publications
        SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE page_id = ? AND view_id = ? AND revoked_at IS NULL RETURNING id`,
      values: [pageId, viewId],
    }, 'request');
    return rows.length === 1;
  }

  public async submissionByRequest(
    publicationId: string,
    clientRequestId: string,
  ): Promise<FormSubmissionRecord | null> {
    const rows = await db.sqlRaw<FormSubmissionRecord>({
      text: `SELECT submission.*, page.title AS page_title, flow_value.data AS flow_data
        FROM page_form_submissions submission
        JOIN pages page ON page.id = submission.response_page_id
        LEFT JOIN page_form_publications publication ON publication.id = submission.publication_id
        LEFT JOIN page_columns_values flow_value
         ON flow_value.page_id = submission.response_page_id
         AND flow_value.page_column_id = json_extract(
           (SELECT data FROM pages WHERE id = publication.page_id),
           '$."' || publication.view_id || '".form.flowColumnId'
         )
        WHERE submission.publication_id = ? AND submission.client_request_id = ? LIMIT 1`,
      values: [publicationId, clientRequestId],
    }, 'query');
    return rows[0] ?? null;
  }

  public async commitSubmission(input: CommitFormSubmissionInput): Promise<boolean> {
    return withPageRowOrderLock(input.publication.page_id, async () => {
    const positions = await appendCreatedRowOrderStatements(input.publication.page_id, input.rowId);
    const publicationGuard = input.expectedSubmitTokenHash
      ? `AND revoked_at IS NULL
         AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
         AND submit_token_hash = ?`
      : '';
    const publicationGuardValues = input.expectedSubmitTokenHash
      ? [input.expectedSubmitTokenHash]
      : [];
    const statements: RqliteStatement[] = [[
      `INSERT INTO pages (id, title, data, owner_id, title_search, projection_version)
       SELECT ?, ?, '{}', created_by_user_id, ?, 1 FROM page_form_publications
       WHERE id = ? AND page_id = ? ${publicationGuard}`,
      input.rowId, input.title, titleValueProjection(input.title).title_search, input.publication.id, input.publication.page_id,
      ...publicationGuardValues,
    ]];
    statements.push(SystemRoleFactory.defaultStatement('page', input.rowId));
    statements.push(pageChildEdgeStatement(input.publication.page_id, input.rowId));
    statements.push(...positions);
    for (const value of input.responseValues) {
      statements.push(pageCellUpsertStatement(input.rowId, value.columnId, value.data));
    }
    // Efeitos do Flow vêm depois das respostas: set_value prevalece quando ambos
    // atingem a mesma coluna.
    statements.push(...this.flows.buildExecutionStatements(input.flow));
    statements.push(pageActivityTouchStatement(input.publication.page_id));
    statements.push([
      `INSERT INTO page_form_submissions (
        id, publication_id, response_page_id, client_request_id, payload_hash, flow_execution_id
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      input.submissionId,
      input.publication.id,
      input.rowId,
      input.clientRequestId,
      input.payloadHash,
      input.flow.executionId,
    ]);
    try {
      const guarded = statements.flatMap(checkedOrderWrite);
      const results = await rqlite(guarded, 'execute', { transaction: true });
      return results.length === guarded.length && statements.every((_, index) => results[index * 2] === true);
    } catch {
      return false;
    }
    });
  }

  public async reviewPage(
    publicationId: string,
    limit: number,
    cursor: FormReviewCursor | null,
  ): Promise<FormSubmissionRecord[]> {
    const cursorSql = cursor
      ? `AND (submission.created_at < ? OR (submission.created_at = ? AND submission.id < ?))`
      : '';
    const cursorValues = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
    return db.sqlRaw<FormSubmissionRecord>({
      text: `SELECT submission.*, page.title AS page_title, flow_value.data AS flow_data
        FROM page_form_submissions submission
        JOIN pages page ON page.id = submission.response_page_id AND page.deleted_at IS NULL
        JOIN page_form_publications publication ON publication.id = submission.publication_id
        LEFT JOIN page_columns_values flow_value
         ON flow_value.page_id = submission.response_page_id
         AND flow_value.page_column_id = json_extract(
           (SELECT data FROM pages WHERE id = publication.page_id),
           '$."' || publication.view_id || '".form.flowColumnId'
         )
        WHERE submission.publication_id = ? ${cursorSql}
        ORDER BY submission.created_at DESC, submission.id DESC LIMIT ?`,
      values: [publicationId, ...cursorValues, limit],
    }, 'query');
  }

  public async responseValues(pageIds: string[]): Promise<Array<{
    page_id: string;
    page_column_id: string;
    data: string;
  }>> {
    if (pageIds.length === 0) return [];
    const placeholders = pageIds.map(() => '?').join(',');
    return db.sqlRaw({
      text: `SELECT page_id, page_column_id, data FROM page_columns_values
        WHERE page_id IN (${placeholders})`,
      values: pageIds,
    }, 'query');
  }
}

export default new FormStore();
