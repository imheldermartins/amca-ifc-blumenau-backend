import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({ sqlRaw: vi.fn() }));

vi.mock('@models/index', () => ({ default: { sqlRaw: doubles.sqlRaw } }));

import { ColumnLockStore } from './column-lock-repository.js';

describe('ColumnLockStore.listEligibleEditors', () => {
  beforeEach(() => doubles.sqlRaw.mockReset());

  it('lista quem pode atualizar sem exigir edit_subpages novamente', async () => {
    doubles.sqlRaw
      .mockResolvedValueOnce([{
        id: '01K00000000000000000000001',
        name: 'Editor',
        email: 'editor@example.com',
      }])
      .mockResolvedValueOnce([{ id: '01K00000000000000000000001' }]);

    const store = new ColumnLockStore();
    const result = await store.listEligibleEditors('01K00000000000000000000002');

    expect(result).toHaveLength(1);
    const permissionProbe = doubles.sqlRaw.mock.calls[1]?.[0] as SqlStatement;
    expect(permissionProbe.text).toContain('SELECT ? AS id WHERE');
    expect(permissionProbe.values).toContain('update');
    expect(permissionProbe.values).not.toContain('edit_subpages');
  });
});
