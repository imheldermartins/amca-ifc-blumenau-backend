/** Smoke HTTP contra a API e o rqlite descartáveis; nunca usa a base de desenvolvimento. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from 'ulid';

if (process.env.RQLITE_PORT !== '18012') throw new Error('Use exclusivamente RQLITE_PORT=18012.');
const origin = 'http://127.0.0.1:3008/api';
async function call(method: string, path: string, token?: string, body?: unknown, expected = 200) {
  const response = await fetch(origin + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expected, method + ' ' + path + ': ' + (data.message ?? response.status));
  return data;
}
const suffix = ulid().toLowerCase();
const password = 'Cubs-test-2026!only-local';
const ownerEmail = 'owner-' + suffix + '@example.test', readerEmail = 'reader-' + suffix + '@example.test';
const owner = await call('POST','/auth/register',undefined,{name:'Owner de validação',email:ownerEmail,password},201);
const reader = await call('POST','/auth/register',undefined,{name:'Pessoa leitora',email:readerEmail,password},201);
const organization = await call('POST','/organizations',owner.accessToken,{name:'Cub • Validação'},201);
assert.equal(organization.ownerId,owner.user.id);
assert.equal(organization.isOwner,true);
const workspace = await call('POST','/workspaces',owner.accessToken,{name:'Pesquisa',organizationId:organization.id},201);
const pendingWorkspace = await call('POST','/workspaces',owner.accessToken,{name:'Operações',organizationId:organization.id},201);
const organizationRole = await call('POST',`/access/organization/${organization.id}/roles`,owner.accessToken,{name:'Catálogo',roles:{read:['view','workspaces'],write:[]}});
await call('POST',`/access/organization/${organization.id}/members`,owner.accessToken,{email:readerEmail,roleId:organizationRole.id});
const catalog = await call('GET',`/organizations/${organization.id}/workspaces`,reader.accessToken);
assert.equal(catalog.length,2);
assert.ok(catalog.every((row: {canEnter:boolean})=>!row.canEnter));
await call('GET',`/workspaces/${workspace.id}`,reader.accessToken,undefined,403);
await call('PUT',`/organizations/${organization.id}`,reader.accessToken,{name:'Sem permissão'},403);
await call('POST',`/access/organization/${organization.id}/roles`,reader.accessToken,{name:'Escalada',roles:{read:['view'],write:['manage_workspaces']}},403);
const role = await call('POST',`/access/workspace/${workspace.id}/roles`,owner.accessToken,{name:'Leitura',roles:{read:['view'],write:[]}});
const request = await call('POST',`/access/workspace/${workspace.id}/requests`,reader.accessToken);
assert.equal(request.notificationPending,true);
let rows = await call('GET',`/access/workspace/${workspace.id}/requests`,owner.accessToken);
assert.equal(rows[0].status,'pending');
await call('POST',`/access/workspace/${workspace.id}/requests/${request.request.id}/decision`,reader.accessToken,{decision:'accepted',roleId:role.id},409);
await call('POST',`/access/workspace/${workspace.id}/requests/${request.request.id}/decision`,owner.accessToken,{decision:'accepted',roleId:role.id,accepted_by:reader.user.id});
rows = await call('GET',`/access/workspace/${workspace.id}/requests`,owner.accessToken);
assert.equal(rows[0].acceptedBy,owner.user.id);
const admitted = await call('GET',`/workspaces/${workspace.id}`,reader.accessToken);
assert.notEqual(admitted.pageRootId,workspace.id);
await call('PUT',`/workspaces/${workspace.id}`,reader.accessToken,{name:'Sem permissão',icon:'lucide:box'},403);
const pageRole = await call('POST',`/access/page/${workspace.id}/roles`,owner.accessToken,{name:'Leitura da base',roles:{read:['view','subpages','members'],write:[]}});
await call('POST',`/access/page/${workspace.id}/members`,owner.accessToken,{email:readerEmail,roleId:pageRole.id});
await call('GET',`/pages/${workspace.id}/page`,reader.accessToken);
await call('PUT',`/pages/${workspace.id}`,reader.accessToken,{title:'Tentativa sem edição'},403);
await call('PUT',`/access/organization/${organization.id}/member/${owner.user.id}`,owner.accessToken,{roleId:organizationRole.id},403);
const fixturePath = join(tmpdir(),'cubs-access-validation.json');
await writeFile(fixturePath,JSON.stringify({ownerEmail,readerEmail,password,ownerId:owner.user.id,readerId:reader.user.id,organizationId:organization.id,workspaceId:workspace.id,pendingWorkspaceId:pendingWorkspace.id,pageRoleId:pageRole.id},null,2));
console.log('Smoke HTTP aprovado: identidade validada, catálogo, roles, aceite auditado, root e bloqueio de escrita.');
console.log('Fixture sintética do browser: '+fixturePath);
