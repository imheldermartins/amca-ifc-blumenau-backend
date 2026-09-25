import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
const env={...process.env,DATABASE_URL:'http://127.0.0.1:18012',RUN_RQLITE_INTEGRATION:'1',NODE_ENV:'test',HOST:'127.0.0.1',PORT:'3008',CORS_ORIGINS:'http://127.0.0.1:3008',SMTP_HOST:'',SMTP_FROM_EMAIL:'',JWT_ACCESS_SECRET:randomBytes(48).toString('hex'),JWT_REFRESH_SECRET:randomBytes(48).toString('hex')};
env.APP_PUBLIC_URL='http://127.0.0.1:3008';
async function run(args){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit',env});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(args.join(' ')+' exited '+code)));});}
if(!process.argv.includes('--http-only')){
  await run(['node_modules/vitest/vitest.mjs','run','src/db/repositories/scoped-access.integration.test.ts']);
  await run(['--import','tsx','src/core/scripts/sql-injection-test.ts']);
  await run(['--import','tsx','scripts/validation/workspace-flow-test.ts']);
}
const server=spawn(process.execPath,['--import','tsx','src/server.ts'],{stdio:['ignore','pipe','pipe'],env});
let output='';server.stdout.on('data',chunk=>output+=chunk);server.stderr.on('data',chunk=>output+=chunk);
try{
  for(let attempt=0;attempt<60;attempt++){
    if(server.exitCode!==null)throw new Error('Validation server exited: '+output);
    try{const response=await fetch('http://127.0.0.1:3008/api/v1/health');if(response.status<500)break;}catch{}
    if(attempt===59)throw new Error('Validation server did not start');
    await new Promise(r=>setTimeout(r,250));
  }
  await run(['--import','tsx','scripts/validation/page-resource-flow-test.ts']);
  await run(['--import','tsx','scripts/validation/access-flow-test.ts']);
}finally{
  server.kill();
  mkdirSync('artifacts/rqlite-validation',{recursive:true});
  writeFileSync('artifacts/rqlite-validation/server.log',output);
}
console.log('Cub\'s rqlite-client integration checks completed against disposable port 18012.');
