import {rmSync} from 'node:fs';
import {relative, resolve} from 'node:path';

const workspace = process.cwd();
const output = resolve(workspace, 'dist');

if (relative(workspace, output) !== 'dist') {
  throw new Error(`Refusing to clean unexpected build directory: ${output}`);
}

rmSync(output, {recursive: true, force: true});
