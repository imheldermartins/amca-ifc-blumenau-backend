import { describe, expect, it, vi } from 'vitest';

import type { Schema } from '@/db/schemas/index';
import type { FormStore } from '@/repositories/form-repository';
import type { FlowStore } from '@/repositories/flow-repository';
import type { FormPublicationRecord } from '@/repositories/types/form-repository.types';
import type { FlowExecutionService } from '@/services/flows/flow-execution-service';
import { FormService } from '@/services/forms/form-service';
import { createOpaqueToken, hashOpaqueToken } from '@/services/opaque-token';
import { PageViewSnapshot } from '@/services/pages/views/page-view-snapshot';

const PAGE = '01KXVZ00000000000000000001';
const VIEW = '01KXVZ00000000000000000002';
const USER = '01KXVZ00000000000000000003';
const FLOW = '01KXVZ00000000000000000004';
const EMAIL = '01KXVZ00000000000000000005';
const PUBLICATION = '01KXVZ00000000000000000006';

function fixtures() {
  const fillKey = createOpaqueToken('cubs_form_fill_v1_');
  const reviewKey = createOpaqueToken('cubs_form_review_v1_');
  const now = '2026-10-02T20:00:00.000Z';
  const page: Schema.Page = {
    id: PAGE, title: 'Inscrições', owner_id: USER, data: {
      [VIEW]: {
        view: 'form', name: 'Cadastro', orderedHeaderCols: [EMAIL],
        title: { key: 'title', column_name: 'Nome', publicKey: { key: 'nome', aliases: [] } },
        form: { version: 1, flowColumnId: FLOW, submitButton: { label: 'Enviar', icon: 'lucide:send' } },
      },
    }, deleted_at: null, created_at: now, updated_at: now,
  };
  const columns: Schema.PageColumn[] = [
    {
      id: EMAIL, parent_id: PAGE, name: 'E-mail', type: 'text',
      data: { mask: 'email', publicKey: { key: 'email', aliases: [] } },
      deleted_at: null, created_at: now, updated_at: now,
    },
    {
      id: FLOW, parent_id: PAGE, name: 'Flow', type: 'flow',
      data: { flow: { version: 1, trigger: { type: 'manual' }, nodes: [] } },
      deleted_at: null, created_at: now, updated_at: now,
    },
  ];
  const publication: FormPublicationRecord = {
    id: PUBLICATION, page_id: PAGE, view_id: VIEW, created_by_user_id: USER,
    submit_token_hash: hashOpaqueToken(fillKey), submit_token_hint: 'fill',
    review_token_hash: hashOpaqueToken(reviewKey), review_token_hint: 'review',
    expires_at: null, revoked_at: null, created_at: now, updated_at: now,
  };
  return { fillKey, reviewKey, page, columns, publication, now };
}

function service(overrides: Partial<Record<string, unknown>> = {}) {
  const data = fixtures();
  const forms = {
    publicationById: vi.fn(async () => data.publication),
    publicationByPageView: vi.fn(async () => null),
    createDraft: vi.fn(async () => data.publication),
    publish: vi.fn(async (input) => ({
      ...data.publication,
      submit_token_hash: input.submitTokenHash,
      review_token_hash: input.reviewTokenHash,
      submit_token_hint: input.submitTokenHint,
      review_token_hint: input.reviewTokenHint,
    })),
    revoke: vi.fn(async () => true),
    submissionByRequest: vi.fn(async () => null),
    commitSubmission: vi.fn(async () => true),
    reviewPage: vi.fn(async () => []),
    responseValues: vi.fn(async () => []),
    ...overrides,
  };
  const views = {
    load: vi.fn(async () => ({
      page: data.page,
      columns: data.columns,
      snapshot: PageViewSnapshot.fromPage(data.page),
    })),
  };
  const flows = {
    macroCatalog: vi.fn(async () => ({
      parent: data.page,
      workspace: { id: PAGE, name: 'W', data: {}, organization_id: null, icon: '', created_by_user_id: USER, created_at: data.now, updated_at: data.now },
      columns: data.columns,
      people: [],
    })),
  };
  const executor = {
    plan: vi.fn(async (_source: unknown, _authorization?: unknown, _policy?: unknown) => ({
      executionId: '01KXVZ00000000000000000007',
      flowColumnData: JSON.stringify({ value: {} }),
      summary: {
        executionId: '01KXVZ00000000000000000007', status: 'succeeded',
        startedAt: data.now, finishedAt: data.now, executedNodeIds: [], callback: 'ok',
        effects: { emailsQueued: 0, valuesUpdated: 0 },
      },
      updatedValues: [], values: [], emails: [],
    })),
  };
  const locks = { canMutate: vi.fn(async () => true), list: vi.fn(async () => ({} as Record<string, { userIds: string[] }>)) };
  return {
    data,
    forms,
    executor,
    locks,
    instance: new FormService(
      forms as unknown as FormStore,
      views as never,
      flows as unknown as FlowStore,
      executor as unknown as FlowExecutionService,
      locks as never,
      () => new Date(data.now),
    ),
  };
}

describe('FormService', () => {
  it('rejects false checkbox answers to a locked column', async () => {
    const { instance, data, locks, forms } = service();
    const checkbox = '01KXVZ00000000000000000008';
    data.columns.push({ id: checkbox, parent_id: PAGE, name: 'Ativo', type: 'checkbox', data: { publicKey: { key: 'ativo', aliases: [] } }, deleted_at: null, created_at: data.now, updated_at: data.now });
    locks.list.mockResolvedValue({ [checkbox]: { userIds: [USER] } });
    await expect(instance.submitPublic(PUBLICATION, data.fillKey, 'checkbox', { fields: [{ key: 'ativo', value: false }] })).rejects.toMatchObject({ reason: 'forbidden' });
    expect(forms.commitSubmission).not.toHaveBeenCalled();
  });
  it('public fields reflect locks without exposing the allowlist', async () => {
    const { instance, data, locks } = service();
    locks.list.mockResolvedValue({ title: { userIds: [USER] }, [EMAIL]: { userIds: [USER] } });
    const definition = await instance.publicDefinition(PUBLICATION, data.fillKey);
    expect(definition.fields.every((field) => field.readOnly)).toBe(true);
    expect(JSON.stringify(definition)).not.toContain(USER);
  });
  it('rejects public answers to locked fields even when the publisher is allowed', async () => {
    const { instance, data, locks, forms } = service();
    locks.list.mockResolvedValue({ title: { userIds: [USER] } });
    await expect(instance.submitPublic(PUBLICATION, data.fillKey, 'locked-title', { fields: [{ key: 'nome', value: 'Ataque' }] }))
      .rejects.toMatchObject({ reason: 'forbidden' });
    expect(forms.commitSubmission).not.toHaveBeenCalled();
  });
  it('permits authenticated respondents on the allowlist and rejects other users', async () => {
    const { instance, locks, forms } = service();
    locks.list.mockResolvedValue({ [EMAIL]: { userIds: [USER] } });
    await instance.submitAuthenticated(PAGE, VIEW, USER, 'allowed', { fields: [{ key: 'email', value: 'allowed@example.com' }] });
    expect(forms.commitSubmission).toHaveBeenCalledOnce();
    await expect(instance.submitAuthenticated(PAGE, VIEW, FLOW, 'denied', { fields: [{ key: 'email', value: 'blocked@example.com' }] }))
      .rejects.toMatchObject({ reason: 'forbidden' });
  });
  it('publica capabilities distintas e persiste somente hashes', async () => {
    const { instance, forms } = service();
    const result = await instance.publish(PAGE, VIEW, USER, null);
    const input = forms.publish.mock.calls[0]![0];

    expect(result.fillKey).toMatch(/^cubs_form_fill_v1_/);
    expect(result.reviewKey).toMatch(/^cubs_form_review_v1_/);
    expect(result.fillKey).not.toBe(result.reviewKey);
    expect(input.submitTokenHash).toHaveLength(64);
    expect(input.reviewTokenHash).toHaveLength(64);
    expect(input.submitTokenHash).not.toContain(result.fillKey);
  });

  it('não aceita capability de review para ler a definição de preenchimento', async () => {
    const { instance, data } = service();
    await expect(instance.publicDefinition(PUBLICATION, data.reviewKey)).rejects.toMatchObject({
      reason: 'forbidden',
    });
    await expect(instance.publicDefinition(PUBLICATION, data.fillKey)).resolves.toMatchObject({
      publicationId: PUBLICATION,
      fields: [{ key: 'email' }, { key: 'nome' }],
    });
  });

  it('submete payload público pelo planner comum com política segura', async () => {
    const { instance, data, forms, executor } = service();
    const result = await instance.submitPublic(
      PUBLICATION,
      data.fillKey,
      'request-1',
      { fields: [{ key: 'email', value: 'ana@example.com' }] },
    );

    expect(result.result.callback).toBe('ok');
    expect(result.realtime).toEqual(expect.objectContaining({
      pageId: PAGE,
      originUserId: `public-form:${PUBLICATION}`,
    }));
    expect(executor.plan).toHaveBeenCalledWith(
      expect.objectContaining({ flowColumn: expect.objectContaining({ id: FLOW }) }),
      expect.any(Object),
      { allowRespondentControlledEmailRecipients: false },
    );
    const plannedSource = executor.plan.mock.calls[0]![0] as { values: unknown[] };
    expect(plannedSource.values).toEqual([
      expect.objectContaining({
        page_column_id: EMAIL,
        data: JSON.stringify({ value: 'ana@example.com' }),
      }),
    ]);
    expect(forms.commitSubmission).toHaveBeenCalledWith(expect.objectContaining({
      expectedSubmitTokenHash: data.publication.submit_token_hash,
      responseValues: [expect.objectContaining({ columnId: EMAIL })],
    }));
  });

  it('omite campos configurados como ocultos e não aceita preenchê-los pela rota pública', async () => {
    const { instance, data } = service();
    const view = data.page.data[VIEW] as { form: { hiddenFieldIds?: string[] } };
    view.form.hiddenFieldIds = [EMAIL];

    await expect(instance.publicDefinition(PUBLICATION, data.fillKey)).resolves.toMatchObject({
      fields: [{ key: 'nome' }],
    });
    await expect(instance.submitPublic(
      PUBLICATION,
      data.fillKey,
      'hidden-field-1',
      { fields: [{ key: 'email', value: 'ana@example.com' }] },
    )).rejects.toMatchObject({ reason: 'validation' });
  });

  it('usa uma publicação draft revogada no preview sem expor o formulário', async () => {
    const { instance, forms } = service();

    await instance.submitAuthenticated(
      PAGE,
      VIEW,
      USER,
      'preview-1',
      { fields: [{ key: 'email', value: 'ana@example.com' }] },
    );

    expect(forms.createDraft).toHaveBeenCalledOnce();
    expect(forms.publish).not.toHaveBeenCalled();
    expect(forms.commitSubmission).toHaveBeenCalledWith(expect.objectContaining({
      expectedSubmitTokenHash: null,
    }));
  });
});
