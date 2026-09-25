import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {it,expect} from 'vitest';
import {ulid} from 'ulid';
import {loadChain} from '@cubs/rqlite-client/migrations';

it('creates the current scoped constraints directly from the generated initial migration',async()=>{
  const chain=await loadChain(fileURLToPath(new URL('./migrations',import.meta.url)));
  expect(chain.journal.legacy).toEqual([]);
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=ON');
    for(const migration of chain.migrations)for(const statement of migration.up){
      if(typeof statement!=='string')throw new Error('Initial schema should contain generated DDL');db.exec(statement);
    }
    const owner=ulid(),a=ulid(),b=ulid(),role=ulid();
    db.prepare('INSERT INTO users(id,email) VALUES(?,?)').run(owner,'owner@example.test');
    for(const id of [a,b])db.prepare('INSERT INTO organizations(id,name,owner_id) VALUES(?,?,?)').run(id,'Organization',owner);
    db.prepare("INSERT INTO organization_roles(id,organization_id,name,roles) VALUES(?,?,?,'{}')").run(role,a,'Role');
    expect(()=>db.prepare('INSERT INTO organization_members(id,organization_id,user_id,organization_member_role_id) VALUES(?,?,?,?)').run(ulid(),b,owner,role)).toThrow();
    db.prepare('INSERT INTO organization_members(id,organization_id,user_id,organization_member_role_id) VALUES(?,?,?,?)').run(ulid(),a,owner,role);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('SELECT created_at,updated_at FROM users WHERE id=?').get(owner)).toMatchObject({created_at:expect.any(String),updated_at:expect.any(String)});
  }finally{db.close();}
});
