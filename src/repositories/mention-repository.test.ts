import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MentionStore } from './mention-repository.js';
import { MentionController } from '@/controllers/mention-controller';
import { mentionId, mentionToken, parseMentionId, mentionIds, resolveMentionText } from '@/services/mentions/template';

const mocks = vi.hoisted(() => ({ sql: vi.fn(), workspace: vi.fn(), organization: vi.fn(), workspaceId: vi.fn(), people: vi.fn() }));
vi.mock('@models/index', () => ({ default: { sqlRaw: mocks.sql } }));
vi.mock('@/repositories/workspace-repository', () => ({ default: { getForUser: mocks.workspace } }));
vi.mock('@/repositories/organization-repository', () => ({ default: { getForUser: mocks.organization } }));
vi.mock('@/repositories/page-collaborator-repository', () => ({ default: { resolveWorkspaceId: mocks.workspaceId } }));
vi.mock('@/repositories/flow-repository', () => ({ default: { listPeople: mocks.people } }));
const user = '01M00000000000000000000001', page = '01M00000000000000000000002', workspace = '01M00000000000000000000003', org = '01M00000000000000000000004';
beforeEach(() => { vi.resetAllMocks(); mocks.sql.mockImplementation(async (statement: { text: string }) => statement.text.includes('FROM users') ? [{ id: user, name: 'Ana', email: 'ana@test.local' }] : []); mocks.people.mockResolvedValue([]); mocks.workspaceId.mockResolvedValue(workspace); mocks.workspace.mockResolvedValue(null); mocks.organization.mockResolvedValue(null) });

describe('scoped mention catalog', () => {
  it('loads the page properties through the live parent edge and actor guard', async () => {
    const store = new MentionStore();
    mocks.sql.mockResolvedValue([
      { id: org, name: 'Cliente', type: 'text', value_data: '{"value":"Ana"}' },
      { id: workspace, name: 'Tema', type: 'select', data: JSON.stringify({ options: [{ id: org, label: 'Pesquisa' }] }), value_data: JSON.stringify({ value: org }) },
      { id: page, name: 'Ativo', type: 'checkbox', value_data: '{"value":false}' },
    ]);
    expect(await store.columns(page, user)).toEqual([{ id: org, name: 'Cliente', value: 'Ana' }, { id: workspace, name: 'Tema', value: 'Pesquisa' }, { id: page, name: 'Ativo', value: 'false' }]);
    const statement = mocks.sql.mock.calls[0]![0];
    expect(statement.values).toEqual([page, page, user, 'read', 'view']);
    expect(statement.text).toContain('col.parent_id = parent.id AND col.deleted_at IS NULL');
    expect(statement.text).toContain('edge.child_id = pages.id');
    expect(statement.text).toContain('EXISTS (WITH RECURSIVE');
    mocks.sql.mockResolvedValue([]);
    expect(await store.columns(page, user)).toEqual([]);
  });
  it('uses the actual page workspace and authorized organization, never the shell selection', async () => {
    const store = new MentionStore(); vi.spyOn(store, 'page').mockResolvedValue({ id: page, title: 'Base' });
    mocks.workspace.mockResolvedValue({ id: workspace, name: 'W', organizationId: org, data: { campaign: 'Outono' } });
    mocks.organization.mockResolvedValue({ id: org, name: 'O', data: { brand: 'Cubs' } });
    const catalog = await store.catalog(user, { pageId: page, workspaceId: org });
    expect(mocks.workspace).toHaveBeenCalledWith(workspace, user);
    expect(catalog.workspace?.id).toBe(workspace); expect(catalog.organization?.id).toBe(org);
    expect(catalog.users[0]?.id).toBe(user);
  });
  it('omits page and workspace data when the page is inaccessible', async () => {
    const store = new MentionStore(); vi.spyOn(store, 'page').mockResolvedValue(undefined);
    expect(await store.catalog(user, { pageId: page, workspaceId: workspace })).toEqual({ users: [{ id: user, name: 'Ana', email: 'ana@test.local' }] });
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.people).not.toHaveBeenCalled();
  });
  it('does not expose workspace data to a page-only collaborator', async () => {
    const store = new MentionStore(); vi.spyOn(store, 'page').mockResolvedValue({ id: page, title: 'Shared' });
    const result = await store.catalog(user, { pageId: page, organizationId: org });
    expect(result.workspace).toBeUndefined(); expect(result.organization).toBeUndefined(); expect(mocks.organization).not.toHaveBeenCalled();
  });
});

describe('dynamic reference resolution', () => {
  it('resolves a title from row properties, including nested references, deletion and cycles', async () => {
    const store = new MentionStore(); vi.spyOn(store, 'catalog').mockResolvedValue({ users: [] });
    const title = mentionId('pages', page, 'title'), column = mentionId('pages', page, `columns.${org}`);
    vi.spyOn(store, 'page').mockResolvedValue({ id: page, title: `Projeto ${mentionToken(column)}` });
    const read = vi.spyOn(store, 'columns').mockResolvedValue([{ id: org, name: 'Cliente', value: 'Ana' }]);
    expect(await store.resolve(user, {}, [title, column])).toEqual({ [title]: 'Projeto Ana', [column]: 'Ana' });
    expect(read).toHaveBeenCalledWith(page, user);
    read.mockResolvedValue([{ id: org, name: 'Renomeado', value: mentionToken(title) }]);
    expect(await store.resolve(user, {}, [title])).toEqual({ [title]: null });
    read.mockResolvedValue([]);
    expect(await store.resolve(user, {}, [column])).toEqual({ [column]: null });
    expect(parseMentionId(mentionId('pages', page, 'columns.invalid'))).toBeNull();
  });
  it('resolves literal data keys and checks every transitive page/workspace reference for the actor', async () => {
    const store = new MentionStore(); vi.spyOn(store, 'catalog').mockResolvedValue({ users: [{ id: user, name: 'Ana', email: 'a@x.local' }] });
    const variable = mentionId('workspace', workspace, 'data.a.b["c"]'); const title = mentionId('pages', page, 'title');
    mocks.workspace.mockResolvedValue({ id: workspace, data: { 'a.b["c"]': 'Novo' } });
    const read = vi.spyOn(store, 'page').mockResolvedValue({ id: page, title: `Projeto ${mentionToken(variable)}` });
    expect(await store.resolve(user, {}, [title])).toEqual({ [title]: 'Projeto Novo' });
    expect(read).toHaveBeenCalledWith(page, user); expect(mocks.workspace).toHaveBeenCalledWith(workspace, user);
    mocks.workspace.mockResolvedValue(null);
    expect(await store.resolve(user, {}, [title])).toEqual({ [title]: null });
  });
  it('bounds cycles and hides users outside the authorized context', async () => {
    const store = new MentionStore(); vi.spyOn(store, 'catalog').mockResolvedValue({ users: [] });
    const id = mentionId('pages', page, 'title'); vi.spyOn(store, 'page').mockResolvedValue({ id: page, title: mentionToken(id) });
    expect(await store.resolve(user, {}, [id, mentionId('users', user, 'email')])).toEqual({ [id]: null, [mentionId('users', user, 'email')]: null });
  });
  it('accepts only public typed fields and valid bounded query inputs', async () => {
    const controller = new MentionController(new MentionStore());
    expect((await controller.resolve(user, { scope: {}, ids: [`users:${user}:password`] })).status).toBe(400);
    expect((await controller.catalog(user, { pageId: 'invalid' })).status).toBe(400);
    expect((await controller.resolve(user, { scope: {}, ids: Array(101).fill(mentionId('pages', page, 'title')) })).status).toBe(400);
    expect(parseMentionId(`users:${user}:password`)).toBeNull();
  });
  it('keeps reference ids independent of labels and renders resolved values literally', () => {
    const id = mentionId('workspace', workspace, 'data.a:ç'); const token = mentionToken(id);
    expect(parseMentionId(id)?.field).toBe('data.a:ç'); expect(mentionIds(`${token}${token}`)).toEqual([id]);
    expect(resolveMentionText(token, { [id]: '<script>literal</script>' })).toBe('<script>literal</script>');
    const unicode = mentionId('workspace', workspace, `data.${'界'.repeat(120)}`);
    expect(mentionIds(mentionToken(unicode))).toEqual([unicode]);
    expect(resolveMentionText(mentionToken(unicode), { [unicode]: 'Texto' })).toBe('Texto');
  });
});
