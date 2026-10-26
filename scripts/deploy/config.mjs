import {randomBytes} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';

const users = [
  {name:'cubs_user', key:'RQLITE_PASSWORD', usernameKey:'RQLITE_USERNAME', perms:['query','execute','status','ready']},
  {name:'cubs_reader', key:'RQLITE_READER_PASSWORD', usernameKey:'RQLITE_READER_USERNAME', perms:['query','status','ready']},
];
function atomicWrite(file, content, stagingDirectory = dirname(file)) {
  if (existsSync(file) && readFileSync(file,'utf8') === content) {chmodSync(file,0o600); return;}
  const temp = join(stagingDirectory,`${basename(file)}.${process.pid}.tmp`);
  writeFileSync(temp,content,{mode:0o600,flag:'wx'});
  renameSync(temp,file); chmodSync(file,0o600);
}
export function prepareCredentials(directory, bootstrap = false) {
  const file=join(directory,'rqlite.prod.env');
  if (!existsSync(file)) throw new Error('Missing docker/rqlite.prod.env; copy its example first');
  let source=readFileSync(file,'utf8');
  // Duplicate keys make edits and Docker interpolation ambiguous; refuse them.
  const keys=[...source.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(match=>match[1]);
  if (new Set(keys).size!==keys.length) throw new Error('Duplicate keys in rqlite.prod.env');
  const env=parseEnv(source), credentials=[];
  for (const user of users) {
    if (env[user.usernameKey] && env[user.usernameKey]!==user.name) throw new Error(`Expected ${user.usernameKey}=${user.name}`);
    if (!env[user.key]) {
      if (!bootstrap) throw new Error(`Missing ${user.key}; initial provisioning requires --bootstrap-auth`);
      env[user.key]=randomBytes(32).toString('hex');
    }
    // Hex makes the same value safe in dotenv, Compose interpolation, JSON and curl config.
    if (!/^[a-f0-9]{64}$/.test(env[user.key])) throw new Error(`${user.key} must contain 64 lowercase hexadecimal characters`);
    env[user.usernameKey]=user.name;
    credentials.push({username:user.name,password:env[user.key],perms:user.perms});
  }
  if (credentials[0].password===credentials[1].password) throw new Error('Use distinct passwords for the two accounts');
  for (const user of users) for (const key of [user.usernameKey,user.key]) {
    const line=new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`,'m');
    if (line.test(source)) source=source.replace(line,`${key}=${env[key]}`);
    else source=source.trimEnd()+`\n${key}=${env[key]}\n`;
  }
  const generated=join(directory,'.generated'); mkdirSync(generated,{recursive:true,mode:0o700});
  atomicWrite(file,source.endsWith('\n')?source:source+'\n',generated);
  atomicWrite(join(generated,'rqlite-auth.json'),JSON.stringify(credentials,null,2)+'\n');
  atomicWrite(join(generated,'rqlite-health.curl'),`user = "${credentials[1].username}:${credentials[1].password}"\n`);
  return {users:credentials.map(({username,perms})=>({username,perms})), generated};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=prepareCredentials(resolve(process.argv[2]??'docker'),process.argv.includes('--bootstrap-auth'));
    console.log(`Credentials ready for ${result.users.map(user=>user.username).join(', ')}; passwords were not printed.`);
  } catch { console.error('Credential preparation failed: check the env keys, distinct 64-character hex passwords and --bootstrap-auth for initial generation.'); process.exitCode=1; }
}
