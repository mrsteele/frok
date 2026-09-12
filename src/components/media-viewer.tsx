'use client';
import { imageModels } from '@/lib/image-models';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, Heart, Image as ImageIcon, Layers3, Play, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Generation, Health, Job, Media, MediaFamily } from '@/lib/types';
import { mediaUrl } from '@/lib/types';
import { api } from '@/lib/client-api';
import { animationRequest, redoRequest, upscaleRequest, familySlides, familySelection, newlyAvailableRender } from '@/lib/media-family';
import { promptDetails } from '@/lib/prompt-details';
import { formatRunnerTime } from '@/lib/runner-time';
import { generationIssue, promptEnhancementIssue, type SetupTarget } from '@/lib/readiness';
import { motionChoices, motionChoiceInput } from '@/lib/video-presets';
import { useVideoPresets } from './use-video-presets';
import { VideoPlayer } from './video-player';
import { captureVideoPlayback, type VideoPlayback } from '@/lib/video-playback';
import { VideoProgress } from './video-progress';
import { VideoRenderControls, type VideoRenderPreferences } from './video-render-controls';
import { SettingsDialog } from './settings-dialog';
import { AssetVideoControls } from './asset-video-controls';
import { AssetJobLink } from './asset-job-link';

export function MediaViewer({initialMedia,renderNumber,onSelect,health,jobs,submitting,preferences,onPreferencesChange,storageError,onGenerate,onSetup,onQueue,onChanged,onDelete}:{
  initialMedia:Media;renderNumber:number;onSelect:(item:Media,options?:{replace?:boolean})=>void;health?:Health;jobs:Job[];submitting:boolean;preferences:VideoRenderPreferences;onPreferencesChange:(change:Partial<VideoRenderPreferences>,mode?:'video'|'reference')=>void;storageError?:string;
  onGenerate:(input:Generation)=>Promise<Job|undefined>;onSetup:(target?:SetupTarget)=>void;onQueue:(jobId?:string)=>void;onChanged:()=>void;onDelete:(item:Media)=>void;
}) {
  const [family,setFamily]=useState<MediaFamily>();
  const selected=family?familySelection(family,renderNumber):undefined;
  const cursor=selected?.id;
  const {presets,defaultPreset,error:presetError}=useVideoPresets();
  const [prompt,setPrompt]=useState('');
  const [quality,setQuality]=useState<{renderId:string;version:'sd'|'hd';playback?:VideoPlayback}>();
  const [renderOptions,setRenderOptions]=useState<{id?:string;value:Partial<VideoRenderPreferences>}>();
  const [settingsOpen,setSettingsOpen]=useState(false);
  const sdVideo=useRef<HTMLVideoElement>(null),hdVideo=useRef<HTMLVideoElement>(null);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false),[sending,setSending]=useState(false);
  const details=useRef<HTMLDetailsElement>(null),waitingFor=useRef<string|undefined>(undefined);
  const requestLock=useRef(false);
  const refresh=useCallback(async()=>api<MediaFamily>(`media/${initialMedia.id}/family`),[initialMedia.id]);
  useEffect(()=>{
    let closed=false,loading=false;
    let previous:MediaFamily|undefined;
    async function load(){if(loading)return;loading=true;try{
      const next=await refresh();if(closed)return;
      const finished=newlyAvailableRender(previous,next,waitingFor.current);
      previous=next;setFamily(next);
      if(finished){
        waitingFor.current=undefined;
        setQuality(undefined);onSelect(finished,{replace:true});
      }
    }catch(e){if(!closed)setError((e as Error).message);}finally{loading=false;}}
    void load();const timer=setInterval(()=>void load(),2500);return()=>{closed=true;clearInterval(timer);};
  },[refresh,onSelect]);
  const render=family?.renders.find(item=>item.media.id===cursor);
  const original=render?.media;
  const imageRoot=family?.root.kind==='image';
  const referenceRoot=family?.root.kind==='video'&&family.root.generation?.mode==='reference';
  const textRoot=family?.root.kind==='video'&&!referenceRoot;
  const generationMode=referenceRoot?'reference':'video';
  const savedOptions=original?animationRequest(family!.root,original):undefined;
  const controls:VideoRenderPreferences={pipelineId:imageRoot?preferences.pipelineId:savedOptions?.pipelineId,duration:savedOptions?.duration??preferences.duration,quality:savedOptions?.quality??preferences.quality,seed:preferences.seed,enhance:preferences.enhance,...(renderOptions?.id===cursor?renderOptions?.value:{})};
  function changeOptions(change:Partial<VideoRenderPreferences>){setRenderOptions({id:cursor,value:{...controls,...change}});onPreferencesChange(change,generationMode);}
  const selection=quality?.renderId===original?.id?quality:undefined;
  const displayed=(selection?.version==='sd'?original:render?.hd) || original || family?.root || initialMedia;
  const enhancedLabel=render?.hd&&Math.min(render.hd.width,render.hd.height)>=720?'HD':'AI';
  const upscalerName=health?.upscaler==='seedvr2'?'SeedVR2':'Real-ESRGAN';
  const enhancedWithSelected=!!render?.hd&&(render.hd.upscaler||'realesrgan')===(health?.upscaler||'realesrgan');
  const prompts=family?promptDetails(family.root,original):[];
  const timingMedia=displayed.elapsedSeconds!==undefined||displayed.runnerSeconds!==undefined?displayed:original || displayed;
  const runnerTime=formatRunnerTime(timingMedia.elapsedSeconds ?? timingMedia.runnerSeconds);
  const slides=family?familySlides(family):[];
  const index=slides.findIndex(item=>item.id===cursor);
  const active=jobs.filter(job=>job.kind==='generate'&&['running','queued'].includes(job.status)&&((job.request as Generation).rootId===family?.root.id || (job.request as Generation).sourceId===family?.root.id || family?.renders.some(item=>item.media.id===(job.request as Generation).sourceId)));
  const animation=active.find(job=>['video','reference'].includes((job.request as Generation).mode)&&(job.id===waitingFor.current||!original)&&job.status==='running') || active.find(job=>['video','reference'].includes((job.request as Generation).mode)&&(job.id===waitingFor.current||!original));
  const linkedJob=active.find(job=>job.id===waitingFor.current)||animation||active.find(job=>job.status==='running')||active[0];
  const blocked=generationIssue(health,generationMode,imageRoot?family?.root.id:undefined,controls.pipelineId)||promptEnhancementIssue(health,controls.enhance);
  const choices=motionChoices(presets);
  const missingReferences=referenceRoot&&family?.references?.some(ref=>!ref.media);
  const disabled=!family||!!blocked||submitting||sending||!!missingReferences;
  useEffect(()=>{setPrompt(original?.prompt||original?.promptTrace?.raw||original?.generation?.videoPreset?.prompt||'');setError('');if(details.current)details.current.open=false;},[cursor,original?.id]);
  function move(next:number){if(next<0||next>=slides.length)return;onSelect(slides[next]);setQuality(undefined);waitingFor.current=undefined;}
  function switchQuality(version:'sd'|'hd'){
    if(!original||!render?.hd||(version==='sd'?original.id:render.hd.id)===displayed.id)return;
    setQuality({renderId:original.id,version,playback:captureVideoPlayback((displayed.id===original.id?sdVideo:hdVideo).current,selection?.playback)});
  }
  async function generate(redo=false,choice=choices[0]){
    if(disabled||requestLock.current||!family)return;
    requestLock.current=true;setSending(true);setError('');
    try {
      const {enhance,...options}=controls;
      const input=redo&&original?redoRequest(family.root,original,enhance,options):animationRequest(family.root,original,textRoot?undefined:referenceRoot?{prompt}:motionChoiceInput(choice,prompt),enhance,options);
      const job=await onGenerate(input);if(job)waitingFor.current=job.id;else setError('Could not queue the video. Check setup and try again.');
    }catch(e){setError((e as Error).message);}finally{requestLock.current=false;setSending(false);}
  }
  async function upscale(){
    if(!original||enhancedWithSelected||requestLock.current)return;
    const issue=generationIssue(health,'upscale');if(issue){onSetup(issue.target);return;}
    const existing=active.find(job=>(job.request as Generation).mode==='upscale'&&(job.request as Generation).sourceId===original.id);
    if(existing){onQueue(existing.id);return;}
    requestLock.current=true;setSending(true);setError('');
    try{const job=await onGenerate(upscaleRequest(original));if(job)waitingFor.current=job.id;else setError('Could not queue HD enhancement. Check setup and try again.');}catch(e){setError((e as Error).message);}finally{requestLock.current=false;setSending(false);}
  }
  async function favorite(){
    setSaving(true);try{await api(`media/${displayed.id}`,'PATCH',{favorite:!displayed.favorite});setFamily(await refresh());onChanged();}catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  if(family&&!selected)return <div className="route-empty"><h2>This render is unavailable</h2><p>Render {renderNumber} may have been deleted. Its number won’t be reused.</p><button className="secondary" onClick={()=>onSelect(family.root)}>View starting asset</button></div>;
  if(!family)return <div className="route-empty" role="status">{error||'Loading render history…'}</div>;
  return <section aria-label="Image and video viewer" className="media-viewer">
    <div className="viewer-stage" tabIndex={0} aria-label="Media slideshow" onKeyDown={e=>{if((e.target as HTMLElement).closest('button,summary,a,input,textarea,select'))return;if(e.key==='ArrowLeft'){e.preventDefault();move(index-1);}if(e.key==='ArrowRight'){e.preventDefault();move(index+1);}}}>
      {animation&&imageRoot?<img src={mediaUrl(family.root.id)} alt="Image being animated"/>:displayed.kind==='image'?<img src={mediaUrl(displayed.id)} alt="Starting image"/>:(render?[render.media,...(render.hd?[render.hd]:[])]:[displayed]).map(item=><VideoPlayer key={item.id} videoRef={item.id===original?.id?sdVideo:hdVideo} src={mediaUrl(item.id)} active={item.id===displayed.id} hidden={item.id!==displayed.id} aria-hidden={item.id!==displayed.id} tabIndex={item.id===displayed.id?0:-1} resumeFrom={item.id===displayed.id?selection?.playback:undefined} preload="auto" controls autoPlay playsInline/>)}
      {animation&&<VideoProgress job={animation}/>}
      {!animation&&render?.hd?<div className="viewer-quality" role="group" aria-label="Video quality">
        <button type="button" aria-label="SD original video" aria-pressed={displayed.id===original?.id} title={`Original · ${render.media.width} × ${render.media.height}`} onClick={()=>switchQuality('sd')}>SD</button>
        <button type="button" aria-label={`${enhancedLabel} enhanced video`} aria-pressed={displayed.id===render.hd.id} title={`AI enhanced · ${render.hd.width} × ${render.hd.height}`} onClick={()=>switchQuality('hd')}>{enhancedLabel}</button>
      </div>:!animation&&displayed.kind==='video'&&Math.min(displayed.width,displayed.height)>=720&&<span className="viewer-hd">HD</span>}
      {slides.length>1&&<><button className="slide-arrow previous" aria-label="Previous render or starting image" disabled={index<=0} onClick={()=>move(index-1)}><ChevronLeft size={24}/></button><button className="slide-arrow next" aria-label="Next render" disabled={index>=slides.length-1} onClick={()=>move(index+1)}><ChevronRight size={24}/></button></>}
    </div>
    <div className="viewer-content">
      {slides.length>1&&<div className="viewer-slides" aria-label="Render history"><div className="slide-dots">{slides.map((item,i)=><button key={item.id} className={item.id===cursor?'current':''} aria-label={i===0?'Show starting asset':`Show render ${item.assetNumber}`} aria-current={item.id===cursor?'true':undefined} onClick={()=>move(i)}>{i===0&&imageRoot?<ImageIcon size={12}/>:<span/>}</button>)}</div><span>{index===0?(family.root.kind==='image'?'Starting image':'Starting video'):`Render ${renderNumber}`} · {index+1} of {slides.length}</span></div>}
      <div className="viewer-actions">
        <button disabled={saving||!family} onClick={()=>void favorite()} aria-label={displayed.favorite?'Remove creation from favorites':'Save creation to favorites'} aria-pressed={displayed.favorite}><Heart size={18} fill={displayed.favorite?'currentColor':'none'}/>{displayed.favorite?'Saved':'Save'}</button>
        {render?.hd?<details className="viewer-download"><summary><Download size={18}/>Download<ChevronDown size={13}/></summary><div><a href={`${mediaUrl(render.media.id)}?download=1`} download>SD · Original</a><a href={`${mediaUrl(render.hd.id)}?download=1`} download>{Math.min(render.hd.width,render.hd.height)>=720?'HD · 720p':'AI enhanced'}</a></div></details>:<a href={`${mediaUrl(displayed.id)}?download=1`} download><Download size={18}/>Download</a>}
        <button className="viewer-delete" title={`Delete ${original?'video':'image'}`} aria-label={`Delete ${original?'video':'image'}`} onClick={()=>onDelete(original||family?.root||initialMedia)}><Trash2 size={17}/></button>
      </div>
      {blocked&&health&&<div className="viewer-warning" role="status">{blocked.message} <button onClick={()=>onSetup(blocked.target)}>{blocked.action}</button></div>}
      {missingReferences&&<p className="viewer-error" role="status">A saved reference image is unavailable. This video cannot be rendered again until it is restored.</p>}
      {referenceRoot&&<div className="viewer-references" aria-label="Reference images"><h4>Reference images</h4><div>{family.references?.map((ref,i)=>ref.media?<a key={ref.id} href={`${mediaUrl(ref.id)}?download=1`} download title={`Download reference ${i+1}`}><img src={mediaUrl(ref.id)} alt={`Reference ${i+1}`}/><span><Download size={12}/>Ref {i+1}</span></a>:<span key={ref.id}>Reference {i+1} unavailable</span>)}</div></div>}
      <AssetVideoControls root={family.root} selected={displayed} prompt={prompt} onPromptChange={setPrompt}
        onGenerate={()=>void generate()} onRedo={()=>void generate(true)} onUpscale={()=>void upscale()}
        disabled={disabled} busy={sending||submitting} upscaleDisabled={enhancedWithSelected||sending||submitting} upscalerName={upscalerName} defaultRecipeName={defaultPreset?.name}
        settings={<button type="button" className="video-settings-toggle" aria-label={`Video generation settings${!textRoot&&controls.seed!==undefined?`, fixed seed ${controls.seed}`:''}`} aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls={settingsOpen?'video-generation-settings':undefined} onClick={()=>setSettingsOpen(true)}>
        <SlidersHorizontal size={15}/><span>Video settings</span><small><span>{controls.duration}s · {controls.quality==='preview'?'480p':'720p'}</span>{!textRoot&&controls.seed!==undefined&&<span className="video-settings-seed" title="Used by Generate video. Clear it for a random seed. Redo always uses a new seed.">Seed {controls.seed}</span>}</small><ChevronRight size={14}/>
      </button>}
        recipes={imageRoot?<>{choices.filter(item=>item.videoStyle!=='custom').map(item=><button key={item.value} disabled={disabled} onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');void generate(false,item);}}><span><strong>{item.name}{item.isDefault?' (Default)':''}</strong><small>{item.description}</small></span><Play size={15}/></button>)}</>:undefined}/>
      {settingsOpen&&<SettingsDialog id="video-generation-settings" title="Video generation settings" onClose={()=>setSettingsOpen(false)}>
        <VideoRenderControls allowSeed={!textRoot} mode={generationMode} source={imageRoot} value={controls} health={health} disabled={sending||submitting} onChange={changeOptions} storageError={storageError}/>
      </SettingsDialog>}
      {linkedJob&&<button className="viewer-queue" onClick={()=>onQueue(linkedJob.id)}><Layers3 size={13}/>{active.length===1?'1 job in progress':`${active.length} jobs in progress`}<span>View job →</span></button>}
      {displayed.jobId&&<AssetJobLink key={displayed.jobId} jobId={displayed.jobId}/>}
      {imageRoot&&presetError&&<p className="viewer-error" role="alert">Motion presets could not be loaded. Check Settings → Recipes.</p>}
      {error&&<p className="viewer-error" role="alert">{error}</p>}
      <details ref={details} className="viewer-details"><summary>{displayed.origin==='upload'?'Asset details':'Generation details'}</summary>
        {prompts.map(row=><div key={row.label}><h4>{row.label}</h4><p>{row.text}</p></div>)}
        <div className="viewer-metadata">
          <h4>Technical details</h4>
          <dl><dt>Dimensions</dt><dd>{displayed.width} × {displayed.height}{displayed.duration?` · ${displayed.duration.toFixed(1)}s`:''}</dd><dt>Quality</dt><dd>{displayed.quality||'Original'}</dd>{displayed.origin!=='upload'&&<><dt>Seed</dt><dd>{displayed.seed}</dd></>}{displayed.runner&&<><dt>Runner</dt><dd>{displayed.runner}</dd></>}{displayed.imageModel&&<><dt>Image model</dt><dd>{imageModels[displayed.imageModel].name}</dd></>}{runnerTime&&<><dt>{timingMedia.id!==displayed.id?'SD render time':'Render time'}</dt><dd title={timingMedia.elapsedSeconds!==undefined?'Measured time to render and save this output; excludes queue wait and shared prompt enhancement.':'Elapsed rendering reported by Vpipe'}>{runnerTime}</dd></>}<dt>Created</dt><dd>{new Date(displayed.createdAt).toLocaleString()}</dd></dl>
          {original?.generation?.adapters&&<><h4>Adapters used</h4><pre>{JSON.stringify(original.generation.adapters,null,2)}</pre></>}
        </div>
      </details>
    </div>
  </section>;
}
