import type { Schema } from '@/db/schemas/index';
import { VALUE_CODECS } from '@/services/value-codec';

const MACRO = /@(page\.title|workspace\.name|columns\.[0-9A-Za-z_-]+|people\.[0-9A-Za-z_-]+\.(?:name|email))/g;
const EXACT_MACRO = /^@(page\.title|workspace\.name|columns\.[0-9A-Za-z_-]+|people\.[0-9A-Za-z_-]+\.(?:name|email))$/;
const DISPLAY_MENTION = /@\{[^}\r\n]+\}/g;

export interface MacroResolutionContext {
  descriptors: readonly Schema.MacroDescriptor[];
  values: Map<string, unknown>;
}

export interface MacroCatalogInput {
  page: Schema.Page;
  workspace: Schema.Workspace;
  columns: readonly Schema.PageColumn[];
  people: readonly { id: string; name: string | null; email: string }[];
  values?: readonly Schema.PageColumnValue[];
}

function valueType(column: Schema.PageColumn): Schema.MacroDescriptor['valueType'] {
  switch (column.type) {
    case 'numeric': return 'number';
    case 'checkbox': return 'boolean';
    case 'date': return 'date';
    case 'flow': return 'unknown';
    case 'text': return column.data?.mask === 'email' ? 'email' : 'text';
    // `select` é uma referência persistida por ULID, mas a saída pública da
    // macro é o texto da option. Tipos novos também começam como texto até
    // ganharem uma projeção deliberada neste mesmo switch.
    case 'select':
    default:
      return 'text';
  }
}

/**
 * Projeta o valor canônico da célula para o valor público de uma macro.
 *
 * Persistência e macro têm contratos diferentes: `select`, por exemplo,
 * persiste o ULID da option para manter identidade e integridade, enquanto o
 * template precisa do texto que uma pessoa reconhece. Manter a conversão aqui
 * impede que cada consumidor (Flow, e-mail, notificações futuras) reimplemente
 * regras de coluna.
 *
 * O fallback é propositalmente textual. Um tipo de coluna novo não deve vazar
 * objetos ou identificadores internos antes de receber uma branch explícita.
 */
export function parseColumnMacroValue(
  column: Schema.PageColumn,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return undefined;

  switch (column.type) {
    case 'select': {
      if (typeof value !== 'string') return undefined;
      const options = Array.isArray(column.data?.options) ? column.data.options : [];
      return options.find((option) => option.id === value)?.value;
    }
    case 'numeric':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'checkbox':
      return typeof value === 'boolean' ? value : undefined;
    case 'date':
      return typeof value === 'string' ? value : undefined;
    case 'flow':
      return undefined;
    case 'text':
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

function preview(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 160);
  return String(value).slice(0, 160);
}

/** Registro/resolução genéricos: flows são apenas o primeiro consumidor. */
export class MacroService {
  public catalog(input: MacroCatalogInput): MacroResolutionContext {
    const values = new Map<string, unknown>();
    const descriptors: Schema.MacroDescriptor[] = [];

    for (const person of input.people) {
      const nameKey = `@people.${person.id}.name`;
      const emailKey = `@people.${person.id}.email`;
      values.set(nameKey, person.name ?? person.email);
      values.set(emailKey, person.email);
      descriptors.push(
        { key: nameKey, label: `${person.name ?? person.email} · nome`, kind: 'person', valueType: 'text', userId: person.id as NonEmptyString, preview: person.name ?? person.email },
        { key: emailKey, label: `${person.name ?? person.email} · e-mail`, kind: 'person', valueType: 'email', userId: person.id as NonEmptyString, preview: person.email },
      );
    }

    values.set('@page.title', input.page.title ?? '');
    descriptors.push({ key: '@page.title', label: 'Título da página', kind: 'page', valueType: 'text', preview: input.page.title });
    values.set('@workspace.name', input.workspace.name ?? '');
    descriptors.push({ key: '@workspace.name', label: 'Nome do workspace', kind: 'workspace', valueType: 'text', preview: input.workspace.name });

    const rows = new Map((input.values ?? []).flatMap((row) => row.page_column_id ? [[row.page_column_id, row] as const] : []));
    for (const column of input.columns) {
      if (column.type === 'flow') continue;
      const key = `@columns.${column.id}`;
      const row = rows.get(column.id);
      let resolved: unknown;
      if (row) {
        try {
          resolved = parseColumnMacroValue(
            column,
            VALUE_CODECS[column.type].decode(row.data),
          );
        } catch {
          resolved = undefined;
        }
      }
      values.set(key, resolved);
      descriptors.push({
        key,
        label: column.name ?? 'Coluna sem nome',
        kind: 'column',
        valueType: valueType(column),
        columnId: column.id,
        preview: preview(resolved),
      });
    }
    return { descriptors, values };
  }

  public keys(value: unknown): string[] {
    const found = new Set<string>();
    this.visit(value, (text) => {
      for (const match of text.matchAll(MACRO)) found.add(`@${match[1]}`);
      // A UI converte menções conhecidas para a chave canônica antes do save.
      // Uma menção visual que atravesse a fronteira é inválida, não texto livre.
      for (const match of text.matchAll(DISPLAY_MENTION)) found.add(match[0]);
    });
    return [...found];
  }

  public assertKnown(value: unknown, descriptors: readonly Schema.MacroDescriptor[]): void {
    const allowed = new Set(descriptors.map((descriptor) => descriptor.key));
    const unknown = this.keys(value).filter((key) => !allowed.has(key));
    if (unknown.length) throw new Error(`Macro desconhecida: ${unknown[0]}`);
  }

  public resolve<T = unknown>(value: T, context: MacroResolutionContext): T {
    if (typeof value === 'string') return this.resolveText(value, context.values) as T;
    if (Array.isArray(value)) return value.map((entry) => this.resolve(entry, context)) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
        key,
        this.resolve(entry, context),
      ])) as T;
    }
    return value;
  }

  public exactKey(value: string): string | null {
    const match = EXACT_MACRO.exec(value);
    return match ? `@${match[1]}` : null;
  }

  private resolveText(value: string, values: ReadonlyMap<string, unknown>): unknown {
    const exact = this.exactKey(value);
    if (exact) return values.get(exact) ?? '';
    return value.replace(MACRO, (_full, key: string) => String(values.get(`@${key}`) ?? ''));
  }

  private visit(value: unknown, consumer: (text: string) => void): void {
    if (typeof value === 'string') consumer(value);
    else if (Array.isArray(value)) value.forEach((entry) => this.visit(entry, consumer));
    else if (value && typeof value === 'object') {
      Object.values(value).forEach((entry) => this.visit(entry, consumer));
    }
  }
}

export default new MacroService();
