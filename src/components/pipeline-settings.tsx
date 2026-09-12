'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Check, Download, Loader2 } from 'lucide-react';
import { pipelineKinds, type PipelineKind } from '@/lib/pipelines/schema';
import { capabilityNames } from '@/lib/service-config';
import { api } from '@/lib/client-api';
import type { Health, Job, SetupRequest } from '@/lib/types';

export function PipelineSettings({health,jobs,checking,onRefresh}:{health?:Health;jobs:Job[];checking:boolean;onRefresh:()=>void}) {
  const [busy,setBusy]=useState(''),[error,setError]=useState('');
  async function choose(kind:PipelineKind,value:string){setBusy(kind);setError('');try{await api('settings','PATCH',{pipelineSelections:{[kind]:value||null}});onRefresh();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function prepare(id:string){setBusy(id);setError('');try{await api('setup','POST',{pipelineId:id});onRefresh();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  return <>
    <div className="settings-section-heading"><h3>Choose your creative tools</h3><p>Choose a default pipeline for each kind of creation. You can switch pipelines when generating.</p></div>
    {health&&!health.worker&&<p className="service-warning" role="status">{health.checks.find(check=>check.id==='worker')?.detail||'Start the generation worker to prepare or run pipelines.'}</p>}
    <div className="service-cards">{pipelineKinds.map(kind=>{
      const value=health?.pipelineSelections?.[kind]||'',options=(health?.pipelines||[]).filter(p=>p.kind===kind),selected=options.find(p=>p.id===value),state=health?.capabilities?.[kind];
      const job=jobs.find(j=>j.kind==='setup'&&['queued','running'].includes(j.status)&&(j.request as SetupRequest).pipeline?.metadata.id===value);
      return <section className="service-card model-choice" id={`setup-${kind}`} key={kind}><header><div><h3>{capabilityNames[kind]}</h3><p>{kind==='image'?'Turn words into images.':kind==='video'?'Create a video or animate a starting frame.':kind==='reference'?'Bring several reference images into a video.':'Restore detail in a finished video.'}</p></div><span className={checking||busy?'settings-working':state?.ready?'settings-ready':value?'settings-pending':'service-idle'}>{checking||busy?<><Loader2 size={13} className="spin"/>Checking</>:state?.ready?<><Check size={13}/>Ready</>:value?'Setup needed':'Not configured'}</span></header>
        <label className="settings-field">{capabilityNames[kind]} pipeline<select aria-label={`${capabilityNames[kind]} pipeline`} value={value} disabled={!health||checking||!!busy} onChange={e=>void choose(kind,e.target.value)}><option value="">None</option>{value&&!selected&&<option value={value} disabled>Pipeline unavailable</option>}{options.map(p=><option key={p.id} value={p.id}>{p.name} · {p.runner==='comfyui'?'ComfyUI':p.runner==='vpipe'?'Vpipe':'Local'}</option>)}</select></label>
        {!options.length&&<p className="settings-hint">Connect a compatible service to see its pipelines. <Link href="/settings">Connections →</Link></p>}
        {selected?.description&&<p className="settings-hint">{selected.description}</p>}
        {value&&!state?.ready&&!checking&&<p className="service-warning">{state?.detail}</p>}
        {selected&&<div className="pipeline-dependencies"><h4>Pipeline details</h4>{['video','reference'].includes(kind)&&<p>{selected.controls.durations.join(', ')} seconds · {selected.supportsSource?'Starting images supported':'Text or references only'}</p>}<p>Revision {selected.revision.slice(0,12)}</p>{selected.missing.length>0&&<ul>{selected.missing.map(file=><li key={file}>{file}</li>)}</ul>}<p>Models, LoRAs, strengths and sampling are defined in the pipeline file.</p></div>}
        {job?<p className="settings-working"><Loader2 size={13} className="spin"/>{job.message}<Link href={`/queue/${job.id}`}>View preparation →</Link></p>:selected&&!state?.ready&&selected.canPrepare&&<footer><button className="settings-button" disabled={!!busy||checking||!health?.worker} onClick={()=>void prepare(value)}><Download size={14}/>{selected.prepareLabel||'Download & prepare'}</button></footer>}
      </section>;
    })}</div>
    {error&&<p className="viewer-error" role="alert">{error}</p>}
    <p className="settings-footnote">Add or edit workflows in your pipeline folder. Selections apply to this studio. <Link href="/utils">Pipeline utilities →</Link></p>
  </>;
}
