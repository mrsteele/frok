'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plug } from 'lucide-react';
import { PromptModelSettings } from './prompt-model-settings';
import { api } from '@/lib/client-api';
import type { Health, Job } from '@/lib/types';

export function OllamaConnection({health,jobs,checking,onRefresh,onPrepare,enhance,onEnhancementChange,onBusyChange,wizard=false}:{health?:Health;jobs:Job[];checking:boolean;onRefresh:()=>void;onPrepare:(task:string)=>Promise<void>;enhance?:boolean;onEnhancementChange?:(enabled:boolean)=>void;onBusyChange?:(busy:boolean)=>void;wizard?:boolean}) {
  const savedAddress=health?.connectionFields?.values.ollamaUrl||'';
  const [address,setAddress]=useState(savedAddress);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false);
  const [modelBusy,setModelBusy]=useState(false);
  useEffect(()=>{onBusyChange?.(busy||modelBusy);return()=>onBusyChange?.(false);},[busy,modelBusy,onBusyChange]);
  useEffect(()=>{setAddress(savedAddress);},[savedAddress]);
  const state=health?.connections?.ollama,dirty=!!health&&address.trim().replace(/\/+$/,'')!==savedAddress;
  const pending=busy||checking||!health,connected=!!state?.enabled&&state.available;
  const models=health?.ollamaModels||[];


  async function connect() {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      await api('settings','PATCH',{ollamaUrl:address,connections:{ollama:true}});
      const next=await api<Health>('health?refresh=1');
      setAddress(next.connectionFields?.values.ollamaUrl||'');
      setNotice(next.ollamaModels?.length?'':'Connected. Install a text-generation model in Ollama, then check again.');
      await onRefresh();
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
    {connected&&<PromptModelSettings embedded anchor={!wizard} health={health} jobs={jobs} checking={pending||dirty} onRefresh={onRefresh} onPrepare={onPrepare} enhance={enhance} onEnhancementChange={onEnhancementChange} onBusyChange={setModelBusy}/>}
  </section>;
}
