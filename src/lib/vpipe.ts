import { bindPipeline } from './pipelines/bindings';
import fs from "node:fs/promises";
import path from "node:path";
import { vpipeBin, jobTimeoutMs } from "./config";
import { libraryDirectory } from './library';
import { resolveModelAdapter, resolveVpipeModel, vpipeModelsDirectory } from './model-access';
import { runProcess } from "./process";
import { imagePreviewPath, imagePreviewDir, clearImagePreviews, liveImagePreviewsEnabled } from "./image-preview";
import { parseVpipeRuntime } from "./runner-time";
import type { Generation } from "./types";
export type Stage = { id:string; type:string; config:Record<string,unknown>; iports?:{src:string;oport:number}[] };
export type Pipeline = { id:string; stages:Stage[]; subpipelines?:unknown[] };
export type RenderInput = { request:Generation; prompt:string; seed:number; width:number; height:number; output:string; directory:string; source?:string; references:string[]; signal:AbortSignal; log:(line:string)=>void; onRuntime?:(seconds:number)=>void; waitForStop?:()=>boolean };
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
export async function buildPipeline(input: Omit<RenderInput,"signal"|"log">):Promise<Pipeline> {
  if(input.request.pipeline){
    const p=bindPipeline(input.request.pipeline,input) as unknown as Pipeline;
    if(input.request.mode==='image'&&liveImagePreviewsEnabled()){
      const generator=p.stages.find(s=>s.type==='generate-image'),decoder=p.stages.find(s=>s.type==='vae-decode'&&s.iports?.[0]?.src===generator?.id);
      if(generator&&decoder?.iports?.[1])p.stages.push({id:'frok-preview-decode',type:'vae-decode',config:{unload_when_idle:'auto'},iports:[{src:generator.id,oport:1},decoder.iports[1]]},{id:'frok-preview-save',type:'save-image',config:{path:imagePreviewPath(input.directory),quality:75},iports:[{src:'frok-preview-decode',oport:0}]});
    }
    return p;
  }
  throw Error('This job has no pipeline. Choose a pipeline in Settings → Generation and start a new generation.');
}
export async function renderVpipe(input:RenderInput) {
  const directory = await privateRenderDirectory(input);
  const pipeline=await buildPipeline(input);
  // Do not share the runtime LMDB. These paths target Krea's diffusers root
  // and prepared MiniMax roots with on-disk partition metadata. Custom keys
  // whose model_type/files exist only in LMDB are not interchangeable with
  // paths (notably a raw MiniMax repo containing both task partitions).
  // Upstream @0982c8a7: model-registry.cc; shared/comfy-output-config.cc;
  // minimax-h3/metal-minimax-h3-transformer.cc. LoRA aliases pin exact files.
  for (const stage of pipeline.stages) {
    for (const key of ['hf_dir', 'dit_dir']) if (typeof stage.config[key] === 'string' && stage.config[key]) stage.config[key] = await resolveVpipeModel(stage.config[key] as string);
    for (const key of ['lora', 'lora2']) if (typeof stage.config[key] === 'string' && stage.config[key]) stage.config[key] = await resolveModelAdapter(stage.config[key] as string);
  }
  const dir = await fs.mkdtemp(path.join(directory, 'vpipe-'));
  const temporary = path.join(dir, '.vpipe-tmp'), cache = path.join(dir, 'cache'), home = path.join(dir, 'home'), database = path.join(dir, 'db');
  for (const folder of [temporary, cache, home, database]) await fs.mkdir(folder, {mode: 0o700});
  await fs.symlink(await fs.realpath(vpipeModelsDirectory()), path.join(dir, 'models'), 'dir');
  // Upstream common/session.cc and common/temp-root.cc: db.path defaults to
  // cwd, scratch to cwd/.vpipe-tmp. Explicit settings prevent inherited paths.
  const config = path.join(dir, 'session.json');
  await fs.writeFile(config, JSON.stringify({db: {path: database}, log: {delegate: 'stdout'}}), {mode: 0o600});
  const env: NodeJS.ProcessEnv = {...process.env, HOME: home, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: home, HF_HOME: path.join(cache, 'huggingface'), TMPDIR: temporary, TMP: temporary, TEMP: temporary, VPIPE_TMPDIR: temporary};
  for (const key of ['VPIPE_CONFIG', 'VPIPE_CONFIG_FILE', 'VPIPE_PLUGINS', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN']) delete env[key];
  const file=path.join(directory,"pipeline.vpipeline");
  await fs.writeFile(file,JSON.stringify(pipeline,null,2), {mode: 0o600});
  const preview = pipeline.stages.some(stage => stage.id === 'frok-preview-save');
  if (preview) { await clearImagePreviews(input.directory); await fs.mkdir(imagePreviewDir(input.directory), { recursive: true }); }
  let logTail="";
  try {
    await runProcess(vpipeBin(),["--config",config,"--launch",file],{cwd:dir,env,signal:input.signal,onLog:chunk=>{logTail=(logTail+chunk).slice(-16000);input.log(chunk);},timeout:jobTimeoutMs()});
    const stat=await fs.stat(input.output).catch(()=>null);
    if(!stat?.size)throw new Error("Vpipe finished without saving media. Check this job's log and the administrator-configured model installation.");
  } finally {
    // Parse once after exit so chunk boundaries and a missing final newline cannot truncate the duration.
    const seconds=parseVpipeRuntime(logTail,pipeline.id);
    if(seconds!==undefined)input.onRuntime?.(seconds);
    if (preview) await clearImagePreviews(input.directory).catch(() => input.log('Could not remove temporary live previews. They remain in this job’s local workspace.\n'));
  }
}
