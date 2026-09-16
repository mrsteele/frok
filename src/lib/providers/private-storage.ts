import fs from "node:fs/promises";
import path from "node:path";
import { libraryDirectory } from "../library";
import type { RenderInput } from "./types";
const inside = (base: string, file: string) => { const relative = path.relative(base, file); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
export async function privateJobDirectory(value: string) {
  const user = await fs.realpath(libraryDirectory()), directory = await fs.realpath(value);
  if (!inside(path.join(user, 'jobs'), directory)) throw new Error('Runner directory must belong to the local library.');
  return directory;
}
/** Both runners accept only library inputs and a pre-created private job directory. */
export async function privateRenderDirectory(input: RenderInput) {
  input.signal.throwIfAborted();
  const user = await fs.realpath(libraryDirectory()), directory = await privateJobDirectory(input.directory);
  if (await fs.realpath(path.dirname(input.output)) !== directory) throw new Error('Runner output must stay in its job directory.');
  const output = await fs.lstat(input.output).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
  if (output && !output.isFile()) throw new Error('Invalid runner output file.');
  for (const source of [input.source, ...input.references]) if (source) {
    const file = await fs.realpath(source);
    if (!inside(path.join(user, 'media'), file) && !inside(path.join(user, 'jobs'), file)) throw new Error('Runner input must belong to the local library.');
  }
  return directory;
}
