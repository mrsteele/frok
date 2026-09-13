import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { checkMediaTools } from './check-media-tools.mjs';
import { signingConfiguration } from './desktop-signing.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dir')) throw Error('Use --dir for an unpacked app, or no arguments for the native installer.');
// Refuse incomplete, stale, or nonfree media tool payloads before packaging.
await checkMediaTools();
const config=signingConfiguration(JSON.parse(await fs.readFile('electron-builder.json','utf8')));
const configFile=path.resolve('.desktop/builder-config.json');
await fs.mkdir(path.dirname(configFile),{recursive:true});
await fs.writeFile(configFile,JSON.stringify(config,null,2));
const cache = path.resolve('.data/electron-builder-cache');
await fs.mkdir(cache, { recursive: true });
// Builder's downloaded icon utility is CommonJS. Give this project-local cache
// its own scope so it does not inherit Frok's ESM package.json.
await fs.writeFile(path.join(cache, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
const child = spawn(process.execPath, ['node_modules/electron-builder/cli.js', '--config', configFile, ...args, '--publish', 'never'], { stdio: 'inherit', env: { ...process.env, ELECTRON_BUILDER_CACHE: cache, ELECTRON_CACHE: path.resolve('.data/electron-cache') } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
