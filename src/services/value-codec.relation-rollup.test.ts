import { describe, expect, it } from 'vitest';

import type { Schema } from '@/db/schemas/index';
import { VALUE_CODECS } from '@/services/value-codec';

const id = (value: number) => `01M${String(value).padStart(23, '0')}`;
const relationColumn = { type: 'relation' } as Schema.PageColumn;
const rollupColumn = { type: 'rollup' } as Schema.PageColumn;

describe('VALUE_CODECS — Relação e Resumo', () => {
  it('preserva a ordem de até 250 páginas relacionadas e rejeita duplicatas', () => {
    const values = [id(2), id(1)];
    const validated = VALUE_CODECS.relation.validate(values, relationColumn) as string[];
    expect(validated).toEqual(values);
    expect(VALUE_CODECS.relation.decode(VALUE_CODECS.relation.encode(validated))).toEqual(values);
    expect(() => VALUE_CODECS.relation.validate([id(1), id(1)], relationColumn)).toThrow(/sem duplicatas/);
    expect(() => VALUE_CODECS.relation.validate(Array.from({ length: 251 }, (_, index) => id(index)), relationColumn)).toThrow(/até 250/);
  });

  it('mantém Resumo estritamente calculado e somente leitura', () => {
    expect(() => VALUE_CODECS.rollup.validate(10, rollupColumn)).toThrow(/somente leitura/);
  });
});
