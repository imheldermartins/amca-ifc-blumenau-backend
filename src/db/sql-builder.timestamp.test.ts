import { describe, expect, it } from 'vitest';
import { SQLBuilder } from '@cubs/rqlite-client/compat';

interface TimestampedRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

describe('SQLBuilder timestamp ownership', () => {
  it.each(['users', 'workspaces', 'pages']) (
    'keeps the %s update clock as a database expression',
    (table) => {
      const builder = new SQLBuilder<TimestampedRecord>(table);
      const statement = builder.update(
        {
          name: 'Novo nome',
          updated_at: 'CURRENT_TIMESTAMP',
        } as unknown as UpdateValues<TimestampedRecord>,
        { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      );

      expect(statement.text).toContain("updated_at = CURRENT_TIMESTAMP");
      expect(statement.values).toEqual(['Novo nome', '01ARZ3NDEKTSV4RRFFQ69G5FAV']);
      expect(statement.values).not.toContain('CURRENT_TIMESTAMP');
    },
  );

  it('ignores caller-owned timestamp values during insert', () => {
    const builder = new SQLBuilder<TimestampedRecord>('users');
    const statement = builder.create({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      name: 'Pessoa',
      created_at: 'CURRENT_TIMESTAMP',
      updated_at: 'CURRENT_TIMESTAMP',
      deleted_at: null,
    } as unknown as CreateValues<TimestampedRecord>);

    expect(statement.text).not.toContain('created_at');
    expect(statement.text).not.toContain('updated_at');
    expect(statement.text).not.toContain('deleted_at');
    expect(statement.values).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Pessoa']);
  });
});
