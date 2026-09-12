import fs from 'node:fs/promises';
import path from 'node:path';
import { adapterProfile, primaryAdapter, type AdapterProfile, type InstalledAdapter } from './adapters';
import { resolveModelAdapter, vpipeModelsDirectory } from './model-access';
import { tensorFile } from './model-tensors';
import type { Adapters } from './types';

async function isLora(file: string) {
  const { tensors } = await tensorFile(file);
  return Object.keys(tensors).some(key => {
    const paired = key.replace(/lora_A(?=\.|$)/, 'lora_B').replace(/lora_down(?=\.|$)/, 'lora_up');
    return paired !== key && tensors[paired] && tensors[key].shape.length >= 2 && tensors[paired].shape.length >= 2;
  });
}

/** Enumerate the shared model directory, never user uploads or generated media. */
export async function installedAdapters() {
  const found = await fs.realpath(/* turbopackIgnore: true */ vpipeModelsDirectory()).catch(() => undefined);
  const adapters: InstalledAdapter[] = [];
  if (!found) return { adapters, truncated: false };
  const root: string = found;
  let visited = 0, truncated = false;
  const deadline = Date.now() + 8000;
  async function visit(directory: string, depth: number) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (++visited > 5000 || Date.now() > deadline) { truncated = true; return; }
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < 8) await visit(file, depth + 1); else truncated = true;
      } else if (entry.isFile() && entry.name.endsWith('.safetensors')) {
        // Resolve again before opening, so even a replaced directory cannot escape the model root.
        const value = path.relative(root, file).split(path.sep).join('/');
        try {
          const resolved = await resolveModelAdapter(file);
          if (await isLora(resolved)) adapters.push({ value, label: value.replace(/\.safetensors$/, ''), profile: adapterProfile(value) });
        } catch { /* Incomplete downloads and non-LoRA tensors are not choices. */ }
      }
    }
  }
  await visit(root, 0);
  return { adapters: adapters.sort((a,b) => a.label.localeCompare(b.label)), truncated };
}

export async function validateInstalledAdapters(profile: AdapterProfile, adapters: Adapters, includeDefault = false) {
  const values = [includeDefault ? primaryAdapter(profile, adapters) : adapters.primary, adapters.secondary];
  for (const value of values) if (value) {
    const file = await resolveModelAdapter(value);
    const relative = path.relative(await fs.realpath(/* turbopackIgnore: true */ vpipeModelsDirectory()), file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Choose a LoRA from the configured Vpipe models directory.');
    const compatible = adapterProfile(relative);
    if (compatible && compatible !== profile) throw Error(`This LoRA is for ${compatible === 'reference' ? 'reference' : 'text/image'} videos. Choose a matching MiniMax H3 LoRA.`);
    if (!await isLora(file)) throw Error('Choose a complete LoRA .safetensors file, not a base model tensor.');
  }
}

export async function referenceAdaptersReady(adapters: Adapters) {
  try { await validateInstalledAdapters('reference', adapters, true); return true; } catch { return false; }
}
