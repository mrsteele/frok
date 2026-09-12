'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Download, Loader2, Plug } from 'lucide-react';
import { PromptModelSettings } from './prompt-model-settings';
import { api } from '@/lib/client-api';
import type { Health, Job, SetupRequest } from '@/lib/types';

export function OllamaConnection({health,jobs,checking,onRefresh,onPrepare,enhance,onEnhancementChange}:{health?:Health;jobs:Job[];checking:boolean;onRefresh:()=>void;onPrepare:(task:string)=>Promise<void>;enhance?:boolean;onEnhancementChange?:(enabled:boolean)=>void}) {
  const savedAddress=health?.connectionFields?.values.ollamaUrl||'';
  const [address,setAddress]=useState(savedAddress);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false);
  useEffect(()=>{setAddress(savedAddress);},[savedAddress]);
  const state=health?.connections?.ollama,dirty=!!health&&address.trim().replace(/\/+$/,'')!==savedAddress;
  const pending=busy||checking||!health,connected=!!state?.enabled&&state.available;
  const models=health?.ollamaModels||[];
  const installing=jobs.find(job=>job.kind==='setup'&&(job.request as SetupRequest).task==='ollama-runtime'&&['running','queued'].includes(job.status));

  async function connect() {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      await api('settings','PATCH',{ollamaUrl:address,connections:{ollama:true}});
      const next=await api<Health>('health?refresh=1');
      setAddress(next.connectionFields?.values.ollamaUrl||'');
      setNotice(next.ollamaModels?.length?`Connected · ${next.ollamaModels.length} compatible models found.`:'Connected. Install a text-generation model in Ollama, then check again.');
      onRefresh();
    }catch(error){setError((error as Error).message);onRefresh();}
    finally{lock.current=false;setBusy(false);}
  }
  async function disconnect() {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{await api('settings','PATCH',{connections:{ollama:false}});onRefresh();}
    catch(error){setError((error as Error).message);}
    finally{lock.current=false;setBusy(false);}
  }

  return <section className="service-card">
    <header><div><h3>Ollama</h3><p>Use your installed language models to enrich prompts.</p></div>
      <span className={pending?'settings-working':dirty?'settings-pending':connected?'settings-ready':state?.enabled?'settings-pending':'service-idle'}>
        {pending?<><Loader2 size={13} className="spin"/>Checking</>:dirty?'Unsaved address':connected?<><Check size={13}/>Connected</>:state?.enabled?'Offline':'Not connected'}
      </span>
    </header>
    <form onSubmit={event=>{event.preventDefault();void connect();}}>
      <label className="settings-field">Service address<input type="url" value={address} disabled={busy} placeholder={health?.connectionFields?.defaults.ollamaUrl||'http://127.0.0.1:11434'} spellCheck={false} autoCapitalize="none" onChange={event=>{setAddress(event.target.value);setError('');setNotice('');}}/><small>Leave blank for the default address. Open Ollama on this computer, then connect. Its installed text-generation models will be available to choose.</small></label>
      {!dirty&&connected&&<p className="settings-hint">{models.length?`${models.length} compatible ${models.length===1?'model':'models'} available.`:'No compatible text-generation models are installed.'}</p>}
      {!dirty&&state?.enabled&&!state.available&&<p className="service-warning">{state.detail}</p>}
      {error&&<p className="viewer-error" role="alert">{error}</p>}
      {notice&&!error&&<p className="settings-hint" role="status">{notice}</p>}
      <footer><button type="submit" className="settings-button" disabled={pending}>{busy?<><Loader2 size={13} className="spin"/>Checking…</>:connected?dirty?'Save & connect':'Check connection':<><Plug size={13}/>Connect Ollama</>}</button>
        {state?.enabled&&<button type="button" className="settings-text-button" disabled={pending} onClick={()=>void disconnect()}>Disconnect</button>}
        <a className="settings-text-button" href="https://ollama.com/download" target="_blank" rel="noreferrer">Get Ollama ↗</a>
      </footer>
    </form>
    <PromptModelSettings embedded health={health} jobs={jobs} checking={pending||dirty} onRefresh={onRefresh} onPrepare={onPrepare} enhance={enhance} onEnhancementChange={onEnhancementChange}/>
    {health?.ollamaManaged&&<div className="service-details"><h4>Frok-managed runtime</h4><p className="settings-hint">This workspace is configured to start a separate Ollama runtime. Its models stay in the workspace. Restart Frok after installing the runtime.</p>
      {installing?<p className="settings-working"><Loader2 size={13} className="spin"/>{installing.message} <Link href={`/queue/${installing.id}`}>View job →</Link></p>:!health.ollamaInstalled&&health.platform.startsWith('darwin ')&&<button className="settings-text-button" disabled={pending||!health.worker} onClick={()=>void onPrepare('ollama-runtime')}><Download size={13}/>Install runtime</button>}
    </div>}
  </section>;
}
