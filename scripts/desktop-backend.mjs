import fs from 'node:fs/promises';
import path from 'node:path';

export async function copyDesktopBackend(source, destination, { platform = process.platform } = {}) {
  const standalone = path.resolve(source);
  await fs.cp(standalone, destination, {
    recursive: true,
    // Windows junctions retain absolute checkout paths when electron-builder
    // copies them. Materialize their contents before creating the installer.
    // Unix package links can stay relative across both copies.
    ...(platform === 'win32' ? { dereference: true } : { verbatimSymlinks: true }),
    filter: file => {
      const relative = path.relative(standalone, file);
      // Next's traces can retain development sources. Production uses compiled
      // routes and the separately bundled worker, never these folders.
      if (['src', 'tests', 'dev', 'scripts'].includes(relative.split(path.sep)[0]) || path.basename(file) === '.DS_Store') return false;
      return !relative.split(path.sep).some(part => part.startsWith('.env') || ['.data', '.desktop', 'pipelines'].includes(part)) && !/\.(sqlite(?:-.*)?|safetensors|gguf)$/.test(file);
    },
  });
}
