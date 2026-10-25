/** Portable document codec. The numeric type tables are append-only within v1. */
export const PAGE_DOCUMENT_MAX_LENGTH = 240_000;
const MAX_DEPTH = 64;
const MAX_NODES = 10_000;

const NODE_TYPES = ['paragraph', 'text', 'blockRow', 'blockColumn', 'editableBlock',
  'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'callout', 'imageBlock',
  'inlineMath', 'blockMath', 'mention'] as const;
const MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'underline', 'link', 'textStyle', 'highlight'] as const;

type Attributes = Record<string, unknown>;
export interface DocumentMark { type: string; attrs?: Attributes }
export interface DocumentNode {
  type: string;
  attrs?: Attributes;
  content?: DocumentNode[];
  text?: string;
  marks?: DocumentMark[];
}
type TypeCode = number | string;
type PackedMark = [type: TypeCode, attrs?: Attributes];
type PackedNode = string | [type: TypeCode, body?: string | PackedNode[] | null, attrs?: Attributes | null, marks?: PackedMark[]];
export interface CompactPageDocument {
  v: 1;
  b: PackedNode[];
  a?: Attributes;
  m?: PackedMark[];
}

function invalid(): never { throw new TypeError('Documento inválido'); }
function record(value: unknown): value is Attributes {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function typeName(value: unknown, types: readonly string[]): string {
  if (typeof value === 'number' && Number.isInteger(value) && types[value] !== undefined) return types[value]!;
  // Named extension types remain lossless even before they get a numeric code.
  if (typeof value === 'string' && value.length > 0 && value.length <= 80) return value;
  return invalid();
}
function code(type: string, types: readonly string[]): TypeCode {
  const index = types.indexOf(type);
  return index < 0 ? type : index;
}
function size(value: unknown): void {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { invalid(); }
  if (!serialized || serialized.length > PAGE_DOCUMENT_MAX_LENGTH) invalid();
}

/** Accepts old Tiptap JSON and v1 compact JSON, with bounded expansion. */
export function decodePageDocument(value: unknown): DocumentNode {
  size(value);
  let count = 0;
  const visit = (depth: number) => { if (depth > MAX_DEPTH || ++count > MAX_NODES) invalid(); };
  const marks = (input: unknown, packed: boolean): DocumentMark[] => {
    if (!Array.isArray(input)) return invalid();
    return input.map((raw): DocumentMark => {
      visit(0);
      if (packed) {
        if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2 || (raw[1] !== undefined && !record(raw[1]))) return invalid();
        return { type: typeName(raw[0], MARK_TYPES), ...(raw[1] !== undefined && { attrs: raw[1] }) };
      }
      if (!record(raw) || Object.keys(raw).some((key) => !['type', 'attrs'].includes(key))
        || typeof raw.type !== 'string' || (raw.attrs !== undefined && !record(raw.attrs))) return invalid();
      return { type: typeName(raw.type, MARK_TYPES), ...(raw.attrs !== undefined && { attrs: raw.attrs }) };
    });
  };
  const node = (raw: unknown, depth: number, packed: boolean): DocumentNode => {
    visit(depth);
    if (packed && typeof raw === 'string') return { type: 'text', text: raw };
    if (packed) {
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) return invalid();
      const [type, body, attrs, nodeMarks] = raw;
      if (body !== undefined && body !== null && typeof body !== 'string' && !Array.isArray(body)) return invalid();
      if (attrs !== undefined && attrs !== null && !record(attrs)) return invalid();
      return { type: typeName(type, NODE_TYPES),
        ...(Array.isArray(body) && { content: body.map((child) => node(child, depth + 1, true)) }),
        ...(typeof body === 'string' && { text: body }),
        ...(attrs != null && { attrs }),
        ...(nodeMarks !== undefined && { marks: marks(nodeMarks, true) }),
      };
    }
    if (!record(raw) || Object.keys(raw).some((key) => !['type', 'attrs', 'content', 'text', 'marks'].includes(key))
      || typeof raw.type !== 'string' || (raw.attrs !== undefined && !record(raw.attrs))
      || (raw.content !== undefined && !Array.isArray(raw.content))
      || (raw.text !== undefined && typeof raw.text !== 'string')
      || (raw.content !== undefined && raw.text !== undefined)) return invalid();
    return { type: typeName(raw.type, NODE_TYPES),
      ...(raw.attrs !== undefined && { attrs: raw.attrs }),
      ...(Array.isArray(raw.content) && { content: raw.content.map((child) => node(child, depth + 1, false)) }),
      ...(raw.text !== undefined && { text: raw.text }),
      ...(raw.marks !== undefined && { marks: marks(raw.marks, false) }),
    };
  };
  if (!record(value)) return invalid();
  let document: DocumentNode;
  if (value.type === 'doc') {
    document = node(value, 0, false);
  } else {
    if (value.v !== 1 || !Array.isArray(value.b) || Object.keys(value).some((key) => !['v', 'b', 'a', 'm'].includes(key))
      || (value.a !== undefined && !record(value.a))) return invalid();
    document = { type: 'doc', content: value.b.map((child) => node(child, 1, true)),
      ...(value.a !== undefined && { attrs: value.a }),
      ...(value.m !== undefined && { marks: marks(value.m, true) }),
    };
  }
  if (document.text !== undefined) return invalid();
  size(document);
  return document;
}

/** The root implies doc; leaf text is a string and other nodes use typed tuples. */
export function encodePageDocument(value: unknown): CompactPageDocument {
  const document = decodePageDocument(value);
  const marks = (input: DocumentMark[]): PackedMark[] => input.map((mark) => mark.attrs === undefined
    ? [code(mark.type, MARK_TYPES)] : [code(mark.type, MARK_TYPES), mark.attrs]);
  const pack = (node: DocumentNode): PackedNode => {
    if (node.type === 'text' && node.text !== undefined && node.attrs === undefined && node.marks === undefined) return node.text;
    const tuple: Exclude<PackedNode, string> = [code(node.type, NODE_TYPES)];
    if (node.content !== undefined) tuple[1] = node.content.map(pack);
    else if (node.text !== undefined) tuple[1] = node.text;
    if (node.attrs !== undefined) { tuple[1] ??= null; tuple[2] = node.attrs; }
    if (node.marks !== undefined) { tuple[1] ??= null; tuple[2] ??= null; tuple[3] = marks(node.marks); }
    return tuple;
  };
  const compact: CompactPageDocument = { v: 1, b: (document.content ?? []).map(pack),
    ...(document.attrs !== undefined && { a: document.attrs }),
    ...(document.marks !== undefined && { m: marks(document.marks) }),
  };
  size(compact);
  return compact;
}
