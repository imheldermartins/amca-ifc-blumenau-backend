import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ColumnLockController } from './column-lock-controller.js';

const PARENT_ID = '01KXVZ00000000000000000001';
const ACTOR_ID = '01KXVZ00000000000000000002';
const EDITOR_ID = '01KXVZ00000000000000000003';
const OUTSIDER_ID = '01KXVZ00000000000000000004';
const COLUMN_ID = '01KXVZ00000000000000000005';
const FOREIGN_COLUMN_ID = '01KXVZ00000000000000000006';

const store = {
  list: vi.fn(),
  columnBelongs: vi.fn(),
  columnParentId: vi.fn(),
  rowParentId: vi.fn(),
  canMutate: vi.fn(),
  save: vi.fn(),
  listEligibleEditors: vi.fn(),
};
const access = { can: vi.fn() };
const controller = new ColumnLockController(store as never, access as never);

beforeEach(() => {
  vi.resetAllMocks();
  access.can.mockResolvedValue(true);
  store.columnBelongs.mockResolvedValue(true);
  store.listEligibleEditors.mockResolvedValue([
    { id: ACTOR_ID, name: 'Responsável', email: 'owner@example.test' },
    { id: EDITOR_ID, name: 'Editora', email: 'editor@example.test' },
  ]);
  store.save.mockResolvedValue({
    [COLUMN_ID]: { userIds: [ACTOR_ID, EDITOR_ID] },
  });
});

describe('ColumnLockController.save', () => {
  it('rejeita ids e payload inválidos antes de consultar acesso', async () => {
    await expect(controller.save('invalid', ACTOR_ID, {
      columnKey: COLUMN_ID,
      userIds: [ACTOR_ID],
    })).resolves.toMatchObject({ ok: false, reason: 'validation' });

    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: 'not-a-column',
      userIds: [ACTOR_ID],
    })).resolves.toMatchObject({ ok: false, reason: 'validation' });

    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: COLUMN_ID,
      userIds: 'not-an-array',
    })).resolves.toMatchObject({ ok: false, reason: 'validation' });

    expect(access.can).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('exige que quem ativa o bloqueio permaneça autorizado', async () => {
    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: COLUMN_ID,
      userIds: [EDITOR_ID],
    })).resolves.toMatchObject({
      ok: false,
      reason: 'validation',
      message: 'Quem ativa o bloqueio deve permanecer autorizado',
    });

    expect(access.can).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('nega configuração sem a permissão específica lock_columns', async () => {
    access.can.mockResolvedValue(false);

    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: COLUMN_ID,
      userIds: [ACTOR_ID],
    })).resolves.toMatchObject({ ok: false, reason: 'forbidden' });

    expect(access.can).toHaveBeenCalledWith(
      'page',
      PARENT_ID,
      ACTOR_ID,
      'write',
      'lock_columns',
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('rejeita coluna real que não pertence à database', async () => {
    store.columnBelongs.mockResolvedValue(false);

    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: FOREIGN_COLUMN_ID,
      userIds: [ACTOR_ID],
    })).resolves.toMatchObject({
      ok: false,
      reason: 'validation',
      message: 'Coluna não pertence a esta página',
    });

    expect(store.columnBelongs).toHaveBeenCalledWith(PARENT_ID, FOREIGN_COLUMN_ID);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('aceita title sem validar uma coluna física', async () => {
    store.save.mockResolvedValue({ title: { userIds: [ACTOR_ID] } });

    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: 'title',
      userIds: [ACTOR_ID],
    })).resolves.toMatchObject({
      ok: true,
      data: { locks: { title: { userIds: [ACTOR_ID] } } },
    });

    expect(store.columnBelongs).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledWith(PARENT_ID, 'title', [ACTOR_ID], ACTOR_ID);
  });

  it('rejeita usuários sem permissão de edição e não persiste', async () => {
    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: COLUMN_ID,
      userIds: [ACTOR_ID, OUTSIDER_ID],
    })).resolves.toMatchObject({
      ok: false,
      reason: 'validation',
      message: 'Usuário sem permissão de edição',
    });

    expect(store.save).not.toHaveBeenCalled();
  });

  it('remove duplicatas e persiste somente editores elegíveis', async () => {
    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: COLUMN_ID,
      userIds: [ACTOR_ID, EDITOR_ID, EDITOR_ID],
    })).resolves.toMatchObject({ ok: true });

    expect(store.save).toHaveBeenCalledWith(
      PARENT_ID,
      COLUMN_ID,
      [ACTOR_ID, EDITOR_ID],
      ACTOR_ID,
    );
  });

  it('permite remover o bloqueio com lista vazia', async () => {
    store.save.mockResolvedValue({});

    await expect(controller.save(PARENT_ID, ACTOR_ID, {
      columnKey: COLUMN_ID,
      userIds: [],
    })).resolves.toMatchObject({ ok: true, data: { locks: {} } });

    expect(store.save).toHaveBeenCalledWith(PARENT_ID, COLUMN_ID, [], ACTOR_ID);
  });
});

describe('ColumnLockController.titleStatus', () => {
  it('mantém página sem parent editável', async () => {
    store.rowParentId.mockResolvedValue(null);

    await expect(controller.titleStatus(PARENT_ID, ACTOR_ID)).resolves.toEqual({
      ok: true,
      data: { locked: false, canEdit: true },
    });
  });

  it('distingue usuário autorizado de usuário bloqueado no título', async () => {
    store.rowParentId.mockResolvedValue(PARENT_ID);
    store.list.mockResolvedValue({ title: { userIds: [ACTOR_ID] } });

    await expect(controller.titleStatus(EDITOR_ID, ACTOR_ID)).resolves.toEqual({
      ok: true,
      data: { locked: true, canEdit: true },
    });
    await expect(controller.titleStatus(EDITOR_ID, OUTSIDER_ID)).resolves.toEqual({
      ok: true,
      data: { locked: true, canEdit: false },
    });
  });
});
