import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createClient} from '@cubs/rqlite-client';
import {schema} from '../../src/db/generated/schema.js';
const port=process.argv[2]??'18012';
if(!['18012','18014'].includes(port))throw new Error('Disposable validation targets only');
const client=createClient({schema,connection:{url:`http://127.0.0.1:${port}`},migrations:{directory:'src/db/migrations'}});
await client.assertReady();
const details=[];
for(const table of Object.values(schema.tables)){
  assert.equal('legacySql' in table,false);
  const columns=await client.sql.query<{name:string;type:string;notnull:number;pk:number;dflt_value:unknown}>(`PRAGMA table_xinfo("${table.name}")`);
  assert.equal(columns.length,table.columns.length,table.name);
  for(const expected of table.columns){const actual=columns.find(c=>c.name===expected.name)!;
    assert(actual,table.name+'.'+expected.name);assert.equal(actual.type,expected.type);assert.equal(actual.notnull,expected.nullable?0:1);
    if(expected.managed)assert.equal(actual.dflt_value,'CURRENT_TIMESTAMP');
  }
  details.push({table:table.name,columns});
}
assert.equal(details.length,19);
assert.deepEqual(await client.sql.query('PRAGMA foreign_key_check'),[]);
assert.equal(schema.tables.page_columns_values.columns.find(c=>c.name==='data')!.codec,undefined);
assert.equal(schema.tables.page_columns_values.columns.find(c=>c.name==='data')!.type,'TEXT');
const history=await client.migrations.status();assert.equal(history.applied.length,1);assert.deepEqual(history.pending,[]);
assert.deepEqual(await client.migrations.up(),[]);
mkdirSync('artifacts/rqlite-validation',{recursive:true});writeFileSync(`artifacts/rqlite-validation/schema-${port}.json`,JSON.stringify({history,details},null,2)+'\n');
console.log(`19 tables inferred from decorators, column types/nullability/clocks, raw cell data, FK and idempotence verified on ${port}.`);
