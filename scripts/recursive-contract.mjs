import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../src/services/pages/recursive-template.ts', import.meta.url);
const target = new URL('../../cubs-frontend/src/shared/recursive-template.ts', import.meta.url);
const mode = process.argv[2];
if (!['check', 'sync'].includes(mode)) throw new Error('Use recursive-contract.mjs check|sync');
const canonical = await readFile(source, 'utf8');
if (mode === 'sync') await writeFile(target, canonical);
else if (canonical.replaceAll('\r\n', '\n') !== (await readFile(target, 'utf8')).replaceAll('\r\n', '\n')) throw new Error('Contrato Recursive divergente');
console.log(`Recursive ${mode}.`);
