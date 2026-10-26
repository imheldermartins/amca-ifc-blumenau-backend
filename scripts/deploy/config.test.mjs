import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {prepareCredentials} from './config.mjs';
const dirs=[];
const fixture=source=>{const dir=mkdtempSync(join(tmpdir(),'cubs-deploy-config-'));dirs.push(dir);writeFileSync(join(dir,'rqlite.prod.env'),source);return dir;};
after(()=>{for(const dir of dirs)rmSync(dir,{recursive:true,force:true});});
test('bootstrap generates two independent credentials, preserves settings and remains idempotent',()=>{
  const dir=fixture('# keep comments\nNODE_ID=1\nRQLITE_PASSWORD=\n');
  prepareCredentials(dir,true);
  const env=readFileSync(join(dir,'rqlite.prod.env'),'utf8'), entries=JSON.parse(readFileSync(join(dir,'.generated/rqlite-auth.json'),'utf8'));
  assert.match(env,/# keep comments/); assert.match(env,/NODE_ID=1/);
  assert.deepEqual(entries.map(x=>[x.username,x.perms]),[['cubs_user',['query','execute','status','ready']],['cubs_reader',['query','status','ready']]]);
  assert.match(entries[0].password,/^[a-f0-9]{64}$/); assert.notEqual(entries[0].password,entries[1].password);
  const parsed=parseEnv(env); assert.equal(parsed.RQLITE_PASSWORD,entries[0].password);
  assert.equal(readFileSync(join(dir,'.generated/rqlite-health.curl'),'utf8'),`user = "cubs_reader:${entries[1].password}"\n`);
  prepareCredentials(dir); assert.equal(readFileSync(join(dir,'rqlite.prod.env'),'utf8'),env);
  prepareCredentials(dir,true); assert.equal(readFileSync(join(dir,'rqlite.prod.env'),'utf8'),env);
});
test('requires explicit bootstrap and refuses duplicated keys, malformed or identical passwords before changing files',()=>{
  for(const source of ['', 'NODE_ID=1\nNODE_ID=2\n', 'RQLITE_PASSWORD=$(touch unsafe)\n',`RQLITE_PASSWORD=${'a'.repeat(64)}\nRQLITE_READER_PASSWORD=${'a'.repeat(64)}\n`]) {
    const dir=fixture(source); assert.throws(()=>prepareCredentials(dir,Boolean(source)));
    assert.equal(readFileSync(join(dir,'rqlite.prod.env'),'utf8'),source);
  }
});
