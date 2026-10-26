import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareCredentials} from '../deploy/config.mjs';

const root=resolve('.'), fixture=resolve('docker/.generated/rqlite-validation');
mkdirSync(fixture,{recursive:true});
writeFileSync(resolve(fixture,'rqlite.prod.env'),'NODE_ID=auth-validation\n');
prepareCredentials(fixture,true);
const users=JSON.parse(readFileSync(resolve(fixture,'.generated/rqlite-auth.json'),'utf8'));
const linuxRoot=process.platform==='win32'?root.replace(/^([A-Za-z]):/,(_,drive)=>`/mnt/${drive.toLowerCase()}`).replaceAll('\\','/'):root;
function docker(...args) {
  const invocation=process.platform==='win32'?['wsl',['-d','Ubuntu','--cd',linuxRoot,'--','docker',...args]]:['docker',args];
  const result=spawnSync(invocation[0],invocation[1],{encoding:'utf8',env:process.env});
  if(result.error)throw result.error;
  return result;
}
function compose(...args){const r=docker('compose','-p','cubs-auth-validation','-f','docker/docker-compose.auth-test.yml',...args);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
const origin='http://127.0.0.1:18020';
const request=(path,user,body)=>fetch(origin+path,{redirect:'error',headers:{'Content-Type':'application/json',...(user?{Authorization:`Basic ${Buffer.from(`${user.username}:${user.password}`).toString('base64')}`}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
async function ready(){for(let i=0;i<80;i++){try{if((await request('/readyz',users[1])).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Authenticated validation node did not become ready');}
try {
  compose('up','-d','--build','--force-recreate');
  await ready();
  const result=await request('/db/execute?transaction',users[0],[['CREATE TABLE IF NOT EXISTS auth_fixture(id INTEGER PRIMARY KEY,value TEXT)'],["INSERT OR REPLACE INTO auth_fixture VALUES(1,'preserved')"]]);
  assert(result.ok); assert(!(await result.json()).results.some(r=>r.error));
  for(const path of ['/readyz','/status']){
    assert.equal((await request(path)).status,401);
    assert.equal((await request(path,{username:'cubs_reader',password:'wrong'})).status,401);
    assert((await request(path,users[1])).ok);
  }
  const denied=await request('/db/execute',users[1],[["UPDATE auth_fixture SET value='denied' WHERE id=1"]]);
  assert.equal(denied.status,401);
  compose('restart','rqlite');await ready();
  const query=await request('/db/query?level=strong',users[1],[['SELECT value FROM auth_fixture WHERE id=1']]);
  assert.deepEqual((await query.json()).results[0].values,[['preserved']]);
  assert.equal(docker('run','--rm','--network','none','-e','RQLITE_AUTH_FILE=/missing','cubs-rqlite-auth-validation').status,1);
  const report={authenticatedHealth:true,anonymousDenied:true,invalidPasswordDenied:true,readerWritesDenied:true,restartPreservedData:true,missingAuthFailsClosed:true,productionUntouched:true};
  writeFileSync(resolve(fixture,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {compose('stop');}
