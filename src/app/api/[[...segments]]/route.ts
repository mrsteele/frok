import { normalizeInterfacePreferences } from '@/lib/interface-preferences';
import type { ExportPreferences } from '@/lib/export-preferences';
import { deleteJobs } from '@/lib/job-deletion';
import { buildPipelineBundle, zipFiles } from '@/lib/pipelines/utils';
import { runtimeOptions, runtimeStatus } from '@/lib/preferences';
import { pipelineLibraryAudit, savePipelineDirectory, resetDefaultPipelines } from '@/lib/pipelines/location';
import { catalog, resolvePipeline, pipelineStatus } from '@/lib/pipelines/catalog';
import { workerStatus } from '@/lib/worker-health';
import { queueBusy } from '@/lib/worker-queue';
import { snapshotRequest, checkPipelineRequest, validatePipelineSelections } from '@/lib/pipelines/selection';
import { pipelineId, pipelineSelectionsSchema } from '@/lib/pipelines/schema';
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { mediaDir, jobsDir } from "@/lib/config";
import { listAssets, listSessionMedia, getMedia, getValue, listJobs, getJob, moveQueuedJob, createJob, updateJob, settings, setValue, mediaRoot, mediaFamily, favoriteRender } from "@/lib/db";
import { publishMedia } from '@/lib/media-publication';
import { generationSchema, hdDimensions } from "@/lib/validation";
import { health, setupTasks } from "@/lib/setup";
import type { Generation, Health, SetupRequest } from "@/lib/types";
import { deletionPlan, deleteMedia } from '@/lib/media-delete';
import { readImagePreview, liveImagePreviewsEnabled } from '@/lib/image-preview';
import { telemetry } from '@/lib/telemetry';
import { ollamaConfig } from '@/lib/ollama-config';
import { prepareConnection, queueSetup } from '@/lib/connection-setup';
import { validateServiceSettings, checkSetupConnection } from '@/lib/service-settings';
import { connectionIds, connectionsSchema, modelSelectionsSchema, ollamaAddressSettingSchema, promptModelSchema } from '@/lib/service-config';
import { handleLibraryReset, withAppRequest, privateResponse, HttpError } from '@/lib/app-request';
import { handleLibraryExport } from '@/lib/library-export';
import { listPromptLibrary } from '@/lib/prompt-library';
import { libraryStore } from '@/lib/library';
import { readJson } from '@/lib/request-body';
import { assertComfyPrivateBackend, checkComfyFolders } from '@/lib/comfyui';
import { withRunnerLocations, type RunnerLocations } from '@/lib/runner-locations';
import { normalizeRunnerLocations, assertRunnerLocationsIdle, checkVpipeWorkspace, runnerLocationFields } from '@/lib/runner-settings';
import { imageModels } from '@/lib/image-models';
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{segments?:string[]}>};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const healthCaches=new Map<string,{at:number;key:string;data:Health}>();
const body=readJson;
async function route(request:Request,{params}:Context) {
  const [resource,id,action]= (await params).segments||[];
  const url=new URL(request.url);const method=request.method;

  if(resource==='envision'&&!id&&method==='GET')return json(listPromptLibrary(libraryStore,{
    before:z.string().max(512).optional().parse(url.searchParams.get('before')||undefined),
    through:z.string().max(512).optional().parse(url.searchParams.get('through')||undefined),
  }));

  if(resource==='utils'&&method==='POST'&&id==='pipeline'&&!action){const result=await buildPipelineBundle(await readJson(request,1_100_000));return json({base64:zipFiles(result.files).toString('base64'),unresolved:result.unresolved,folder:result.folder,filename:result.filename});}
  if(resource==='pipelines'&&id==='library'){
    if(method==='GET')return json(await pipelineLibraryAudit());
    if(method==='PATCH'){const input=z.object({path:z.string().max(2048)}).strict().parse(await body(request));const result=await savePipelineDirectory(input.path,request.signal);healthCaches.clear();return json(result);}
  }
  if(resource==='pipelines'&&id==='reset'&&method==='POST'){
    z.object({confirm:z.literal('RESET DEFAULT PIPELINES')}).strict().parse(await body(request));
    const result=await resetDefaultPipelines();healthCaches.clear();return json(result);
  }
  if(resource==='pipelines'&&method==='GET'){const state=await health();return json({pipelines:state.pipelines,errors:state.pipelineErrors});}
  if(resource==='deletion') {
    const targetSchema=z.discriminatedUnion('scope',[z.object({scope:z.literal('history')}),z.object({scope:z.literal('media'),id:z.string().uuid()}),z.object({scope:z.literal('section'),sectionId:z.string().uuid().optional(),jobIds:z.array(z.string().uuid()).max(500).default([])}).refine(value=>!!value.sectionId||value.jobIds.length>0,'Choose a prompt section.')]);
    if(id==='preview'&&method==='POST')return json(deletionPlan(targetSchema.parse(await body(request))));
    if(method==='GET')return json(deletionPlan(targetSchema.parse({scope:url.searchParams.get('scope'),id:url.searchParams.get('id')||undefined})));
    if(method==='POST'){const input=z.object({target:targetSchema,token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await body(request));return json(await deleteMedia(input.target,input.token));}
  }
  if(resource==="telemetry"&&method==="GET")return json(telemetry());
  if(resource==="health"&&method==="GET"){
    const owner='local';
    for(let attempt=0;attempt<3;attempt++) {
      const config=ollamaConfig(),key=JSON.stringify([config,settings(),runtimeOptions()]),cached=healthCaches.get(owner);
      if(url.searchParams.get('refresh')!=='1'&&cached?.key===key&&Date.now()-cached.at<5000)return json(cached.data);
      const data=await health(config);
      if(JSON.stringify([ollamaConfig(),settings(),runtimeOptions()])!==key)continue;
      if(healthCaches.size>1000)healthCaches.clear();
      healthCaches.set(owner,{at:Date.now(),key,data});return json(data);
    }
    return json({error:'Settings changed during the readiness check. Please retry.'},409);
  }
  if(resource==="media"&&id&&action==="family"&&method==="GET")return getMedia(id)?json(mediaFamily(id)):json({error:'Media not found'},404);
  if(resource==='media'&&id&&action==='metadata'&&method==='GET'){const media=getMedia(id);return media?json({media}):json({error:'Media not found'},404);}
  if(resource==="media"&&id&&(method==="GET"||method==="HEAD")) {
    const media=getMedia(id);if(!media)return json({error:"Media not found"},404);
    const file=path.join(mediaDir(),path.basename(media.filename));const stat=await fs.stat(file).catch(()=>null);if(!stat)return json({error:"Media file is missing"},404);
    const headers:Record<string,string>={"Content-Type":media.kind==="video"?"video/mp4":"image/jpeg","Accept-Ranges":"bytes","Cache-Control":"private, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"};
    if(url.searchParams.has("download"))headers["Content-Disposition"]=`attachment; filename="frok-${media.id}.${media.kind==="video"?"mp4":"jpg"}"`;
    let start=0,end=stat.size-1,status=200;
    const range=request.headers.get("range");
    if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{"Content-Range":`bytes */${stat.size}`}});
      if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}else{start=Math.max(0,stat.size-Number(match[2]));}
      if(start>end||start>=stat.size||!Number.isSafeInteger(start)||!Number.isSafeInteger(end))return new Response(null,{status:416,headers:{"Content-Range":`bytes */${stat.size}`}});
      status=206;headers["Content-Range"]=`bytes ${start}-${end}/${stat.size}`;
    }
    headers["Content-Length"]=String(end-start+1);
    return new Response(method==="HEAD"?null:Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream,{status,headers});
  }
  if(resource==="media"&&!id&&method==="GET") {
    const sessions=url.searchParams.get('sessions');
    if(sessions!==null){const ids=z.array(z.string().uuid()).max(1000).parse(sessions?sessions.split(','):[]);return json({media:listSessionMedia(ids),revision:getValue('mediaRevision',0)});}
    const kind=z.enum(['image','video']).optional().parse(url.searchParams.get('kind')||undefined);
    return json({...listAssets(url.searchParams.get('favorites')==='true',72,url.searchParams.get('before')||undefined,kind),revision:getValue('mediaRevision',0)});
  }
  if(resource==="media"&&id&&method==="PATCH"){
    if(!getMedia(id))return json({error:"Media not found"},404);
    const {favorite}=z.object({favorite:z.boolean()}).parse(await body(request));return json({media:favoriteRender(id,favorite)});
  }
  if(resource==="upload"&&method==="POST"){
    const length=Number(request.headers.get("content-length")||0);if(length>21*1024**2)return json({error:"Each image must be smaller than 20 MB."},413);
    // Bound the stream even when Content-Length is absent or inaccurate.
    const reader=request.body?.getReader();if(!reader)throw new Error("No file uploaded.");let size=0;const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>21*1024**2){await reader.cancel();return json({error:"Each image must be smaller than 20 MB."},413);}chunks.push(value);}
    const form=await new Response(new Blob(chunks as BlobPart[]),{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();
    const file=form.get("image");if(!(file instanceof File)||!file.size||file.size>20*1024**2)throw new Error("Upload a PNG, JPEG, or WebP image under 20 MB.");
    if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("Use a PNG, JPEG, or WebP image.");
    const id=randomUUID(),filename=`${id}.jpg`;
    const image=sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:40_000_000}).rotate();
    const {info,data}=await image.flatten({background:"#000000"}).resize(4096,4096,{fit:"inside",withoutEnlargement:true}).jpeg({quality:95}).toBuffer({resolveWithObject:true});
    request.signal.throwIfAborted();
    return json({media:publishMedia({id,kind:"image",filename,prompt:"",enhancedPrompt:"",width:info.width,height:info.height,seed:0,referenceOnly:form.get("purpose")==="reference",favorite:false,createdAt:new Date().toISOString(),origin:"upload"},data)},201);
  }
  if(resource==='jobs'&&id&&!action&&method==='DELETE')return json(await deleteJobs(z.string().uuid().parse(id)));
  if(resource==='jobs'&&id&&action==='dismiss'&&method==='POST')return json(await deleteJobs(z.string().uuid().parse(id)));
  if(resource==='jobs'&&id&&!action&&method==='GET'){const job=getJob(id);return job?json({job}):json({error:'Job not found'},404);}
  if(resource==="jobs"&&!id&&method==="GET"){
    const jobs=listJobs();const sourceIds=[...new Set(jobs.filter(j=>j.kind==='generate'&&['running','queued'].includes(j.status)).map(j=>(j.request as Generation).sourceId || (j.request as Generation).rootId).filter(Boolean))] as string[];
    return json({jobs,sources:sourceIds.map(id=>mediaRoot(id)).filter(Boolean)});
  }
  if(resource === 'jobs' && id && action === 'preview' && (method === 'GET' || method === 'HEAD')) {
    const jobId = z.string().uuid().parse(id);
    const index = z.coerce.number().int().min(0).max(11).parse(url.searchParams.get('index') ?? NaN);
    const job = getJob(jobId);
    if (!job) return json({ error: 'Job not found' }, 404);
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const activeImage = (value: typeof job | undefined) => value?.status === 'running' && value.kind === 'generate' && value.runner === 'vpipe' && (value.request as Generation).mode === 'image' && value.completed === index && index < value.total;
    if (!liveImagePreviewsEnabled() || !activeImage(job)) return new Response(null, { status: 204, headers });
    const preview = await readImagePreview(path.join(jobsDir(), jobId, String(index)));
    // A poll may finish just as this batch advances, completes or is cancelled.
    if (!preview || !activeImage(getJob(jobId))) return new Response(null, { status: 204, headers });
    const imageHeaders = { ...headers, 'Content-Type': 'image/jpeg', ETag: preview.etag };
    if (request.headers.get('if-none-match') === preview.etag) return new Response(null, { status: 304, headers: imageHeaders });
    return new Response(method === 'HEAD' ? null : new Uint8Array(preview.data), { headers: imageHeaders });
  }
  if(resource==="jobs"&&id&&action==="log"&&method==="GET"){
    if(!getJob(id))return json({error:"Job not found"},404);
    const file=await fs.open(path.join(jobsDir(),id,"runner.log"),"r").catch(()=>null);if(!file)return json({log:"Waiting for the runner…"});
    try{const stat=await file.stat();const b=Buffer.alloc(Math.min(stat.size,16000));await file.read(b,0,b.length,Math.max(0,stat.size-b.length));return json({log:b.toString()});}finally{await file.close();}
  }
  if(resource==='jobs'&&id==='clear'&&method==='POST')return json(await deleteJobs());
  if(resource==="jobs"&&!id&&method==="POST"){
    const input:Generation=generationSchema.parse(await body(request));
    await catalog();
    const config=settings(),runtime=runtimeOptions();
    const selected=config.modelSelections;
    let runner=input.mode==='image'&&selected.image?imageModels[selected.image].runner:input.mode==='reference'?selected.reference||config.runner:selected.video||config.runner;
    if(input.sourceId){const source=getMedia(input.sourceId);if(!source)throw new Error("Source media no longer exists.");if(source.origin==='poster')throw new Error("Open the root video to render this creation again.");if(source.kind!==(input.mode==="upscale"?"video":"image"))throw new Error("This source is not valid for the selected mode.");}
    if(input.rootId){
      const root=mediaRoot(input.rootId);
      if(!root||root.kind!=='video'||root.id!==input.rootId)throw new Error('Choose an existing video root.');
      const reference=root.generation?.mode==='reference';
      if(input.mode!==(reference?'reference':'video'))throw new Error('Use the root video’s generation mode.');
      if(reference&&JSON.stringify(input.referenceIds)!==JSON.stringify(root.generation?.referenceIds))throw new Error('Keep the original reference images for this creation.');
      if(!reference&&input.prompt!==root.prompt)throw new Error('Use Redo with the original text-to-video prompt.');
    }
    for(const ref of input.referenceIds)if(getMedia(ref)?.kind!=="image")throw new Error("A reference image is missing.");
    const promptConfig=ollamaConfig();
    const state=await health(promptConfig,selected);
    const latest=settings();
    if(JSON.stringify([latest.connections,latest.modelSelections,latest.pipelineSelections])!==JSON.stringify([config.connections,selected,config.pipelineSelections]))throw new HttpError(409,'Settings changed while checking services. Try generating again.');
    try{runner=await snapshotRequest(input,state);}catch(error){throw new HttpError(409,(error as Error).message);}
    request.signal.throwIfAborted();
    if(JSON.stringify([settings(),runtimeOptions()])!==JSON.stringify([config,runtime]))throw new HttpError(409,'Settings changed while checking the pipeline. Try generating again.');
    if(input.enhance){if(!state.ollama)return json({error:state.capabilities?.prompt.detail||'Configure prompt enhancement in Settings → Services → Ollama.',setupRequired:true},409);input.ollama=promptConfig;}

    if(input.mode==='upscale'){const source=getMedia(input.sourceId!)!;hdDimensions(source.width,source.height);}
    return json({job:createJob({kind:"generate",request:input,runner,total:input.mode==="image"?input.count:1})},201);
  }
  if(resource==="jobs"&&id&&method==="POST") {
    const job=getJob(id);if(!job)return json({error:"Job not found"},404);
    if(action==='move'||action==='next'||action==='start') {
      const worker=workerStatus();if(worker.outdated)throw new HttpError(409,worker.detail);
      const input=z.object({beforeId:z.string().min(1).nullable().optional()}).strict().parse(await readJson(request,4096));
      try{return json({job:moveQueuedJob(id,action,input.beforeId),jobs:listJobs()});}catch(error){throw new HttpError(409,(error as Error).message);}
    }
    if(action==="cancel"){if(!["queued","running"].includes(job.status))throw new Error("This job is already finished.");return json({job:updateJob(id,{status:"cancelled",message:job.status==="queued"?"Cancelled before starting":"Stopping…"})});}
    if(action==="retry"){
      const worker=workerStatus();if(worker.outdated)throw new HttpError(409,worker.detail);
      await catalog();
      const before=settings(),runtime=runtimeOptions();
      if(!["failed","cancelled"].includes(job.status))throw new Error("Only stopped or failed jobs can be retried.");
      const r=structuredClone(job.request);
      if(job.kind==="setup"&&(r as SetupRequest).task.startsWith("comfy-"))assertComfyPrivateBackend();
      if(job.kind==='generate'){
        const input=r as Generation;
        if(!input.pipeline)throw new HttpError(409,'This job predates pipeline selection. Choose a pipeline and start a new generation.');
        const selections={...settings().modelSelections,...(input.ollama?{prompt:input.ollama.model}:{})};
        const state=await health(input.ollama,selections);
        if((r as Generation).enhance&&!state.ollama)return json({error:state.capabilities?.prompt.detail||'Set up the original prompt model before retrying.',setupRequired:true},409);
        if((r as Generation).pipeline){try{await checkPipelineRequest((r as Generation).pipeline!,r as Generation,state);}catch(error){throw new HttpError(409,(error as Error).message);}}
      }
      if(job.kind==="setup"){
        const {pipeline,task}=r as SetupRequest;
        if(pipeline&&!settings().connections[pipeline.metadata.runner])throw new HttpError(409,'Enable this pipeline’s connection before retrying.');
        if(!pipeline&&!(setupTasks as readonly string[]).includes(task))throw new HttpError(400,'This setup task is no longer supported.');
        if(task==='ollama'&&!settings().connections.ollama)throw new HttpError(409,'Enable this job’s connection before retrying.');
      }
      if(job.kind==="generate") {const input=r as Generation;if(input.mode==="image"){input.count=Math.max(1,input.count-job.completed);if(input.seed!==undefined)input.seed=(input.seed+job.completed)%2147483648;}}
      request.signal.throwIfAborted();
      if(JSON.stringify([settings(),runtimeOptions()])!==JSON.stringify([before,runtime]))throw new HttpError(409,'Settings changed while checking the job. Please retry.');
      const next=createJob({kind:job.kind,request:r,runner:job.runner,total:job.kind==="generate"?(r as Generation).mode==="image"?(r as Generation).count:1:1});
      return json({job:next},201);
    }
  }
  if(resource==='settings'&&id==='interface'&&!action){
    if(method==='GET')return json(getValue<ExportPreferences>('interfacePreferences',{}));
    if(method==='POST'||method==='PATCH'){
      const input=normalizeInterfacePreferences(await readJson(request,1_000_000),method==='POST');
      libraryStore.exec('BEGIN IMMEDIATE');
      try{
        const saved=getValue<ExportPreferences>('interfacePreferences',{});
        // Initial migration fills missing keys; it cannot replace newer saved choices.
        const next=method==='POST'?{...input,...saved}:{...saved,...input};
        setValue('interfacePreferences',next);
        libraryStore.exec('COMMIT');return json(next);
      }catch(error){libraryStore.exec('ROLLBACK');throw error;}
    }
  }
  if(resource==='settings'&&id==='runtime'&&!action){
    if(method==='GET')return json(runtimeStatus());
    if(method==='PATCH'){
      const input=z.object({liveImagePreviews:z.boolean().optional(),jobTimeoutMinutes:z.number().int().min(1).max(10080).optional(),jobRetentionHours:z.number().int().min(1).max(8760).nullable().optional(),mediaToolsDirectory:z.string().trim().max(2048).refine(value=>!value||(!/[\x00-\x1f]/.test(value)&&(path.isAbsolute(value)||/^~[/\\]/.test(value))),"Choose an absolute folder or leave it blank for automatic detection.").optional()}).strict().parse(await body(request));
      const current=runtimeOptions();
      if(input.mediaToolsDirectory!==undefined&&input.mediaToolsDirectory!==current.mediaToolsDirectory&&queueBusy())throw new HttpError(409,'Finish or cancel queued jobs and wait for the runner to stop before changing the video tools folder.');
      setValue('runtimeOptions',{...current,...input});
      healthCaches.clear();return json(runtimeStatus());
    }
  }
  if(resource==="settings"&&!id&&method==="GET")return json({settings:settings()});
  if(resource==="settings"&&!id&&method==="PATCH"){
    const input=z.object({pipelineSelections:pipelineSelectionsSchema.partial().optional(),connections:connectionsSchema.partial().optional(),modelSelections:modelSelectionsSchema.pick({prompt:true}).partial().optional(),ollamaModel:promptModelSchema.optional(),ollamaUrl:ollamaAddressSettingSchema.optional(),vpipeWorkdir:z.string().trim().max(2048).optional(),comfyUrl:z.string().trim().max(2048).optional(),comfyDir:z.string().trim().max(2048).optional(),setupDismissed:z.boolean().optional()}).strict().parse(await body(request));
    await catalog();
    const current=settings();
    const locations=normalizeRunnerLocations(input);
    assertRunnerLocationsIdle(locations);
    const services=await withRunnerLocations(locations,async()=>{
      if(locations.vpipeWorkdir!==undefined)await checkVpipeWorkspace(settings().vpipeWorkdir);
      const checked=await validateServiceSettings({...input,...locations},request.signal);
      if(locations.comfyDir!==undefined||locations.comfyUrl!==undefined)await checkComfyFolders(request.signal);
      return checked;
    });
    const selections=input.pipelineSelections?await validatePipelineSelections(input.pipelineSelections,services.connections):undefined;
    request.signal.throwIfAborted();
    if(JSON.stringify(settings())!==JSON.stringify(current))throw new HttpError(409,'Settings changed while checking services. Refresh and try again.');
    assertRunnerLocationsIdle(locations);
    if(Object.keys(locations).length)setValue('runnerLocations',{...getValue<Partial<RunnerLocations>>('runnerLocations',{}),...locations});
    if(selections)setValue('pipelineSelections',selections);
    for(const [key,value]of Object.entries(input)){if(key==='connections'||key==='modelSelections'||key==='pipelineSelections'||runnerLocationFields.includes(key as keyof RunnerLocations))continue;setValue(key,value);}
    setValue('connections',services.connections);setValue('modelSelections',services.modelSelections);
    healthCaches.clear();return json({settings:settings()});
  }
  if(resource==='setup'&&id==='connection'&&method==='POST') {
    const {connection,promptModel}=z.object({connection:z.enum(connectionIds),promptModel:promptModelSchema.optional()}).strict().parse(await body(request));
    const result=await prepareConnection(connection,request.signal,promptModel);
    healthCaches.clear();return json(result,201);
  }
  if(resource==="setup"&&method==="POST") {
    const setupInput=z.object({task:z.enum(setupTasks).optional(),pipelineId:pipelineId.optional()}).strict().parse(await body(request));
    if(setupInput.pipelineId){
      const list=await catalog(),before=settings();
      const found=list.entries.find(p=>p.metadata.id===setupInput.pipelineId);
      if(!found)throw Error('Pipeline not found.');
      const pipeline=await resolvePipeline(found.kind,setupInput.pipelineId),status=await pipelineStatus(pipeline);
      if(!status.ready&&!status.canPrepare)throw Error(status.detail);
      request.signal.throwIfAborted();
      if(JSON.stringify(settings())!==JSON.stringify(before))throw new HttpError(409,'Settings changed while checking the pipeline. Please try again.');
      return json({job:queueSetup({task:'pipeline',pipeline})},201);
    }
    const task=setupInput.task;if(!task)throw Error('Choose a setup task.');
    if(task.startsWith("comfy-"))assertComfyPrivateBackend();
    await checkSetupConnection(task);
    const config=task==='ollama'?ollamaConfig():undefined;
    healthCaches.clear();
    return json({job:queueSetup({task,...(config?{ollama:config}:{})})},201);
  }
  return json({error:"Not found"},404);
}
async function handle(request:Request,context:Context){
  try {
    const segments=(await context.params).segments||[];
    if(segments[0]==='library'&&segments[1]==='export'&&segments.length<=3)return await handleLibraryExport(request,segments[2]);
    if(segments.length===1&&segments[0]==='library')return await handleLibraryReset(request);
    return await withAppRequest(request,()=>route(request,context));
  }catch(e){return privateResponse(json({error:e instanceof z.ZodError?e.issues.map(i=>i.message).join(" "):(e as Error).message||"Something went wrong"},e instanceof HttpError?e.status:400));}
}
export const GET=handle;export const POST=handle;export const PATCH=handle;export const HEAD=handle;export const DELETE=handle;
