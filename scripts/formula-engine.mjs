import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=resolve(root,'src/services/formulas/engine');
const target=resolve(process.env.CUBS_FRONTEND_ROOT?.trim()||resolve(root,'../cubs-frontend'),'src/shared/formula-engine');
const mode=process.argv[2];
if(!['sync','check'].includes(mode))throw new Error('Uso: formula-engine.mjs <sync|check>');
await mkdir(target,{recursive:true});
for(const name of (await readdir(source)).filter(name=>!name.includes('.test.') && /\.(ts|js)$/.test(name))){
  const content=await readFile(resolve(source,name),'utf8');
  if(mode==='sync')await writeFile(resolve(target,name),content);
  else if(content.replaceAll('\r\n','\n')!==(await readFile(resolve(target,name),'utf8')).replaceAll('\r\n','\n'))throw new Error(`Motor divergente: ${name}`);
}
console.log(`Formula engine ${mode}.`);
