/** Run inside the new backend image; never prints credentials or server bodies. */
import {readFileSync} from 'node:fs';
const mode=process.argv[2]??'auth';
const url=process.env.DATABASE_URL;
if (!url) throw new Error('Missing database URL');
const users=JSON.parse(readFileSync('/run/secrets/rqlite_auth','utf8'));
const headers=user=>({Authorization:`Basic ${Buffer.from(`${user.username}:${user.password}`).toString('base64')}`,'Content-Type':'application/json'});
async function request(path,user,body) {
  return fetch(new URL(path,url),{redirect:'error',headers:user?headers(user):undefined,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
}
const anonymous=await request('/readyz');
if(mode==='bootstrap') {
  if(!anonymous.ok)throw new Error('Bootstrap requires an existing unauthenticated node; do not use it for credential rotation');
  console.log('Existing private node confirmed for initial authentication bootstrap');
} else {
  if(anonymous.status!==401)throw new Error('Anonymous readiness must be denied');
  for(const user of users) {
    for(const endpoint of ['/readyz','/status'])if(!(await request(endpoint,user)).ok)throw new Error('Authenticated health check failed');
    const result=await request('/db/query?level=strong',user,[['SELECT 1 AS value']]);
    const data=await result.json();
    if(!result.ok||data.error||data.results?.some(r=>r.error))throw new Error('Authenticated query failed');
  }
  // Harmless even if a misconfiguration accidentally grants execute: no rows match.
  const denied=await request('/db/execute',users[1],[['UPDATE users SET updated_at=updated_at WHERE 0']]);
  if(![401,403].includes(denied.status))throw new Error('Read-only user was not rejected by the write endpoint');
  const bad=await request('/readyz',{username:users[0].username,password:'invalid'});
  if(bad.status!==401)throw new Error('Incorrect credentials were accepted');
  console.log('Authentication verified: writer/reader queries and health; anonymous, invalid password and reader writes denied');
}
