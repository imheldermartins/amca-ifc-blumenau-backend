import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const env={...process.env,JWT_ACCESS_SECRET:randomBytes(48).toString('hex'),JWT_REFRESH_SECRET:randomBytes(48).toString('hex')};
function docker(...args){const r=spawnSync('docker',args,{encoding:'utf8',env});if(r.error)throw r.error;assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout.trim();}
// Only this disposable tmpfs service is reset. The regular Cub's DB is unrelated.
docker('compose','-p','cubs-rqlite-test','-f','docker/docker-compose.rqlite-test.yml','up','-d','--force-recreate','production');
const name='cubs-rqlite-backend-validation-'+process.pid;
docker('run','-d','--rm','--name',name,'--network','cubs-rqlite-test_default','-p','127.0.0.1:18018:3000',
  '-e','NODE_ENV=production','-e','HOST=0.0.0.0','-e','PORT=3000','-e','DATABASE_URL=http://production:4001',
  '-e','JWT_ACCESS_SECRET','-e','JWT_REFRESH_SECRET','-e','CORS_ORIGINS=http://127.0.0.1:18018','-e','APP_PUBLIC_URL=http://127.0.0.1:18018',
  '-e','NODE_OPTIONS=--import=/validation/rqlite-no-compiler.mjs',
  '--mount',`type=bind,source=${path.resolve('scripts/validation')},target=/validation,readonly`,'cubs-backend:rqlite-validation');
try{
  const ready=async()=>{for(let attempt=0;attempt<100;attempt++){try{if((await fetch('http://127.0.0.1:18018/health/ready')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error(docker('logs',name));};
  await ready();assert.equal((await fetch('http://127.0.0.1:18018/health/live')).status,200);
  const data=JSON.parse(docker('exec',name,'node','--input-type=module','-e',`import {RqliteClient} from '@cubs/rqlite-client';const c=new RqliteClient({url:'http://production:4001'});console.log(JSON.stringify({history:await c.query('SELECT COUNT(*) AS count FROM _migrations'),fk:await c.query('PRAGMA foreign_keys'),violations:await c.query('PRAGMA foreign_key_check')}));`));
  assert.equal(data.history[0].count,1);assert.equal(data.fk[0].foreign_keys,1);assert.deepEqual(data.violations,[]);
  docker('restart',name);await ready();
  const logs=docker('logs',name);assert.match(logs,/\[\]/);
  mkdirSync('artifacts/rqlite-validation',{recursive:true});writeFileSync('artifacts/rqlite-validation/container.log',logs);
  writeFileSync('artifacts/rqlite-validation/container.json',JSON.stringify({image:docker('image','inspect','cubs-backend:rqlite-validation','--format','{{.Id}}'),...data,checks:['fresh compiled startup','compiler and tsx imports forbidden','HTTP live and ready 200','restart migration no-op']},null,2)+'\n');
  console.log('Compiled container: 1 generated migration, FK enabled, HTTP health and idempotent restart passed without compiler/tsx.');
}finally{docker('stop',name);}
