import { legacyDefaults } from './preferences';
import { bindPipeline } from './pipelines/bindings';
import { resolveComfyDevices } from './pipelines/comfy-devices';
import fs from "node:fs/promises";
import { accessSync, constants, statSync } from 'node:fs';
import path from "node:path";
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from "node:timers/promises";
import { jobTimeoutMs, comfyServiceUrl } from "./config";
import { settings, comfyDirectory } from "./db";
import { isLocalService } from './runner-locations';
import { frameCount } from "./validation";
import { privateJobDirectory, privateRenderDirectory, type RenderInput } from './vpipe';
import { libraryDirectory } from './library';
import { zImageFiles } from './image-model-files';
export type Graph=Record<string,{class_type:string;inputs:Record<string,unknown>}>;
const node=(class_type:string,inputs:Record<string,unknown>)=>({class_type,inputs});
export const comfyModels={
  get image() { return legacyDefaults().COMFY_IMAGE_MODEL || "sd_xl_turbo_1.0_fp16.safetensors"; },
  get video() { return legacyDefaults().COMFY_VIDEO_MODEL || "minimax_h3_fl2va_pruned_int8_convrot.safetensors"; },
  get reference() { return legacyDefaults().COMFY_REFERENCE_MODEL || "minimax_h3_ref2va_pruned_int8_convrot.safetensors"; },
  get encoder() { return legacyDefaults().COMFY_TEXT_ENCODER || "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"; },
  videoVae:"minimax_h3_video_vae_fp16.safetensors",audioVae:"minimax_h3_audio_vae_fp32.safetensors",
};
class ComfyHttpError extends Error {
  constructor(readonly status: number) { super(`ComfyUI request failed (HTTP ${status}).`); }
}
function comfyClient(endpoint = settings().comfyUrl) {
  const url = new URL(comfyServiceUrl(endpoint));
  const key = process.env.COMFYUI_API_KEY;
  return {endpoint: url.origin, fetch: async (route: string, init: RequestInit = {}) => {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Invalid ComfyUI route.');
    const headers = new Headers(init.headers);
    if (key) headers.set('Authorization', `Bearer ${key}`);
    const response = await fetch(`${url.origin}${route}`, {...init, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(15_000)])});
    // Upstream error bodies may contain filesystem paths or workflow contents.
    if (!response.ok) { await response.body?.cancel(); throw new ComfyHttpError(response.status); }
    return response;
  }};
}
export async function comfyFetch(route:string,init:RequestInit={}) { assertComfyPrivateBackend(); return comfyClient().fetch(route, init); }
export function buildComfyGraph(input:Omit<RenderInput,"signal"|"log">,source?:string,references:string[]=[],prefix = `frok/${randomUUID()}/render`):Graph {
  if(input.request.pipeline)return bindPipeline(input.request.pipeline,input,prefix,source,references) as Graph;
  if(input.request.mode==='upscale')throw Error('Choose an upscaling workflow in Settings → Generation.');
  const {request:r,prompt,width,height,seed}=input;
  if(r.mode==='image' && r.imageModel==='krea-2-turbo')throw new Error('Krea 2 Turbo requires Vpipe.');
  if(r.mode==='image' && r.imageModel==='z-image-turbo')return {
    // Official Comfy-Org Z-Image-Turbo template: eight steps, CFG 1,
    // AuraFlow shift 3, Qwen3 conditioning and the 16-channel SD3 latent.
    '1':node('UNETLoader',{unet_name:zImageFiles[0].name,weight_dtype:'default'}),
    '2':node('CLIPLoader',{clip_name:zImageFiles[1].name,type:'lumina2',device:'default'}),
    '3':node('VAELoader',{vae_name:zImageFiles[2].name}),
    '4':node('CLIPTextEncode',{text:prompt,clip:['2',0]}),
    '5':node('ConditioningZeroOut',{conditioning:['4',0]}),
    '6':node('EmptySD3LatentImage',{width,height,batch_size:1}),
    '7':node('ModelSamplingAuraFlow',{model:['1',0],shift:3}),
    '8':node('KSampler',{model:['7',0],positive:['4',0],negative:['5',0],latent_image:['6',0],seed,steps:8,cfg:1,sampler_name:'res_multistep',scheduler:'simple',denoise:1}),
    '9':node('VAEDecode',{samples:['8',0],vae:['3',0]}),
    '10':node('SaveImage',{images:['9',0],filename_prefix:prefix}),
  };
  if(r.mode==="image")return {
    "1":node("CheckpointLoaderSimple",{ckpt_name:comfyModels.image}),
    "2":node("CLIPTextEncode",{text:prompt,clip:["1",1]}),
    "3":node("CLIPTextEncode",{text:"",clip:["1",1]}),
    "4":node("EmptyLatentImage",{width,height,batch_size:1}),
    "5":node("KSampler",{model:["1",0],positive:["2",0],negative:["3",0],latent_image:["4",0],seed,steps:4,cfg:1,sampler_name:"euler_ancestral",scheduler:"normal",denoise:1}),
    "6":node("VAEDecode",{samples:["5",0],vae:["1",2]}),
    "7":node("SaveImage",{images:["6",0],filename_prefix:prefix}),
  };
  const ref=r.mode==="reference";
  const g:Graph={
    "1":node("UNETLoader",{unet_name:ref?comfyModels.reference:comfyModels.video,weight_dtype:"default"}),
    "2":node("CLIPLoader",{clip_name:comfyModels.encoder,type:"minimax",device:"default"}),
    "3":node("VAELoader",{vae_name:comfyModels.videoVae}),
    "4":node("VAELoader",{vae_name:comfyModels.audioVae}),
    "5":node(ref?"MiniMaxH3ReferenceToVideo":"MiniMaxH3ImageToVideo",{clip:["2",0],vae:["3",0],prompt,width,height,length:frameCount(r.duration),...(ref?{audio_vae:["4",0],ref_image_size:"match"}:{})}),
    "6":node("RandomNoise",{noise_seed:seed}),
    "7":node("BasicGuider",{model:["1",0],conditioning:["5",0]}),
    "8":node("KSamplerSelect",{sampler_name:"res_multistep"}),
    "9":node("BasicScheduler",{model:["1",0],scheduler:"simple",steps:r.quality==="preview"?8:16,denoise:1}),
    "10":node("SamplerCustomAdvanced",{noise:["6",0],guider:["7",0],sampler:["8",0],sigmas:["9",0],latent_image:["5",1]}),
    "11":node("VAEDecode",{samples:["10",0],vae:["3",0]}),
    "12":node("VAEDecodeAudio",{samples:["10",0],vae:["4",0]}),
    "13":node("CreateVideo",{images:["11",0],audio:["12",0],fps:24}),
    "14":node("SaveVideo",{video:["13",0],filename_prefix:prefix,format:"mp4",codec:"h264"}),
  };
  if(source){g["20"]=node("LoadImage",{image:source});g["5"].inputs.first_frame=["20",0];}
  references.forEach((file,i)=>{const id=String(30+i);g[id]=node("LoadImage",{image:file});g["5"].inputs[`ref_images.ref_image_${i}`]=[id,0];});
  return g;
}
type Area = 'input' | 'output' | 'temp';
type ComfyFile = {filename: string; subfolder: string; type: Area};
type Receipt = {
  version: 1; owner: string; namespace: string; endpoint: string; clientId: string; promptId: string;
  submission: 'none' | 'pending' | 'accepted' | 'terminal'; uncertainUpload: boolean;
  roots: Partial<Record<Area, string>>; areas: Area[];
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const post = (value: unknown): RequestInit => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});
const terminal = (h: {status?: {completed?: boolean; status_str?: string}} | undefined) => h?.status?.completed === true || h?.status?.status_str === 'error';
export function comfyIsolationIssue(): string | undefined {
  if (!isLocalService(settings().comfyUrl) && process.env.FROK_COMFYUI_PRIVATE !== '1') return 'Connect to ComfyUI on this computer. Remote services require a protected backend configuration.';
  for (const area of ['input', 'output'] as const) {
    const directory = comfyDirectory(area);
    if (!directory || directory !== directory.trim() || !path.isAbsolute(directory)) return `Choose the ComfyUI folder containing its ${area} directory in Settings → Services.`;
    try {
      if (!statSync(/* turbopackIgnore: true */ directory).isDirectory()) throw new Error('Not a directory.');
      accessSync(/* turbopackIgnore: true */ directory, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch { return `ComfyUI’s ${area} folder is missing or not writable. Start ComfyUI, then check its folder in Settings → Services.`; }
  }
}
export function assertComfyPrivateBackend() {
  // The desktop studio uses a local service. Legacy remote services still
  // require isolation; all renders retain scoped paths and mapping checks.
  const issue = comfyIsolationIssue();
  if (issue) throw new Error(issue);
}
async function cleanupRoots(): Promise<Receipt['roots']> {
  const roots: Receipt['roots'] = {};
  for (const area of ['input', 'output', 'temp'] as const) {
    const configured = comfyDirectory(area);
    // The mapping check below proves these are the service's actual roots.
    if (configured) {
      if (!path.isAbsolute(configured) || !(await fs.stat(/* turbopackIgnore: true */ configured)).isDirectory()) throw new Error('Invalid ComfyUI cleanup directory.');
      await fs.access(/* turbopackIgnore: true */ configured, constants.R_OK | constants.W_OK | constants.X_OK);
      roots[area] = await fs.realpath(/* turbopackIgnore: true */ configured);
    }
  }
  return roots;
}
async function verifyCleanupMappings(client: ReturnType<typeof comfyClient>, roots: Receipt['roots'], namespace: string, signal: AbortSignal) {
  // /view serves files from the actual input/output roots. Prove that the
  // configured mounts are those roots BEFORE uploading assets/submitting a
  // prompt. Markers are random bytes, never model inputs, and never queued.
  for (const area of ['input', 'output'] as const) {
    const root = roots[area];
    if (!root) throw new Error(`Choose the ComfyUI folder containing its ${area} directory.`);
    const subfolder = `${namespace}/mapping-${randomUUID()}`, filename = 'mapping.txt', marker = randomUUID();
    let directory = root;
    try {
      for (const part of subfolder.split('/')) {
        directory = path.join(directory, part);
        await fs.mkdir(directory, {mode: 0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
        if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Unsafe ComfyUI mapping path.');
      }
      await fs.writeFile(path.join(directory, filename), marker, {flag: 'wx', mode: 0o600});
      const response = await client.fetch(`/view?${new URLSearchParams({filename, subfolder, type: area})}`, {signal});
      if (await response.text() !== marker) throw new Error('ComfyUI mapping mismatch.');
    } catch {
      signal.throwIfAborted();
      throw new Error(`The selected ComfyUI folder does not match the service’s ${area} directory. Choose its base folder in Settings → Services. No prompt or asset was sent.`);
    } finally { await removeNamespace(root, subfolder); }
  }
}
export async function checkComfyFolders(signal:AbortSignal) {
  assertComfyPrivateBackend();
  const roots=await cleanupRoots(),namespace=`frok/connection-check/${randomUUID()}`;
  try { await verifyCleanupMappings(comfyClient(),roots,namespace,signal); }
  finally { for(const area of ['input','output'] as const)if(roots[area])await removeNamespace(roots[area]!,namespace); }
}
async function writeReceipt(file: string, record: Receipt) {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(record), {mode: 0o600});
  await fs.rename(`${file}.tmp`, file);
}
function ownFile(value: unknown, namespace: string, area: Area): ComfyFile {
  const file = value as Partial<ComfyFile> | null;
  if (!file || typeof file.filename !== 'string' || !file.filename || /[\x00-\x1f\x7f/\\]/.test(file.filename) || file.filename === '.' || file.filename === '..' || file.subfolder !== namespace || (file.type ?? area) !== area) throw new Error('ComfyUI returned a file outside this job’s namespace.');
  return {filename: file.filename, subfolder: namespace, type: area};
}
async function removeNamespace(root: string, namespace: string) {
  // Reject symlinked ancestors; recursive rm does not follow symlinks inside
  // the final directory. Never remove a runner root or another job's prefix.
  let directory = await fs.realpath(root);
  for (const part of namespace.split('/')) {
    directory = path.join(directory, part);
    const stat = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
    if (!stat) return;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe ComfyUI cleanup path.');
  }
  await fs.rm(directory, {recursive: true, force: true});
}
async function cleanReceipt(record: Receipt, client: ReturnType<typeof comfyClient>, roots: Receipt['roots']) {
  if (record.endpoint !== client.endpoint || record.uncertainUpload) return false;
  if (record.submission === 'pending') {
    // A lost POST response may leave a running job. New ComfyUI versions accept
    // our pre-recorded prompt_id; older versions can remain unresolvable here.
    const h = await (await client.fetch(`/history/${record.promptId}`)).json();
    if (!terminal(h[record.promptId])) return false;
    record.submission = 'terminal';
  }
  if (record.submission === 'accepted') {
    await client.fetch('/queue', post({delete: [record.promptId]}));
    const queue = await (await client.fetch('/queue')).json();
    if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) return false;
    const contains = (rows: unknown[][]) => rows.some(row => row[1] === record.promptId);
    if (contains(queue.queue_running)) {
      // Older /interrupt handlers ignore prompt_id and interrupt globally.
      // Only use the explicitly job-scoped API; an unsupported route leaves a
      // pending receipt instead of risking somebody else's generation.
      try { await client.fetch(`/api/jobs/${record.promptId}/cancel`, post({})); }
      catch (error) { if (!(error instanceof ComfyHttpError) || ![404, 405].includes(error.status)) throw error; }
      return false; // cancellation is a request, not acknowledgement of exit
    }
    if (contains(queue.queue_pending)) return false;
    record.submission = 'terminal';
  }
  let complete = true;
  for (const area of record.areas) {
    const root = roots[area];
    if (!root || (record.roots[area] && root !== record.roots[area])) { complete = false; continue; }
    record.roots[area] ??= root;
    await removeNamespace(root, record.namespace);
  }
  if (record.submission === 'terminal') await client.fetch('/history', post({delete: [record.promptId]}));
  return complete;
}

/** Main's delete-all must call this for each job item directory BEFORE deleting
 * receipts, and retain/retry the directory while pending > 0. No global clear. */
export async function cleanupComfyJob(value: string): Promise<{pending: number}> {
  const directory = await privateJobDirectory(value);
  const names = (await fs.readdir(directory)).filter(name => /^comfy-cleanup-[a-f0-9-]{36}\.json$/.test(name));
  if (!names.length) return {pending: 0};
  if (comfyIsolationIssue()) return {pending: names.length};
  let client: ReturnType<typeof comfyClient>, roots: Receipt['roots'];
  try { client = comfyClient(); roots = await cleanupRoots(); }
  catch { return {pending: names.length}; }
  const job = path.relative(await fs.realpath(path.join(libraryDirectory(), 'jobs')), directory).split(path.sep)[0];
  let pending = 0;
  for (const name of names) {
    const match = /^comfy-cleanup-([a-f0-9-]{36})\.json$/.exec(name);
    if (!match) continue;
    const file = path.join(directory, name);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 32_000) throw new Error('Invalid cleanup receipt.');
      const record: Receipt = JSON.parse(await fs.readFile(file, 'utf8'));
      // Old receipts retain their namespace so external copies can still be
      // removed after migrating into the local library.
      const owner=record.owner;
      if(owner!=='local'&&!uuid.test(owner))throw Error('Invalid cleanup namespace.');
      if (record.version !== 1 || record.owner !== owner || !uuid.test(job) || !uuid.test(match[1]) || !uuid.test(record.promptId) || record.namespace !== `frok/${owner}/${job}/${match[1]}` || !['none', 'pending', 'accepted', 'terminal'].includes(record.submission) || typeof record.uncertainUpload !== 'boolean' || !Array.isArray(record.areas) || record.areas.some(area => !['input', 'output', 'temp'].includes(area))) throw new Error('Invalid cleanup receipt.');
      if (await cleanReceipt(record, client, roots)) await fs.unlink(file);
      else { await writeReceipt(file, record); pending++; }
    } catch { pending++; }
  }
  return {pending};
}

export async function renderComfy(input:RenderInput) {
  assertComfyPrivateBackend();
  const directory = await privateRenderDirectory(input), owner = 'local';
  const job = path.relative(await fs.realpath(path.join(libraryDirectory(), 'jobs')), directory).split(path.sep)[0];
  if (!uuid.test(job)) throw new Error('ComfyUI requires a private job ID.');
  const attempt = randomUUID(), namespace = `frok/${owner}/${job}/${attempt}`;
  const client = comfyClient(); // endpoint and credentials stay fixed for this run
  const record: Receipt = {version: 1, owner, namespace, endpoint: client.endpoint, clientId: `frok-${owner}-${job}-${attempt}`, promptId: randomUUID(), submission: 'none', uncertainUpload: false, roots: await cleanupRoots(), areas: []};
  const receipt = path.join(directory, `comfy-cleanup-${attempt}.json`);
  await verifyCleanupMappings(client, record.roots, namespace, input.signal);
  await writeReceipt(receipt, record);
  async function upload(file: string) {
    const bytes = await fs.readFile(file);
    record.areas = [...new Set([...record.areas, 'input' as const])];
    record.uncertainUpload = true; await writeReceipt(receipt, record);
    const name = `${randomUUID()}${path.extname(file).toLowerCase()}`;
    const form = new FormData();
    form.set('image', new Blob([bytes]), name);
    form.set('subfolder', namespace); form.set('type', 'input'); form.set('overwrite', 'false');
    const result = await (await client.fetch('/upload/image', {method: 'POST', body: form, signal: input.signal})).json();
    const uploaded = ownFile({filename: result.name, subfolder: result.subfolder, type: result.type}, namespace, 'input');
    record.uncertainUpload = false; await writeReceipt(receipt, record);
    return `${uploaded.subfolder}/${uploaded.filename}`;
  }
  try {
    const source = input.source ? await upload(input.source) : undefined;
    const refs: string[] = []; for (const file of input.references) refs.push(await upload(file));
    const graph = buildComfyGraph(input, source, refs, `${namespace}/render`);
    const info = await (await client.fetch('/object_info', {signal: input.signal})).json();
    const missing = [...new Set(Object.values(graph).map(n => n.class_type))].filter(type => !info[type]);
    if (missing.length) throw new Error(`Install or update these ComfyUI nodes: ${missing.join(', ')}.`);
    if(input.request.pipeline)resolveComfyDevices(graph,input.request.pipeline.metadata,info);
    await fs.writeFile(path.join(directory, 'comfy-workflow.json'), JSON.stringify(graph, null, 2), {mode: 0o600});
    record.submission = 'pending'; record.areas.push('output'); await writeReceipt(receipt, record);
    const result = await (await client.fetch('/prompt', {...post({prompt: graph, prompt_id: record.promptId, client_id: record.clientId}), signal: input.signal})).json();
    if (!uuid.test(result.prompt_id) || Object.keys(result.node_errors || {}).length) throw new Error('ComfyUI rejected the workflow or returned an invalid job ID.');
    record.promptId = result.prompt_id; record.submission = 'accepted'; await writeReceipt(receipt, record);
    const start = Date.now(), timeout = jobTimeoutMs();
    while (Date.now() - start < timeout) {
      input.signal.throwIfAborted();
      const history = await (await client.fetch(`/history/${record.promptId}`, {signal: input.signal})).json();
      const h = history[record.promptId];
      if (terminal(h)) {
        record.submission = 'terminal'; await writeReceipt(receipt, record);
        if (h.status.status_str === 'error') throw new Error('ComfyUI could not complete this workflow.');
        // LoadVideo also reports a preview of its input. Only read actual save
        // nodes, otherwise that preview can be mistaken for the finished video.
        const outputNodes=Object.entries(graph).filter(([,node])=>['SaveImage','SaveVideo'].includes(node.class_type)).map(([id])=>id);
        const outputs = outputNodes.flatMap(id=>h.outputs?.[id]?[h.outputs[id]]:[]) as Record<string, unknown[]>[];
        const candidates = outputs.flatMap(o => [...(o.images || []), ...(o.gifs || []), ...(o.videos || [])]).map(file => ownFile(file, namespace, 'output'));
        const file = candidates.find(f => input.request.mode === 'image' ? /\.(png|jpe?g|webp)$/i.test(f.filename) : /\.(mp4|webm|mov)$/i.test(f.filename));
        if (!file) throw new Error('ComfyUI completed without a saved output of the requested type.');
        const response = await client.fetch(`/view?${new URLSearchParams(file)}`, {signal: input.signal});
        const {Readable} = await import('node:stream'); const {pipeline} = await import('node:stream/promises'); const {createWriteStream} = await import('node:fs');
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(input.output, {mode: 0o600}), {signal: input.signal});
        input.onRuntime?.((Date.now()-start)/1000);
        return;
      }
      input.log('ComfyUI is processing the workflow…\n');
      await delay(2000, undefined, {signal: input.signal});
    }
    throw new Error('ComfyUI job timed out.');
  } finally {
    // Do not release the worker to another job until ComfyUI acknowledges exit.
    // Older servers lack scoped cancellation; wait for their current render.
    if(input.signal.aborted && input.waitForStop?.() && record.submission==='accepted') {
      input.log('Waiting for ComfyUI to stop before releasing the queue…\n');
      let cancellationRequested=false;
      for(;;) {
        try {
          if(!cancellationRequested){
            await client.fetch('/queue',post({delete:[record.promptId]}));
            try {await client.fetch(`/api/jobs/${record.promptId}/cancel`,post({}));}
            catch(error){if(!(error instanceof ComfyHttpError)||![404,405].includes(error.status))throw error;input.log('This ComfyUI version cannot stop an individual render; waiting for it to finish.\n');}
            cancellationRequested=true;
          }
          const queue=await (await client.fetch('/queue')).json();
          if(Array.isArray(queue.queue_running)&&Array.isArray(queue.queue_pending)&&![...queue.queue_running,...queue.queue_pending].some(row=>row[1]===record.promptId))break;
        }catch { /* Keep the worker occupied while the remote runner is unreachable. */ }
        await delay(1000);
      }
    }
    let cleaned = false;
    try { if (await cleanReceipt(record, client, record.roots)) { await fs.unlink(receipt); cleaned = true; } else await writeReceipt(receipt, record); }
    catch { /* Keep the durable receipt for deletion/recovery. */ }
    if (!cleaned) input.log('ComfyUI cleanup is pending. Runner copies may remain; this job’s cleanup receipt must be retained until cleanup is confirmed.\n');
  }
}
