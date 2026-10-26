/** Explicit live fixture for the requested account. PDFs stay in memory. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ulid } from 'ulid';
import { unzipSync } from 'fflate';
import models from '@/models/index';
import type { Schema } from '@/db/schemas/index';
import jwt from '@/services/auth/jwt-service';
import { CHILD_TITLE, childColumn, recursiveToken } from '@/services/pages/recursive-template';
import { NotificationWorker } from '@/services/notifications/notification-worker';
import { NotificationStore } from '@/repositories/notification-repository';
import { ScheduleStore } from '@/repositories/schedule-repository';
import type { NotificationDeliveryRow } from '@/repositories/types/notification-repository.types';

const recipient = 'eusouhelder123@gmail.com';
const apiOrigin = 'http://127.0.0.1:3000/api/v1';
const appOrigin = 'http://localhost:5173';
const artifactDir = resolve('artifacts/pdf-example-helder');
const manifestPath = resolve(artifactDir, 'manifest.json');
interface Manifest {
  recipient: string; userId: string; rootId: string;
  pages: Record<string, string>; columns: Record<string, string>; views: Record<string, string>;
  review?: { pages: number; pngs: string[]; relationTitlesVerified: boolean; batchVerified: boolean };
  email?: { executionId: string; deliveryId: string; status: string; messageId: string | null };
}
interface ApiPage { id: string; title: string | null; data: Record<string, unknown> }
let manifest: Manifest;
const user = await models.users.find({ email: recipient });
assert(user?.email_verified_at, 'Conta verificada não encontrada');
const memberships = await models.workspaceMembers.findAll({ user_id: user.id } as LookupsConfig<Schema.WorkspaceMember>);
let rootId = '';
for (const membership of memberships ?? []) {
  const workspace = await models.workspaces.find({ id: membership.workspace_id });
  if (workspace && !workspace.organization_id) { rootId = membership.page_root_id; break; }
}
assert(rootId, 'Workspace pessoal não encontrado');
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest; }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; manifest = { recipient, userId: user.id, rootId, pages: {}, columns: {}, views: {} }; }
assert.equal(manifest.userId, user.id); assert.equal(manifest.rootId, rootId);
const token = jwt.signAccessToken({ sub: user.id });
const save = async () => { await mkdir(artifactDir, { recursive: true }); await writeFile(manifestPath, JSON.stringify(manifest, null, 2)); };
async function response(path: string, method = 'GET', body?: unknown) {
  return fetch(`${apiOrigin}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await response(path, method, body);
  const content: unknown = await result.json();
  if (!result.ok) throw new Error(`${method} ${path}: ${result.status} ${JSON.stringify(content)}`);
  return content as T;
}
function page(key: string) { const id = manifest.pages[key]; assert(id, `Página ausente: ${key}`); return id; }
function column(key: string) { const id = manifest.columns[key]; assert(id, `Coluna ausente: ${key}`); return id; }
async function ensurePage(key: string, parentId: string, title: string, data: Record<string, unknown> = {}) {
  if (manifest.pages[key]) return api<ApiPage>(`/pages/${manifest.pages[key]}`);
  const created = await api<ApiPage>(`/pages/${parentId}/page`, 'POST', { title, data });
  manifest.pages[key] = created.id; await save(); return created;
}
async function ensureColumn(key: string, name: string, type: string, configuration: Record<string, unknown> = {}, databaseId = page('report')) {
  if (manifest.columns[key]) return column(key);
  const created = await api<{ id: string }>(`/pages/parent/${databaseId}/columns`, 'POST', { name, type, ...configuration });
  assert(created.id, `ID ausente na criação de ${name}`);
  manifest.columns[key] = created.id; await save(); return created.id;
}
async function setCell(row: string, key: string, value: unknown) {
  const path = `/pages/${row}/column/${column(key)}/value`;
  const existing = await response(path);
  await api(path, existing.ok ? 'PUT' : 'POST', { value });
}
const text = (value: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'text', text: value, ...(marks && { marks }) });
const p = (value: string) => ({ type: 'paragraph', content: [text(value)] });
const heading = (value: string) => ({ type: 'heading', attrs: { level: 2 }, content: [text(value)] });
const mention = (id: string) => ({ type: 'mention', attrs: { id } });
const block = (kind: string, content: unknown[], extra: Record<string, unknown> = {}) => ({ type: 'editableBlock', attrs: { id: ulid(), kind, indent: 0, ...extra }, content });
const doc = (blocks: unknown[]) => ({ type: 'doc', content: [{ type: 'blockRow', attrs: { id: ulid() }, content: [{ type: 'blockColumn', attrs: { id: ulid(), span: 100 }, content: blocks }] }] });
const link = (label: string, id: string) => ({ type: 'paragraph', content: [text(label, [{ type: 'link', attrs: { href: `${appOrigin}/pt-br/page/${id}` } }])] });

async function prepare() {
  const hub = await ensurePage('hub', rootId, 'Testes · PDF, Recursive e Relation');
  await ensurePage('projects', hub.id, 'Projetos relacionados · exemplos');
  await ensurePage('portal', page('projects'), 'Portal Cub’s · Site institucional');
  await ensurePage('finance', page('projects'), 'Aplicativo Financeiro');
  await ensurePage('support', page('projects'), 'Central de Atendimento & Suporte');
  if (!manifest.views.table) { manifest.views.table = ulid(); manifest.views.calendar = ulid(); await save(); }
  const tableId = manifest.views.table!, calendarId = manifest.views.calendar!;
  await ensurePage('report', hub.id, 'Relatório de entregas · template PDF', {
    [tableId]: { view: 'table', name: 'Entregas e relações', urlKey: 'entregas', title: { key: 'title', column_name: 'Entrega' } },
    [calendarId]: { view: 'calendar', name: 'Calendário das entregas', urlKey: 'calendario', title: { key: 'title', column_name: 'Entrega' } },
  });
  await ensureColumn('date', 'Data da entrega', 'date');
  await ensureColumn('value', 'Valor previsto', 'numeric', { format: 'currency', currency: 'BRL' });
  await ensureColumn('project', 'Projetos relacionados', 'relation', { relation: { version: 1, targetDatabaseId: page('projects'), cardinality: 'many' } });
  await ensureColumn('notes', 'Observações', 'text');
  await ensureColumn('mail', 'Enviar exemplo PDF por email', 'flow', { flowButton: { label: 'Enviar PDF de exemplo', icon: 'lucide:mail' } });
  await ensureColumn('projectDate', 'Data do projeto', 'date', {}, page('projects'));
  await ensureColumn('projectValue', 'Valor do projeto', 'numeric', { format: 'currency', currency: 'BRL' }, page('projects'));
  for (const [index, key] of ['portal', 'finance', 'support'].entries()) {
    await setCell(page(key), 'projectDate', ['2026-10-28T00:00:00.000Z', '2026-11-04T00:00:00.000Z', '2028-03-15T00:00:00.000Z'][index]);
    await setCell(page(key), 'projectValue', (index + 1) * 125000);
  }
  const examples = [
    { key: 'delivery-portal', title: 'Entrega · Portal institucional', date: '2026-10-28T00:00:00.000Z', value: 125000, projects: ['portal'], note: 'Relation simples: um projeto, exibido pelo título.' },
    { key: 'delivery-finance', title: 'Entrega · Integração financeira', date: '2026-11-04T00:00:00.000Z@2026-11-06T00:00:00.000Z', value: 248050, projects: ['finance', 'support'], note: 'Relation múltipla e intervalo de datas; os dois títulos devem aparecer.' },
    { key: 'delivery-future', title: 'Entrega · Expansão em 2028', date: '2028-03-15T00:00:00.000Z', value: 375090, projects: ['portal', 'finance'], note: 'Mês distante: março de 2028. O intervalo de meses vazios não é impresso.' },
    { key: 'delivery-undated', title: 'Entrega · Aguardando agendamento', date: null, value: 90000, projects: [], note: 'Sem data: aparece na tabela e não aparece no calendário. Relation vazia.' },
  ];
  for (const example of examples) {
    const child = await ensurePage(example.key, page('report'), example.title);
    if (example.date) await setCell(child.id, 'date', example.date);
    await setCell(child.id, 'value', example.value); await setCell(child.id, 'project', example.projects.map(page)); await setCell(child.id, 'notes', example.note);
    await api(`/pages/${child.id}/document`, 'PUT', { content: doc([block('richText', [heading('Página filha de exemplo'), p(example.note), p('Para testar o template: volte ao relatório, selecione esta entrega e use PDF em Lote. O Flow desta linha também anexa o template do pai.'), link('Abrir relatório / template PDF', page('report'))])]) });
  }
  const fields = [
    { id: 'title', label: 'Projeto relacionado', text: recursiveToken(CHILD_TITLE) },
    { id: 'date', label: 'Data do projeto', text: recursiveToken(childColumn(column('projectDate'))) },
    { id: 'value', label: 'Valor do projeto', text: recursiveToken(childColumn(column('projectValue'))) },
  ];
  await api(`/pages/${page('report')}/document`, 'PUT', { content: doc([
    block('richText', [heading('Exemplo pronto · PDF com Relation'), p('Documento demonstrativo de Helder Martins. Os projetos na tabela e nos cards vêm de uma coluna Relation real; o PDF imprime os títulos das páginas relacionadas.'), { type: 'paragraph', content: [text('Entrega selecionada no template: ', [{ type: 'bold' }]), mention(CHILD_TITLE)] }]),
    block('richText', [heading('Table Recursive'), p('Um item por projeto da Relation desta entrega; relações simples, múltiplas ou vazias.')]),
    block('tableRecursive', [{ type: 'paragraph' }], { recursive: { version: 1, relationColumnId: column('project'), fields, dateColumnId: null } }),
    block('richText', [heading('Calendar Recursive'), p('Somente os meses ocupados pelos projetos relacionados a esta entrega, usando a data da base de projetos.')]),
    block('calendarRecursive', [{ type: 'paragraph' }], { recursive: { version: 1, relationColumnId: column('project'), fields: fields.filter((field) => ['title', 'value'].includes(field.id)), dateColumnId: column('projectDate') } }),
    block('richText', [heading('Como testar'), p('1. Na tabela, selecione duas ou mais entregas e clique em PDF em Lote ao lado dos filtros.'), p('2. O lote sempre usa este editor como template. Cada PDF contém somente os projetos da Relation de sua entrega. Escolha se deseja incluir o título, visualize a primeira entrega e baixe o ZIP.'), p('3. Gerar PDF na modal de usuários exporta a própria página. O Flow usa o template do pai, sem seletor de molde.')]),
  ]) });
  await api(`/pages/${page('hub')}/document`, 'PUT', { content: doc([block('richText', [heading('Área de testes pronta'), p('Exemplos de PDF individual, PDF em Lote, ZIP, Table Recursive, Calendar Recursive e coluna Relation.'), link('Abrir relatório de entregas e template PDF', page('report')), link('Abrir páginas dos projetos relacionados', page('projects')), p('Abra o relatório no Editor de blocos para editar a estrutura. Gerar PDF fica na modal de usuários. Na tabela, selecione duas ou mais entregas e use PDF em Lote ao lado dos filtros. O calendário também está disponível nas abas da base.')])]) });
  const visible = ['page_title', column('project'), column('date'), column('value'), column('notes'), column('mail')];
  await api(`/pages/${page('report')}/views/${tableId}`, 'PATCH', { orderedHeaderCols: visible, columnWidths: { page_title: 280, [column('project')]: 320, [column('date')]: 220, [column('value')]: 150, [column('notes')]: 340, [column('mail')]: 220 } });
  await api(`/pages/${page('report')}/views/${calendarId}`, 'PATCH', { dateColumnId: column('date'), calendarPropertyIds: [column('project'), column('value')] });
  await api(`/pages/parent/${page('report')}/columns/${column('mail')}/flow`, 'PUT', { flow: { version: 2, trigger: { type: 'manual' }, nodes: [
    { id: 'start', type: 'start', config: {} },
    { id: 'email', type: 'email', config: { to: `@people.${user!.id}.email`, subject: 'Cub’s · Exemplo PDF com Relation · @page.title', body: `Olá, Helder!\n\nSegue o PDF de exemplo da entrega @page.title, gerado pelo template da página pai. A Table Recursive e os cards do calendário mostram os títulos reais da coluna Relation.\n\nPágina de testes: ${appOrigin}/pt-br/page/${page('hub')}\nRelatório / template: ${appOrigin}/pt-br/page/${page('report')}\n\nAmbiente de desenvolvimento local. O anexo foi gerado em memória, sem gravar o PDF no banco ou em uma pasta.`, attachPagePdf: true, pdfTemplate: 'parent' } },
    { id: 'done', type: 'callback', config: { message: 'PDF de exemplo enfileirado para Helder.' } },
  ] } });
  await save(); console.log(JSON.stringify({ prepared: true, pages: manifest.pages, columns: manifest.columns, url: `${appOrigin}/pt-br/page/${page('hub')}` }));
}

async function review() {
  const source = page('report'), selected = page('delivery-portal');
  const catalog = await api<{ children: { id: string }[] }>(`/pages/${source}/pdf/catalog`);
  assert.equal(catalog.children.length, 4);
  const before = await api<{ value: string[] }>(`/pages/${selected}/column/${column('project')}/value`);
  const rejected = await response(`/pages/${selected}/column/${column('project')}/value`, 'PUT', { value: [page('hub')] });
  assert.equal(rejected.status, 400, 'Relation fora da database não foi rejeitada');
  const after = await api<{ value: string[] }>(`/pages/${selected}/column/${column('project')}/value`); assert.deepEqual(after.value, before.value);
  const result = await response(`/pages/${source}/pdf`, 'POST', { childIds: [selected] });
  if (!result.ok) throw new Error(await result.text());
  const buffer = new Uint8Array(await result.arrayBuffer());
  try {
    assert.equal(Buffer.from(buffer.subarray(0, 5)).toString(), '%PDF-');
    const { createCanvas, DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas');
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: buffer.slice(), useSystemFonts: true });
    const pdf = await task.promise;
    const pngs: string[] = [], texts: string[] = [];
    await mkdir(artifactDir, { recursive: true });
    try {
      for (let index = 1; index <= pdf.numPages; index++) {
        const pdfPage = await pdf.getPage(index), viewport = pdfPage.getViewport({ scale: 1.5 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await pdfPage.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise;
        const path = resolve(artifactDir, `relation-page-${index}.png`); await writeFile(path, canvas.toBuffer('image/png')); pngs.push(path);
        const content = await pdfPage.getTextContent(); texts.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
      }
      const fullText = texts.join(' ').normalize('NFKC').replace(/\s+/g, ' ');
      for (const label of ['Portal Cub’s', 'outubro de 2026']) assert(fullText.toLocaleLowerCase().includes(label.toLocaleLowerCase()), `Texto ausente no PDF: ${label}`);
      for (const label of ['Aplicativo Financeiro', 'Central de Atendimento']) assert(!fullText.includes(label), `Projeto de outra entrega vazou no PDF: ${label}`);
      assert(!fullText.includes('@{')); assert(!fullText.includes(column('project'))); assert(!fullText.includes(page('finance')));
      const batch = await response(`/pages/${source}/pdf`, 'POST', { childIds: [selected, page('delivery-finance')] }); assert(batch.ok, await batch.clone().text());
      const zip = new Uint8Array(await batch.arrayBuffer());
      try { const entries = unzipSync(zip); assert.equal(Object.keys(entries).length, 2); for (const content of Object.values(entries)) { assert.equal(Buffer.from(content.subarray(0, 5)).toString(), '%PDF-'); content.fill(0); } } finally { zip.fill(0); }
      manifest.review = { pages: pdf.numPages, pngs, relationTitlesVerified: true, batchVerified: true }; await save();
      console.log(JSON.stringify({ review: manifest.review, negativeRelationWriteRejected: true, pdfFilename: result.headers.get('content-disposition'), pdfBytes: buffer.length }));
    } finally { await task.destroy(); }
  } finally { buffer.fill(0); }
}

async function send() {
  assert(manifest.review?.relationTitlesVerified && manifest.review.batchVerified, 'Revise o PDF antes de enviar');
  if (manifest.email?.status === 'sent') { console.log(JSON.stringify({ alreadySent: manifest.email })); return; }
  if (!manifest.email) {
    const result = await api<{ executionId: string }>(`/pages/${page('delivery-portal')}/column/${column('mail')}/flow/execute`, 'POST', {});
    const notification = await models.notifications.find({ resource_id: result.executionId });
    assert(notification, 'Notificação do Flow não encontrada');
    const delivery = await models.notificationDeliveries.find({ notification_id: notification.id }); assert(delivery, 'Entrega não encontrada');
    manifest.email = { executionId: result.executionId, deliveryId: delivery.id, status: delivery.status, messageId: null }; await save();
  }
  const deliveryId = manifest.email.deliveryId;
  class ExampleNotifications extends NotificationStore {
    override async listDueDeliveries(): Promise<NotificationDeliveryRow[]> {
      const delivery = await models.notificationDeliveries.find({ id: deliveryId });
      assert(delivery); const payload: unknown = delivery.payload;
      const parsed = typeof payload === 'string' ? JSON.parse(payload) as { to?: { email?: string } } : payload as { to?: { email?: string } };
      assert.equal(parsed.to?.email, recipient, 'Destinatário diferente do autorizado');
      return delivery.status === 'sent' ? [] : [{ ...delivery, payload: typeof payload === 'string' ? payload : JSON.stringify(payload) }];
    }
  }
  class NoReminderCandidates extends ScheduleStore { override async listReminderCandidates() { return []; } }
  await new NotificationWorker(new ExampleNotifications(), new NoReminderCandidates()).runOnce();
  const delivered = await models.notificationDeliveries.find({ id: deliveryId }); assert(delivered);
  manifest.email.status = delivered.status; manifest.email.messageId = delivered.provider_message_id; await save();
  assert.equal(delivered.status, 'sent', `Email não enviado: ${delivered.last_error}`);
  console.log(JSON.stringify({ sentTo: recipient, delivery: manifest.email }));
}
const mode = process.argv[2];
if (mode === 'prepare') await prepare();
else if (mode === 'review') await review();
else if (mode === 'send') await send();
else throw new Error('Use page-pdf-example.ts prepare|review|send');
