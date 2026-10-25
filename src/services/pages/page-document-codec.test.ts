import { describe, expect, it } from 'vitest';
import { decodePageDocument, encodePageDocument, PAGE_DOCUMENT_MAX_LENGTH } from '@/services/pages/page-document-codec';

const document = {
  type: 'doc', content: [{ type: 'blockRow', attrs: { id: 'row' }, content: [{
    type: 'blockColumn', attrs: { id: 'column', span: 100 }, content: [{
      type: 'editableBlock', attrs: { id: 'block', kind: 'richText', indent: 0, formViewId: null }, content: [{
        type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ação d’água 👩🏽‍💻', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] }],
      }],
    }],
  }] }],
};

describe('compact page document codec', () => {
  it('round-trips layout, text, marks, Unicode and attributes and removes structural keys', () => {
    const packed = encodePageDocument(document);
    expect(packed).toMatchObject({ v: 1 });
    expect(JSON.stringify(packed)).not.toContain('"type"');
    expect(JSON.stringify(packed)).not.toContain('"content"');
    expect(JSON.stringify(packed)).not.toContain('"attrs"');
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(document).length * 0.65);
    expect(decodePageDocument(packed)).toEqual(document);
    expect(decodePageDocument(document)).toEqual(document);
    expect(encodePageDocument(packed)).toEqual(packed);
  });
  it('retains images, lists, forms, equations, empty containers and extension-specific data', () => {
    const content = { type: 'doc', content: [
      { type: 'editableBlock', attrs: { kind: 'formSubmit', formViewId: 'view', indent: 0 }, content: [{ type: 'paragraph' }] },
      { type: 'imageBlock', attrs: { src: 'data:image/webp;base64,AAA=', alt: 'Foto', width: 320 } },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feito' }] }] }] },
      { type: 'orderedList', attrs: { start: 4 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1;\n' }] },
      { type: 'inlineMath', attrs: { latex: 'x^2' } },
      { type: 'blockMath', attrs: { latex: '\\sum_{i=1}^{n} i' } },
      { type: 'codeBlock', attrs: { language: 'haskell' }, content: [{ type: 'text', text: 'main = print 1\n' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'inline()', marks: [{ type: 'code' }] }] },
      { type: 'extensionNode', attrs: { custom: { x: [1, false, null] } }, content: [{ type: 'text', text: 'X', marks: [{ type: 'customMark', attrs: {} }] }] },
    ] };
    expect(decodePageDocument(encodePageDocument(content))).toEqual(content);
  });
  it.each([null, [], {}, { v: 2, b: [] }, { v: 1, b: [[999]] }, { v: 1, b: [[0, 42]] },
    { v: 1, b: [[0, null, []]] }, { v: 1, b: [[0, null, null, [[999]]]] },
    { type: 'paragraph' }, { type: 'doc', content: 'invalid' },
    { type: 'doc', content: [{ type: 'text', text: 'x', content: [] }] },
  ])('rejects malformed or unsupported documents: %j', (value) => {
    expect(() => decodePageDocument(value)).toThrow('Documento inválido');
  });
  it('bounds both incoming size, expanded size and recursive depth', () => {
    expect(() => encodePageDocument({ type: 'doc', content: [{ type: 'text', text: 'x'.repeat(PAGE_DOCUMENT_MAX_LENGTH) }] })).toThrow();
    expect(() => decodePageDocument({ v: 1, b: Array(9_000).fill('x') })).toThrow();
    let nested: unknown = [0];
    for (let depth = 0; depth < 70; depth++) nested = [0, [nested]];
    expect(() => decodePageDocument({ v: 1, b: [nested] })).toThrow();
  });
});
