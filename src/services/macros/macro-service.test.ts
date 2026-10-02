import { describe, expect, it } from 'vitest';

import type { Schema } from '@/db/schemas/index';

import { MacroService } from './macro-service.js';

const service = new MacroService();
const timestamp = '2026-09-30T12:00:00.000Z';

function page(id: string, title: string): Schema.Page {
  return {
    id: id as NonEmptyString,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    title,
    data: {},
    owner_id: 'owner' as NonEmptyString,
  };
}

function workspace(): Schema.Workspace {
  return {
    id: 'workspace' as NonEmptyString,
    created_at: timestamp,
    updated_at: timestamp,
    name: 'Cub\'s',
    data: {},
    organization_id: null,
    icon: 'lucide:boxes',
    created_by_user_id: 'owner' as NonEmptyString,
  };
}

function column(id: string, name: string, type: Schema.ColumnType): Schema.PageColumn {
  return {
    id: id as NonEmptyString,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    name,
    type,
    data: {},
    parent_id: 'database' as NonEmptyString,
  };
}

function value(columnId: string, resolved: unknown): Schema.PageColumnValue {
  return {
    id: `value-${columnId}` as NonEmptyString,
    created_at: timestamp,
    updated_at: timestamp,
    data: JSON.stringify({ value: resolved }),
    page_column_id: columnId as NonEmptyString,
    page_id: 'row' as NonEmptyString,
  };
}

describe('MacroService', () => {
  it('ordena pessoas, página, workspace e colunas, omitindo colunas flow', () => {
    const context = service.catalog({
      page: page('row', 'Planejamento'),
      workspace: workspace(),
      people: [{ id: 'user-1' as NonEmptyString, name: 'Ada', email: 'ada@example.com' }],
      columns: [
        column('score', 'Pontuação', 'numeric'),
        column('approved', 'Aprovado', 'checkbox'),
        column('automation', 'Automação', 'flow'),
      ],
      values: [value('score', 42), value('approved', true)],
    });

    expect(context.descriptors.map(({ key }) => key)).toEqual([
      '@people.user-1.name',
      '@people.user-1.email',
      '@page.title',
      '@workspace.name',
      '@columns.score',
      '@columns.approved',
    ]);
    expect(context.descriptors.at(-2)).toMatchObject({
      kind: 'column', valueType: 'number', preview: '42', columnId: 'score',
    });
    expect(context.values.get('@people.user-1.email')).toBe('ada@example.com');
    expect(context.values.get('@columns.approved')).toBe(true);
    expect(context.values.has('@columns.automation')).toBe(false);
  });

  it('encontra macros recursivamente, remove duplicatas e rejeita uma desconhecida', () => {
    const payload = {
      subject: '@page.title em @workspace.name',
      nested: ['@columns.score', { again: '@columns.score' }],
    };

    expect(service.keys(payload)).toEqual([
      '@page.title',
      '@workspace.name',
      '@columns.score',
    ]);
    expect(() => service.assertKnown(payload, [
      { key: '@page.title', label: 'Página', kind: 'page', valueType: 'text' },
      { key: '@workspace.name', label: 'Workspace', kind: 'workspace', valueType: 'text' },
    ])).toThrow('Macro desconhecida: @columns.score');
    expect(() => service.assertKnown('@{Coluna_Que_Nao_Existe}', []))
      .toThrow('Macro desconhecida: @{Coluna_Que_Nao_Existe}');
  });

  it('preserva o tipo de macro exata e interpola macros dentro de textos aninhados', () => {
    const context = {
      descriptors: [],
      values: new Map<string, unknown>([
        ['@columns.score', 42],
        ['@columns.approved', true],
        ['@page.title', 'Planejamento'],
      ]),
    };

    expect(service.resolve('@columns.score', context)).toBe(42);
    expect(service.resolve({
      title: '@page.title: @columns.score',
      items: ['@columns.approved', 'OK=@columns.approved'],
    }, context)).toEqual({
      title: 'Planejamento: 42',
      items: [true, 'OK=true'],
    });
    expect(service.exactKey('@people.user-1.email')).toBe('@people.user-1.email');
    expect(service.exactKey('@people.user-1.email extra')).toBeNull();
  });

  it('tolera valor persistido inválido sem inventar preview', () => {
    const broken = value('score', 42);
    broken.data = 'not-json';
    const context = service.catalog({
      page: page('row', 'Planejamento'),
      workspace: workspace(),
      people: [],
      columns: [column('score', 'Pontuação', 'numeric')],
      values: [broken],
    });

    expect(context.values.get('@columns.score')).toBeUndefined();
    expect(context.descriptors.at(-1)?.preview).toBeNull();
  });

  it('marca somente text/mask=email como macro de e-mail', () => {
    const contact = column('contact', 'E-mail de contato', 'text');
    contact.data = { mask: 'email' };
    const notes = column('notes', 'Observação', 'text');
    const context = service.catalog({
      page: page('row', 'Planejamento'),
      workspace: workspace(),
      people: [],
      columns: [contact, notes],
      values: [value('contact', 'contato@example.com')],
    });

    expect(context.descriptors.find(({ key }) => key === '@columns.contact'))
      .toMatchObject({ valueType: 'email', preview: 'contato@example.com' });
    expect(context.descriptors.find(({ key }) => key === '@columns.notes'))
      .toMatchObject({ valueType: 'text' });
  });

  it('projeta select como texto da option sem expor o ULID persistido', () => {
    const room = column('room', 'Sala', 'select');
    room.data = {
      options: [
        {
          id: '01M40000000000000000000001' as NonEmptyString,
          value: 'Laboratório 01',
        },
      ],
    };
    const context = service.catalog({
      page: page('row', 'Planejamento'),
      workspace: workspace(),
      people: [],
      columns: [room],
      values: [value('room', '01M40000000000000000000001')],
    });

    expect(context.values.get('@columns.room')).toBe('Laboratório 01');
    expect(context.descriptors.at(-1)).toMatchObject({
      valueType: 'text',
      preview: 'Laboratório 01',
    });
    expect(service.resolve('Sala: @columns.room', context)).toBe('Sala: Laboratório 01');
  });

  it('não usa o ULID como fallback quando a option do select não existe', () => {
    const room = column('room', 'Sala', 'select');
    room.data = { options: [] };
    const context = service.catalog({
      page: page('row', 'Planejamento'),
      workspace: workspace(),
      people: [],
      columns: [room],
      values: [value('room', '01M40000000000000000000099')],
    });

    expect(context.values.get('@columns.room')).toBeUndefined();
    expect(context.descriptors.at(-1)?.preview).toBeNull();
  });
});
