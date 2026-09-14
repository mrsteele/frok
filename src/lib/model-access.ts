import fs from 'node:fs/promises';
import path from 'node:path';
import { expandPath } from './config';
import { settings, workdir } from './db';
import { turboAdapters } from './adapters';

// model-fetch uses <base>/<owner>/<repo>; model-quantize uses models/<key>.
// These catalogue aliases pin a particular file/subtree, not the whole repo.
// Upstream: tgo-app-dev/vpipe@0982c8a7, stages/model-catalog.cc.
const aliases: Record<string, string> = {
  [turboAdapters.reference.alias]: turboAdapters.reference.file,
  'mgwr/M87': 'mgwr/M87/m87_lora_v1.safetensors',
  'larryvrh/MiniMax-H3-Turbo-Lora-v4-600-ema': 'larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_v4_step600_ema.safetensors',
  'larryvrh/MiniMax-H3-Turbo-Lora-v1-850-ema': 'larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_4step_ema_ckpt850.safetensors',
};

export const vpipeModelsDirectory = () => path.join(workdir(), 'models');
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function validateTree(root: string, directory: string, seen = new Set<string>()) {
  if (seen.has(directory)) return;
  seen.add(directory);
  for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const resolved = await fs.realpath(/* turbopackIgnore: true */ file);
      if (!inside(root, resolved)) throw new Error('Model symlinks must stay inside the trusted model directory.');
      if ((await fs.stat(resolved)).isDirectory()) await validateTree(root, resolved, seen);
    } else if (entry.isDirectory()) await validateTree(root, file, seen);
  }
}

async function resolveReference(value: string, adapter: boolean): Promise<string> {
  // Do this before normalization: normalization would hide traversal attempts.
  if (!value || value !== value.trim() || /[\x00-\x1f\x7f\\%]/.test(value) || value.startsWith('~') || value.startsWith('//') || value.split('/').some(part => part === '.' || part === '..') || /^[a-z][a-z\d+.-]*:/i.test(value)) {
    throw new Error('Choose an installed model inside your configured model folders.');
  }
  const roots = [vpipeModelsDirectory()];
  if (adapter && settings().comfyDir) roots.push(path.join(expandPath(settings().comfyDir), 'models'));
  const reference = Object.hasOwn(aliases, value) ? aliases[value] : value;
  for (const configured of roots) {
    let root: string;
    try { root = await fs.realpath(/* turbopackIgnore: true */ configured); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const candidate = path.isAbsolute(reference) ? reference : path.join(configured, reference.replace(/^models\//, ''));
    // Absolute paths may use either the configured root or its canonical spelling.
    if (!inside(path.resolve(/* turbopackIgnore: true */ configured), path.resolve(/* turbopackIgnore: true */ candidate)) && !inside(root, path.resolve(/* turbopackIgnore: true */ candidate))) continue;
    let file: string;
    try { file = await fs.realpath(/* turbopackIgnore: true */ candidate); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!inside(root, file)) throw new Error('Model symlinks must stay inside the trusted model directory.');
    const stat = await fs.stat(file);
    if (!adapter) {
      if (!stat.isDirectory()) throw new Error('Choose an installed model directory.');
      await validateTree(root, file);
      return file;
    }
    if (stat.isDirectory()) {
      // Never hand a directory to the runner for an unconstrained recursive scan.
      const candidates = (await fs.readdir(file)).filter(name => name.endsWith('.safetensors'));
      if (candidates.length !== 1) throw new Error('Choose the exact .safetensors adapter file.');
      file = await fs.realpath(/* turbopackIgnore: true */ path.join(file, candidates[0]));
    }
    if (!inside(root, file) || !file.endsWith('.safetensors') || !(await fs.stat(file)).isFile()) throw new Error('Choose a .safetensors adapter inside a trusted model directory.');
    return file;
  }
  throw new Error('This model is not installed in a trusted model directory. Use its relative path there or an approved model name.');
}

export const resolveVpipeModel = (value: string) => resolveReference(value, false);
export const resolveModelAdapter = (value: string) => resolveReference(value, true);
