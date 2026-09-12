'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Layers3, Loader2, X } from 'lucide-react';
import type { Job, Telemetry } from '@/lib/types';
import type { queueView } from '@/lib/queue-view';
import { jobProgress } from '@/lib/progress';
import { JobProgressBar } from './job-progress';
import { JobRuntime } from './job-runtime';
import { GpuGraph } from './gpu-graph';

export function SidebarQueue({queue,worker,telemetry,current,stopping,title,onStop}:{queue:ReturnType<typeof queueView>;worker?:boolean;telemetry?:Telemetry;current:boolean;stopping:boolean;title:string;onStop:(job:Job)=>void}) {
  const {running,pending,failed}=queue;
  const [expanded,setExpanded]=useState(false), container=useRef<HTMLDivElement>(null), toggle=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!expanded)return;
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!container.current?.contains(event.target))setExpanded(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setExpanded(false);toggle.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[expanded]);
  const state=worker===undefined?'connecting':worker===false?'offline':running?'running':pending.length?'queued':failed.length?'attention':'idle';
  const label={offline:'Offline',running:'Running',queued:'Queued',attention:'Needs attention',connecting:'Connecting',idle:'Idle'}[state];
  const job=running||pending[0], live=worker===true?running:undefined, progress=live?jobProgress(live):undefined;
  const caption=state==='offline'?'The queue worker is offline.':state==='connecting'?'Checking the local queue…':job?(running?.message||title):failed.length?'Inspect, retry, or clear failed jobs.':'Ready when you are.';
  const close=()=>setExpanded(false);
  return <div ref={container} className="sidebar-queue" data-state={state}>
    <button ref={toggle} className="queue-rail-toggle" aria-label={`Queue · ${label}${pending.length?` · ${pending.length} pending`:''}`} title={`Queue · ${label}`} aria-expanded={expanded} aria-controls="sidebar-queue-details" onClick={()=>setExpanded(value=>!value)}><Layers3 size={18}/><span className="queue-state-dot"/>{progress?.percent!==undefined&&<small>{progress.percent}%</small>}</button>
    <section id="sidebar-queue-details" className={`sidebar-queue-panel ${expanded?'expanded':''}`} aria-label="Generation queue status">
      <Link className="queue-panel-heading" href="/queue" onClick={close} aria-label={`Open generation queue · ${label}`} aria-current={current?'page':undefined}><Layers3 size={15}/><strong>Queue</strong><span className="queue-state"><span className="queue-state-dot"/>{label}</span><ChevronRight size={13}/></Link>
      <div className="queue-panel-body">
        <div className="queue-current">
          {job?<Link className="queue-job-link" href={`/queue/${encodeURIComponent(job.id)}`} onClick={close} title={title}><span className="queue-caption">{caption}</span>{live&&<><JobProgressBar job={live}/><JobRuntime job={live}/></>}</Link>:<p className="queue-caption">{caption}</p>}
          {running&&<button className="queue-stop icon-button" disabled={stopping} onClick={()=>{close();onStop(running);}} title="Stop current job" aria-label="Stop current job">{stopping?<Loader2 size={14} className="spin"/>:<X size={15}/>}</button>}
        </div>
        <Link href="/queue" onClick={close} className="queue-meta">{progress?.percent!==undefined&&`${progress.percent}% · `}{pending.length} pending{failed.length>0&&` · ${failed.length} failed`}</Link>
        {live&&<GpuGraph telemetry={telemetry} compact/>}
      </div>
    </section>
  </div>;
}
