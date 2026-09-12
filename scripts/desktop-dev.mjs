import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { desktopIcons } from './desktop-icons.mjs';
import { buildDesktopDocs } from './desktop-docs.mjs';
await buildDesktopDocs();
await desktopIcons();
// Electron downloads its development binary lazily on the first launch.
// Keep that cache with the project, like the packaging caches.
process.env.electron_config_cache ||= path.resolve('.data/electron-cache');
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, FROK_NODE_BINARY: process.execPath } });
process.on('SIGINT', () => child.kill('SIGTERM'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
