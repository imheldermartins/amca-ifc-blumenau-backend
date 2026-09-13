import { beforeAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { rqlite } from './shared.js';
import access from './scoped-access-store.js';
import roles from './role-store.js';
import requests from './membership-request-store.js';
import organizations from './organization-store.js';
import workspaces from './workspace-store.js';
import onboarding from './auth-onboarding-store.js';
import { fullPermissions } from '@core/auth/permissions';

const suite = process.env.RUN_RQLITE_INTEGRATION === '1' ? describe : describe.skip;
suite('permissões e provisionamento no rqlite isolado', () => {
  const owner = ulid(), manager = ulid(), reader = ulid(), stranger = ulid();
  const organization = ulid(), workspace = ulid(), child = ulid(), grandchild = ulid();
  let readerRole = '', managerRole = '';
  beforeAll(async () => {
    if (process.env.RQLITE_PORT !== '18012') throw new Error('Use a base de validação na porta 18012.');
    await rqlite([
      ...[owner, manager, reader, stranger].map(id => [
        'INSERT INTO users (id,name,email,email_verified_at) VALUES (?,?,?,CURRENT_TIMESTAMP)',
        id, 'Pessoa ' + id, id.toLowerCase() + '@example.test',
      ] as RqliteStatement),
      ['INSERT INTO organizations (id,name,data,owner_id) VALUES (?,?,?,?)', organization, 'Organização de teste', '{}', owner],
      ['INSERT INTO organization_members (id,organization_id,user_id) VALUES (?,?,?)', ulid(), organization, owner],
    ], 'execute', { transaction: true });
    expect(await workspaces.createInOrganization({ workspaceId: workspace, organizationId: organization, ownerId: owner, workspaceName: 'Workspace de teste', workspaceIcon: 'lucide:boxes', rootTitle: 'Base', membershipId: ulid() })).toBe(true);
    await rqlite([
      ['INSERT INTO pages (id,title,data,owner_id) VALUES (?,?,?,?)', child, 'Filha', '{}', owner],
      ['INSERT INTO pages (id,title,data,owner_id) VALUES (?,?,?,?)', grandchild, 'Neta', '{}', owner],
      ['INSERT INTO page_edges (id,parent_id,child_id) VALUES (?,?,?)', ulid(), workspace, child],
      ['INSERT INTO page_edges (id,parent_id,child_id) VALUES (?,?,?)', ulid(), child, grandchild],
    ], 'execute', { transaction: true });
    readerRole = (await roles.save('organization', organization, owner, { name: 'Catálogo', roles: { read: ['view','workspaces'], write: [] } }))!.id;
    managerRole = (await roles.save('organization', organization, owner, { name: 'Autonomia', roles: fullPermissions('organization') }))!.id;
    expect(await roles.addMember('organization', organization, owner, reader, readerRole)).toBe(true);
    expect(await roles.addMember('organization', organization, owner, manager, managerRole)).toBe(true);
  }, 30_000);
  it('owner e gestor delegado administram workspaces sem membership individual', async () => {
    expect(await access.can('workspace', workspace, owner, 'write','promote_members')).toBe(true);
    expect(await access.can('workspace', workspace, manager, 'write','create_wk_roles')).toBe(true);
    expect((await access.get('workspace', workspace, manager))?.isOwner).toBe(false);
    expect(await access.can('page', grandchild, manager, 'write','update')).toBe(true);
    expect(await access.can('organization', organization, stranger, 'read','view')).toBe(false);
  });
  it('catálogo não concede entrada e owner não pode ser rebaixado', async () => {
    expect(await organizations.catalog(organization, reader)).toEqual([expect.objectContaining({ id: workspace, canEnter: false })]);
    expect(await workspaces.getForUser(workspace, reader)).toBeNull();
    expect(await roles.assign('organization', organization, manager, owner, readerRole)).toBe(false);
    expect(await roles.removeMember('organization', organization, manager, owner)).toBe(false);
    expect(await roles.save('organization', organization, reader, { name:'Escalada',roles:fullPermissions('organization') })).toBeNull();
    expect(await roles.assign('organization', organization, reader, reader, managerRole)).toBe(false);
  });
  it('gestor limitado não remove nem reduz outro membro com poderes superiores', async () => {
    const recruiter = ulid();
    await rqlite([['INSERT INTO users (id,name,email) VALUES (?,?,?)',recruiter,'Recrutador',recruiter+'@example.test']], 'execute');
    const limited = await roles.save('organization',organization,owner,{name:'Recrutamento',roles:{read:['view','members'],write:['add_members','promote_members','create_org_roles']}});
    expect(await roles.addMember('organization',organization,owner,recruiter,limited!.id)).toBe(true);
    expect(await roles.assign('organization',organization,recruiter,manager,limited!.id)).toBe(false);
    expect(await roles.removeMember('organization',organization,recruiter,manager)).toBe(false);
    const powerful = await roles.get('organization',organization,managerRole);
    expect(await roles.save('organization',organization,recruiter,{id:managerRole,name:'Reduzida',expectedUpdatedAt:powerful!.updated_at,roles:{read:['view'],write:[]}})).toBeNull();
  });
  it('herda leitura; editar subpáginas exige permissão específica', async () => {
    const role = await roles.save('page', workspace, owner, { name: 'Leitura da árvore', roles: { read: ['view','subpages'], write: [] } });
    expect(role).not.toBeNull();
    expect(await roles.addMember('page', workspace, owner, stranger, role!.id)).toBe(true);
    expect(await access.can('page', grandchild, stranger, 'read','view')).toBe(true);
    expect(await access.can('page', grandchild, stranger, 'write','update')).toBe(false);
    const changed = await roles.save('page', workspace, owner, { id: role!.id, expectedUpdatedAt: role!.updated_at, name: role!.name,
      roles: { read: ['view','subpages'], write: ['update','create','edit_subpages'] } });
    expect(changed).not.toBeNull();
    expect(await access.can('page', grandchild, stranger, 'write','update')).toBe(true);
    expect(await access.can('page', grandchild, stranger, 'write','create_page_roles')).toBe(false);
    const middle = await roles.save('page', child, owner, {name:'Somente leitura deste ramo',roles:{read:['view','subpages'],write:[]}});
    expect(await roles.addMember('page',child,owner,stranger,middle!.id)).toBe(true);
    expect(await access.can('page',grandchild,stranger,'read','view')).toBe(true);
    expect(await access.can('page',grandchild,stranger,'write','update')).toBe(false);
    const deny = await roles.save('page', grandchild, owner, { name: 'Sem acesso', roles: { read: [], write: [] } });
    expect(await roles.addMember('page', grandchild, owner, stranger, deny!.id)).toBe(true);
    expect(await access.can('page', grandchild, stranger, 'read','view')).toBe(false);
  });
  it('notifica apenas os aprovadores de cada escopo, incluindo owner herdado',async()=>{
    for(const [scope,id] of [['organization',organization],['workspace',workspace],['page',grandchild]] as const){
      const context=await requests.notificationContext(scope,id,reader);
      expect(context.requester?.id).toBe(reader);
      expect(context.approvers.map(person=>person.id)).toEqual(expect.arrayContaining([owner,manager]));
      expect(context.approvers.map(person=>person.id)).not.toContain(stranger);
    }
    expect((await roles.members('page',grandchild)).some(member=>member.id===owner)).toBe(true);
  });
  it('solicitação idempotente, role do escopo e aceite único auditado', async () => {
    const role = await roles.save('workspace', workspace, owner, { name:'Participação',roles:{ read:['view'],write:[] } });
    const first = await requests.create('workspace', workspace, reader);
    const second = await requests.create('workspace', workspace, reader);
    expect(first?.request.id).toBe(second?.request.id);
    expect(second?.created).toBe(false);
    expect(await requests.decide('workspace',workspace,first!.request.id,reader,'accepted',role!.id)).toBe(false);
    expect(await requests.decide('workspace',workspace,first!.request.id,owner,'accepted',readerRole)).toBe(false);
    const decisions = await Promise.all([owner,manager].map(actor => requests.decide('workspace',workspace,first!.request.id,actor,'accepted',role!.id)));
    expect(decisions.filter(Boolean)).toHaveLength(1);
    const accepted = (await requests.list('workspace',workspace,owner))[0]!;
    expect(accepted.status).toBe('accepted');
    expect([owner,manager]).toContain(accepted.acceptedBy);
    expect((await workspaces.getForUser(workspace,reader))?.pageRootId).not.toBe(workspace);
  });
  it('cadastro privado e criação de organização exigem conta validada', async () => {
    const userId=ulid(), privateId=ulid(), pendingUser=ulid();
    expect(await onboarding.createPrivateWorkspace({userId,userName:'Nova Pessoa',userEmail:userId+'@example.test',passwordHash:'test-only',workspaceId:privateId,workspaceName:'Privada',workspaceIcon:'lucide:boxes',membershipId:ulid()})).toBe(true);
    expect((await workspaces.getForUser(privateId,userId))?.isOwner).toBe(true);
    await rqlite([['UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ?',userId],
      ['INSERT INTO users (id,name,email) VALUES (?,?,?)',pendingUser,'Pendente',pendingUser+'@example.test']], 'execute', {transaction:true});
    expect(await organizations.create({organizationId:ulid(),organizationName:'Organização inválida',ownerId:pendingUser,membershipId:ulid()})).toBe(false);
    expect(await organizations.create({organizationId:ulid(),organizationName:'Organização validada',ownerId:userId,membershipId:ulid()})).toBe(true);
  });
});
