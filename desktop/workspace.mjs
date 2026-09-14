import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { applicationPaths } from './storage-paths.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const kinds = ['image', 'video', 'reference', 'upscale'];
export function workspacePaths(home) {
  home = path.resolve(home);
  if ([path.parse(home).root, os.homedir()].includes(home)) throw Error('Choose a dedicated Frok workspace folder.');
  return { home, pipelines: path.join(home, 'pipelines'), data: path.join(home, 'data'), updates: path.join(home, 'pipeline-updates'), envFile: path.join(home, '.env') };
}
async function directory(file) {
  await fs.mkdir(file, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(/* turbopackIgnore: true */ file);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error(`Expected a regular workspace directory: ${file}`);
}
async function read(file) {
  // Workspace files are read at runtime. Factory templates are packaged through
  // the explicit desktop manifest, never inferred by tracing user directories.
  const stat = await fs.lstat(/* turbopackIgnore: true */ file).catch(error => { if (error.code === 'ENOENT') return; throw error; });
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Expected a regular workspace file: ${file}`);
  return fs.readFile(/* turbopackIgnore: true */ file);
}
async function write(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
function installationPaths(home, stateDirectory = applicationPaths({ ...process.env, FROK_HOME: home }).state) {
  stateDirectory = path.resolve(stateDirectory);
  return { stateDirectory, stateFile: path.join(stateDirectory, '.pipeline-state.json'), lock: path.join(stateDirectory, '.pipeline-install.lock') };
}
function parseState(saved) {
  const state = saved ? JSON.parse(saved.toString()) : { version: 1, files: {} };
  if (state.version !== 1 || !state.files || typeof state.files !== 'object' || Array.isArray(state.files)) throw Error('The pipeline installation record needs repair. No pipelines were changed.');
  return state;
}
async function migrateState(home, stateFile) {
  const legacy = path.join(home, '.pipeline-state.json');
  if (legacy === stateFile) return;
  const previous = await read(legacy);
  if (!previous) return;
  parseState(previous);
  const current = await read(stateFile);
  if (current && hash(current) !== hash(previous)) throw Error('Two different pipeline installation records exist. Both were preserved; resolve the records before updating pipelines.');
  if (!current) await write(stateFile, previous);
  await fs.rm(legacy);
}
async function removeEmptyUpdates(folder) {
  const stat = await fs.lstat(folder).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return;
  const names = await fs.readdir(folder);
  if (names.length === 1 && names[0] === '.DS_Store') await fs.unlink(path.join(folder, '.DS_Store'));
  await fs.rmdir(folder).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
}
async function installPipelines({ home, templates, groups, version, stateFile }) {
  const locations = workspacePaths(home);
  for (const name of ['home', 'pipelines']) await directory(locations[name]);
  await removeEmptyUpdates(locations.updates);
  for (const kind of kinds) await directory(path.join(/* turbopackIgnore: true */ locations.pipelines, kind));
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw Error('Invalid application version.');
  const files = groups.flat();
  if (new Set(files).size !== files.length || files.some(file => !/^(image|video|reference|upscale)\/[a-z0-9-]+\/(?:meta\.json|(?:run|prepare)\.(?:json|vpipeline))$/.test(file))) throw Error('Invalid bundled pipeline manifest.');
  const saved = await read(stateFile);
  const state = parseState(saved);
  const conflicts = [];
  for (const group of groups) {
    // Upgrade bundled flat companions together, including local edits. Custom
    // flat pipelines remain readable by the catalog until their owner moves them.
    const moves = [];
    for (const name of group) {
      const [kind, base, leaf] = name.split('/');
      await directory(path.join(locations.pipelines, kind, base));
      const legacy = `${kind}/${base}${leaf === 'meta.json' ? '.meta.json' : leaf.replace('run', '').replace('prepare', '.prepare')}`;
      const source = await read(path.join(locations.pipelines, legacy));
      if (!source) continue;
      const target = await read(path.join(locations.pipelines, name));
      if (target && hash(target) !== hash(source)) throw Error(`Both old and new pipeline files exist with different content: ${name}. Keep the preferred bundle before retrying.`);
      moves.push({ name, legacy, source, target });
    }
    for (const move of moves) {
      if (!move.target) await write(path.join(locations.pipelines, move.name), move.source);
      if (state.files[move.legacy]) state.files[move.name] = state.files[move.legacy];
      delete state.files[move.legacy];
    }
    if (moves.length) {
      await write(stateFile, JSON.stringify(state, null, 2) + '\n');
      for (const move of moves) await fs.rm(path.join(locations.pipelines, move.legacy));
    }
    const entries = await Promise.all(group.map(async name => {
      const source = await read(path.join(templates, name));
      if (!source) throw Error(`Bundled pipeline is missing: ${name}`);
      return { name, source, current: await read(path.join(locations.pipelines, name)), digest: hash(source) };
    }));
    const modified = entries.some(entry => entry.current && hash(entry.current) !== entry.digest && hash(entry.current) !== state.files[entry.name]);
    if (modified) {
      // Local edits alone need no incoming copy. Without a known baseline,
      // preserve the existing pipeline and provide the bundled files for review.
      if (entries.every(entry => entry.digest === state.files[entry.name])) continue;
      // Keep the entire run/metadata/prepare set together. Never mix versions.
      const revision = hash(entries.map(entry => entry.digest).join('')).slice(0, 12);
      const incoming = path.join(locations.updates, `${version}-${revision}`);
      await directory(locations.updates);
      await directory(incoming);
      for (const entry of entries) {
        const target = path.join(incoming, entry.name);
        await directory(path.dirname(target));
        if (!await read(target)) await write(target, entry.source);
      }
      conflicts.push(group[0]);
      continue;
    }
    const written = [];
    try {
      for (const entry of entries) {
        if (entry.current && hash(entry.current) === entry.digest) continue;
        await write(path.join(locations.pipelines, entry.name), entry.source); written.push(entry);
      }
    } catch (error) {
      for (const entry of written.reverse()) {
        const target = path.join(locations.pipelines, entry.name);
        if (entry.current) await write(target, entry.current); else await fs.rm(target, { force: true });
      }
      throw error;
    }
    for (const entry of entries) state.files[entry.name] = entry.digest;
    await write(stateFile, JSON.stringify(state, null, 2) + '\n');
  }
  for(const name of ['VPIPE-LICENSE','VPIPE-NOTICE']){
    const notice=await read(path.join(/* turbopackIgnore: true */ templates,name));
    if(notice)await write(path.join(/* turbopackIgnore: true */ locations.pipelines,name),notice);
  }
  return { ...locations, stateFile, conflicts };
}


export async function ensurePipelines(options) {
  const {home}=workspacePaths(options.home);
  await directory(home);
  const {lock,stateFile,stateDirectory}=installationPaths(home,options.stateDirectory);
  await directory(stateDirectory);
  // An older process may still use the former workspace lock.
  if(await fs.lstat(path.join(home,'.pipeline-install.lock')).catch(error=>{if(error.code!=='ENOENT')throw error;}))throw Error('A pipeline installation or reset is already in progress.');
  let handle;
  try{handle=await fs.open(/* turbopackIgnore: true */ lock,'wx',0o600);}
  catch(error){if(error.code==='EEXIST')throw Error('A pipeline installation or reset is already in progress.');throw error;}
  try{await migrateState(home,stateFile);return await installPipelines({...options,stateFile});}
  finally{await handle.close();await fs.rm(lock,{force:true});}
}

export async function ensureWorkspace({home,pipelineHome=home,...options}) {
  const locations=workspacePaths(home);
  for(const name of ['home','data'])await directory(locations[name]);
  const installed=await ensurePipelines({home:pipelineHome,...options});
  return {...locations,pipelines:installed.pipelines,updates:installed.updates,conflicts:installed.conflicts};
}

// Build a complete replacement first. Only the fixed default folder is swapped;
// an editable/custom pipeline location is never accepted by this operation.
export async function resetPipelines({home,stateDirectory:requestedStateDirectory,...options}) {
  const locations=workspacePaths(home);
  await directory(locations.home);
  const {lock,stateFile,stateDirectory}=installationPaths(home,requestedStateDirectory);
  await directory(stateDirectory);
  if(await fs.lstat(path.join(home,'.pipeline-install.lock')).catch(error=>{if(error.code!=='ENOENT')throw error;}))throw Error('A pipeline installation or reset is already in progress.');
  let handle;
  try {handle=await fs.open(/* turbopackIgnore: true */ lock,'wx',0o600);}
  catch(error){if(error.code==='EEXIST')throw Error('A pipeline installation or reset is already in progress.');throw error;}
  const staging=path.join(home,`.pipeline-reset-${randomUUID()}`),old=path.join(staging,'previous-pipelines');
  let moved=false,installed=false,previousState,preserveStaging=false;
  try {
    await migrateState(home,stateFile);
    const current=await fs.lstat(locations.pipelines).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(current&&(!current.isDirectory()||current.isSymbolicLink()))throw Error('The default pipelines folder must be a regular directory.');
    previousState=await read(stateFile);
    const replacement=await ensurePipelines({home:staging,stateDirectory:path.join(staging,'installation-state'),...options});
    if(current){await fs.rename(locations.pipelines,old);moved=true;}
    try {
      await fs.rename(replacement.pipelines,locations.pipelines);installed=true;
      await write(stateFile,await fs.readFile(replacement.stateFile));
    }catch(error){
      try {
        if(installed)await fs.rm(locations.pipelines,{recursive:true,force:true});
        if(moved)await fs.rename(old,locations.pipelines);
        if(previousState)await write(stateFile,previousState);else await fs.rm(stateFile,{force:true});
      }catch(recovery){preserveStaging=true;throw Error(`Reset could not finish. Original pipelines are retained at ${staging}. ${recovery.message}`);}
      throw error;
    }
    return locations.pipelines;
  }finally{
    if(!preserveStaging)await fs.rm(staging,{recursive:true,force:true});
    await handle.close();await fs.rm(lock,{force:true});
  }
}
