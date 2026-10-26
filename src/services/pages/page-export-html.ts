import katex from 'katex';
import hljs from 'highlight.js';
import type { DocumentNode } from './page-document-codec.js';
import { escapeExportHtml as esc, readRecursiveConfig, recursiveCalendarHtml, recursiveTableHtml, RECURSIVE_CSS, type RecursiveRow } from './recursive-template.js';

export const PAGE_EXPORT_CSS = `@page{size:A4;margin:16mm}*{box-sizing:border-box}html{color-scheme:light}body{margin:0;color:#25232b;background:white;font:14px/1.65 "Noto Sans",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1.page-title{font-size:32px;line-height:1.2;margin:0 0 28px;overflow-wrap:anywhere}p{margin:.2rem 0;min-height:1.65em}h1,h2,h3{font-weight:700;letter-spacing:-.025em;line-height:1.2;margin:.65rem 0 .3rem;break-after:avoid}h1{font-size:30px}h2{font-size:24px}h3{font-size:18px}.block-row{display:flex;gap:20px;align-items:flex-start;margin:8px 0}.block-column{min-width:0;flex-shrink:1}.editor-block{min-width:0;overflow-wrap:anywhere}.mention{border-radius:999px;background:#f3edfc;padding:2px 10px;color:#8150bd}ul,ol{margin:.2rem 0;padding-left:1.45rem}li{margin:.12rem 0}li>p{margin:0}.task-list{list-style:none;padding:0}.task-item{display:flex;align-items:flex-start;gap:8px}.task-check{position:relative;display:inline-block;width:17px;height:17px;flex:none;margin-top:3px;border:2px solid #c7c7c7;border-radius:50%}.task-item[data-checked="true"]>.task-check{border-color:#8150bd;background:#8150bd}.task-item[data-checked="true"]>.task-check::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid white;border-width:0 2px 2px 0;transform:rotate(45deg)}.task-item>div{min-width:0}a{color:#8150bd;text-decoration:underline}code{border-radius:4px;background:#f4f2f7;padding:2px 4px;font:12px/1.6 monospace}pre{margin:.35rem 0;padding:14px;border:1px solid #ddd;border-radius:10px;background:#f8f7fa;white-space:pre-wrap;overflow-wrap:anywhere}pre code{padding:0;background:none;white-space:pre-wrap}blockquote{border-left:3px solid #ddd;padding-left:14px;margin:10px 0;color:#666}.callout,.math-block{border-radius:10px;padding:12px;background:#f7f3fc}.math-block{text-align:center}.image-block img{max-width:100%;height:auto;border-radius:10px}.image-block{margin:.35rem 0}.image-block figcaption{font-size:12px;color:#666}hr{border:0;border-top:1px solid #ddd;margin:20px 0}img{break-inside:avoid}${RECURSIVE_CSS}`;

const PRINT_COLORS: Record<string, string> = { purple: '#8150bd', blue: '#3480cc', green: '#279464', red: '#d14262', pink: '#c34b95', orange: '#c57728', yellow: '#a07112', grey: '#606060' };
/** Resolve the editor's semantic tokens without importing its live light/dark stylesheet. */
function color(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const resolved = value.replace(/var\(--p-(purple|blue|green|red|pink|orange|yellow|grey)\)/g, (_token, name: string) => PRINT_COLORS[name]!);
  if (/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%/\s+-]+\)|hsla?\([\d.,%/\s+-]+\)|[a-z]{1,20})$/i.test(resolved)) return resolved;
  const mix = /^color-mix\(in oklab,\s*#[0-9a-f]{6}\s+(\d+(?:\.\d+)?)%,\s*transparent\)$/i.exec(resolved);
  return mix && Number(mix[1]) <= 100 ? resolved : null;
}
function safeLink(value: unknown): string | null {
  return typeof value === 'string' && /^(https?:|mailto:)/i.test(value) ? value : null;
}
export function pageExportBody(document: DocumentNode, input: { title: string; rows?: RecursiveRow[]; relationRows?: Record<string, RecursiveRow[]>; resolve: (text: string) => string; includePageTitle?: boolean }): string {
  const text = (value: unknown) => esc(input.resolve(String(value ?? '')));
  const marked = (node: DocumentNode, initial: string): string => {
    let html = initial;
    for (const mark of node.marks ?? []) {
      const tag = ({ bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code' } as Record<string, string>)[mark.type];
      if (tag) html = `<${tag}>${html}</${tag}>`;
      if (mark.type === 'link') { const href = safeLink(mark.attrs?.href); if (href) html = `<a href="${esc(href)}">${html}</a>`; }
      const foreground = mark.type === 'textStyle' ? color(mark.attrs?.color) : null;
      if (foreground) html = `<span style="color:${foreground}">${html}</span>`;
      if (mark.type === 'highlight') html = `<mark style="background:${color(mark.attrs?.color) ?? '#fff2ac'}">${html}</mark>`;
    }
    return html;
  };
  const render = (node: DocumentNode): string => {
    const attrs = node.attrs ?? {}, content = () => (node.content ?? []).map(render).join('');
    if (node.type === 'text') return marked(node, text(node.text));
    switch (node.type) {
      case 'doc': return content();
      case 'blockRow': return `<div class="block-row">${content()}</div>`;
      case 'blockColumn': return `<div class="block-column" style="flex-basis:${Math.max(1, Math.min(100, Number(attrs.span) || 100))}%">${content()}</div>`;
      case 'editableBlock': {
        if (attrs.kind === 'formSubmit') return '';
        const config = readRecursiveConfig(attrs.recursive);
        const rows = config.relationColumnId ? input.relationRows?.[config.relationColumnId] ?? [] : [];
        if (attrs.kind === 'tableRecursive') return recursiveTableHtml(config, rows, (id) => input.resolve(`@{${id}}`));
        if (attrs.kind === 'calendarRecursive') return recursiveCalendarHtml(config, rows, (id) => input.resolve(`@{${id}}`));
        return `<section class="editor-block" style="padding-left:${Math.min(3, Math.max(0, Number(attrs.indent) || 0)) * 20}px">${content()}</section>`;
      }
      case 'paragraph': return `<p>${content() || '<br>'}</p>`;
      case 'heading': { const level = Math.min(3, Math.max(1, Number(attrs.level) || 1)); return `<h${level}>${content()}</h${level}>`; }
      case 'hardBreak': return '<br>';
      case 'horizontalRule': return '<hr>';
      case 'bulletList': return `<ul>${content()}</ul>`;
      case 'orderedList': return `<ol start="${Math.max(1, Number(attrs.start) || 1)}">${content()}</ol>`;
      case 'listItem': return `<li>${content()}</li>`;
      case 'taskList': return `<ul class="task-list">${content()}</ul>`;
      case 'taskItem': return `<li class="task-item" data-checked="${attrs.checked === true}"><span class="task-check" aria-hidden="true"></span><div>${content()}</div></li>`;
      case 'blockquote': return `<blockquote>${content()}</blockquote>`;
      case 'callout': return `<aside class="callout">${content()}</aside>`;
      case 'codeBlock': {
        const raw = (node.content ?? []).map((part) => input.resolve(part.text ?? '')).join('');
        const language = typeof attrs.language === 'string' && hljs.getLanguage(attrs.language) ? attrs.language : null;
        return `<pre><code>${language ? hljs.highlight(raw, { language }).value : esc(raw)}</code></pre>`;
      }
      case 'mention': {
        const foreground = color(node.marks?.find((mark) => mark.type === 'textStyle')?.attrs?.color);
        return marked(node, `<span class="mention"${foreground ? ` style="color:${foreground}"` : ''}>${text(`@{${String(attrs.id ?? '')}}`)}</span>`);
      }
      case 'inlineMath': case 'blockMath': {
        const displayMode = node.type === 'blockMath';
        const html = `<${displayMode ? 'div' : 'span'} class="${displayMode ? 'math-block' : 'math-inline'}">${katex.renderToString(String(attrs.latex ?? ''), { displayMode, throwOnError: false, trust: false, maxExpand: 1000, output: 'html' })}</${displayMode ? 'div' : 'span'}>`;
        return displayMode ? html : marked(node, html);
      }
      case 'imageBlock': {
        const src = String(attrs.src ?? '');
        if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(src)) return '';
        return `<figure class="image-block" style="margin-left:0;margin-right:0"><img src="${esc(src)}" alt="${text(attrs.alt)}" style="width:${Math.min(4000, Math.max(16, Number(attrs.width) || 720))}px">${attrs.caption ? `<figcaption>${text(attrs.caption)}</figcaption>` : ''}</figure>`;
      }
      default: return content();
    }
  };
  return `${input.includePageTitle === false ? '' : `<h1 class="page-title">${text(input.title)}</h1>`}${render(document)}`;
}
export function pageExportHtml(body: string, assets = ''): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline';"><style>${PAGE_EXPORT_CSS}.hljs-comment,.hljs-quote{color:#888}.hljs-keyword,.hljs-selector-tag,.hljs-type{color:#8150bd}.hljs-string,.hljs-attr,.hljs-addition{color:#279464}.hljs-number,.hljs-literal,.hljs-symbol{color:#a07112}.hljs-title,.hljs-built_in{color:#3480cc}${assets}</style></head><body>${body}</body></html>`;
}
