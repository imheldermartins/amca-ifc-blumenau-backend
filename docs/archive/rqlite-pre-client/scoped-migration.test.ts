import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe,it,expect } from 'vitest';
import { ulid } from 'ulid';
import { migration } from './migrations/20260912041438_scoped_roles_access_keys_and_membership_requests.js';
describe('migração de acessos existentes',()=>{
 it('preserva owners, permissões, roots e auditoria de chaves na base preenchida',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    const directory=new URL('./migrations/',import.meta.url);
    for(const file of readdirSync(directory).filter(name=>name.endsWith('.ts')&&name<migration.id+'.ts').sort()){
      const {migration:legacy}=await import(pathToFileURL(fileURLToPath(new URL(file,directory))).href);
      db.exec('BEGIN');
      for(const statement of legacy.up)db.exec(statement);
      db.exec('COMMIT');
    }
    const owner=ulid(),member=ulid(),org=ulid(),workspace=ulid(),memberRoot=ulid();
    const ownerMembership=ulid(),memberMembership=ulid(),key=ulid();
    const run=(sql:string,...values:string[])=>db.prepare(sql).run(...values);
    for(const id of [owner,member])run('INSERT INTO users(id,name,email) VALUES(?,?,?)',id,'Pessoa',id+'@example.test');
    run("INSERT INTO organizations(id,name,data) VALUES(?,?,'{}')",org,'Legada');
    run("INSERT INTO organization_members(id,organization_id,user_id,role,created_at) VALUES(?,?,?,'superadmin','2026-01-01')",ownerMembership,org,owner);
    run("INSERT INTO organization_members(id,organization_id,user_id,role,created_at) VALUES(?,?,?,'member','2026-01-02')",memberMembership,org,member);
    run("INSERT INTO workspaces(id,name,data,organization_id,created_by_user_id) VALUES(?,?,'{}',?,?)",workspace,'Legada',org,owner);
    for(const [id,user] of [[workspace,owner],[memberRoot,member]])run("INSERT INTO pages(id,title,data,owner_id) VALUES(?,?,'{}',?)",id!,'Base',user!);
    run("INSERT INTO workspace_members(id,workspace_id,user_id,role,page_root_id) VALUES(?,?,?,'superadmin',?)",ulid(),workspace,owner,workspace);
    run("INSERT INTO workspace_members(id,workspace_id,user_id,role,page_root_id) VALUES(?,?,?,'member',?)",ulid(),workspace,member,memberRoot);
    run("INSERT INTO page_collaborators(id,page_id,user_id) VALUES(?,?,?)",ulid(),workspace,member);
    run("INSERT INTO workspace_access_keys(id,key_hash,key_hint,algorithm_version,issued_to_name,issued_to_email,purpose,expires_at,consumed_at,consumed_by_user_id,consumed_as_name,consumed_as_email) VALUES(?,?,?,'sha256-v1',?,?,'join','2099-01-01','2026-01-01',?,?,?)",
      key,'a'.repeat(64),'hint','Emitida','issued@example.test',member,'Consumida','consumed@example.test');
    run('INSERT INTO workspace_access_key_links(id,access_key_id,workspace_id) VALUES(?,?,?)',ulid(),key,workspace);
    db.exec('BEGIN');
    for(const statement of migration.up)db.exec(statement);
    db.exec('COMMIT');
    expect(db.prepare('SELECT owner_id FROM organizations WHERE id=?').get(org)).toMatchObject({owner_id:owner});
    expect(db.prepare('SELECT page_root_id FROM workspace_members WHERE user_id=?').get(member)).toMatchObject({page_root_id:memberRoot});
    const imported=db.prepare('SELECT roles FROM organization_roles WHERE id=?').get(ownerMembership) as {roles:string};
    expect(JSON.parse(imported.roles).write).toContain('manage_workspaces');
    expect(db.prepare('SELECT * FROM access_key WHERE id=?').get(key)).toMatchObject({workspace_id:workspace,issued_to_email:'issued@example.test',consumed_as_email:'consumed@example.test',consumed_by_user_id:member});
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_access_key_links'").all()).toEqual([]);
  }finally{db.close()}
 });
});
