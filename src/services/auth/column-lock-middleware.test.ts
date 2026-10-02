import { beforeEach, describe, expect, it, vi } from 'vitest';

const locks = vi.hoisted(() => ({
  canMutate: vi.fn(),
  columnParentId: vi.fn(),
  rowParentId: vi.fn(),
}));

vi.mock('@/repositories/column-lock-repository', () => ({ default: locks }));

import {
  requireUnlockedColumn,
  requireUnlockedPageTitle,
} from './column-lock-middleware.js';

const PARENT_ID = '01KXVZ00000000000000000001';
const ACTOR_ID = '01KXVZ00000000000000000002';
const PAGE_ID = '01KXVZ00000000000000000003';
const COLUMN_ID = '01KXVZ00000000000000000004';

function responseDouble() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

beforeEach(() => {
  vi.resetAllMocks();
  locks.columnParentId.mockResolvedValue(PARENT_ID);
  locks.rowParentId.mockResolvedValue(PARENT_ID);
  locks.canMutate.mockResolvedValue(true);
});

describe('requireUnlockedColumn', () => {
  it('resolve o parent da coluna e permite editor autorizado', async () => {
    const next = vi.fn();
    const response = responseDouble();

    await requireUnlockedColumn()(
      { params: { column_id: COLUMN_ID }, userId: ACTOR_ID } as never,
      response as never,
      next,
    );

    expect(locks.columnParentId).toHaveBeenCalledWith(COLUMN_ID);
    expect(locks.canMutate).toHaveBeenCalledWith(PARENT_ID, COLUMN_ID, ACTOR_ID);
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('usa o parent da rota quando informado', async () => {
    const next = vi.fn();

    await requireUnlockedColumn('id')(
      { params: { id: PARENT_ID, column_id: COLUMN_ID }, userId: ACTOR_ID } as never,
      responseDouble() as never,
      next,
    );

    expect(locks.columnParentId).not.toHaveBeenCalled();
    expect(locks.canMutate).toHaveBeenCalledWith(PARENT_ID, COLUMN_ID, ACTOR_ID);
    expect(next).toHaveBeenCalledOnce();
  });

  it('bloqueia mutação sem allowlist, mesmo para quem chegou ao middleware', async () => {
    locks.canMutate.mockResolvedValue(false);
    const next = vi.fn();
    const response = responseDouble();

    await requireUnlockedColumn()(
      { params: { column_id: COLUMN_ID }, userId: ACTOR_ID } as never,
      response as never,
      next,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ message: 'Coluna bloqueada para edição' });
    expect(next).not.toHaveBeenCalled();
  });

  it('não libera quando a coluna não possui parent válido', async () => {
    locks.columnParentId.mockResolvedValue(null);
    const next = vi.fn();
    const response = responseDouble();

    await requireUnlockedColumn()(
      { params: { column_id: COLUMN_ID }, userId: ACTOR_ID } as never,
      response as never,
      next,
    );

    expect(locks.canMutate).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireUnlockedPageTitle', () => {
  it('ignora updates que não alteram o título', async () => {
    const next = vi.fn();

    await requireUnlockedPageTitle(
      { params: { id: PAGE_ID }, userId: ACTOR_ID, body: { icon: 'book' } } as never,
      responseDouble() as never,
      next,
    );

    expect(locks.rowParentId).not.toHaveBeenCalled();
    expect(locks.canMutate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('permite título de página sem parent', async () => {
    locks.rowParentId.mockResolvedValue(null);
    const next = vi.fn();

    await requireUnlockedPageTitle(
      { params: { id: PAGE_ID }, userId: ACTOR_ID, body: { title: 'Nova' } } as never,
      responseDouble() as never,
      next,
    );

    expect(locks.canMutate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('bloqueia edição do título sintético fora da allowlist', async () => {
    locks.canMutate.mockResolvedValue(false);
    const next = vi.fn();
    const response = responseDouble();

    await requireUnlockedPageTitle(
      { params: { id: PAGE_ID }, userId: ACTOR_ID, body: { title: 'Nova' } } as never,
      response as never,
      next,
    );

    expect(locks.canMutate).toHaveBeenCalledWith(PARENT_ID, 'title', ACTOR_ID);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ message: 'Coluna bloqueada para edição' });
    expect(next).not.toHaveBeenCalled();
  });
});
