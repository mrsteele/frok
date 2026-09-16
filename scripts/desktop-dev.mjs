import { createRequire } from 'node:module';
import path from 'node:path';
import { desktopIcons } from './desktop-icons.mjs';
import { buildDesktopDocs } from './desktop-docs.mjs';
import { ensureMediaTools } from './media-tools.mjs';
import { runDesktop } from './desktop-runtime.mjs';
await ensureMediaTools();
await buildDesktopDocs();
await desktopIcons();
// Electron downloads its development binary lazily on the first launch.
// Keep that cache with the project, like the packaging caches.
process.env.electron_config_cache ||= path.resolve('.data/electron-cache');
const electron = createRequire(import.meta.url)('electron');
try {
  process.exitCode = await runDesktop(electron, ['.', ...process.argv.slice(2)], {
    env: { ...process.env, FROK_NODE_BINARY: process.execPath },
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
