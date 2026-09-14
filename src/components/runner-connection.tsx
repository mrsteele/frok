'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plug, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client-api';
import { connectionNames } from '@/lib/service-config';
import type { Health, Runner } from '@/lib/types';

export function RunnerConnection({id,health,checking,onRefresh,onBusyChange}:{id:Runner;health?:Health;checking:boolean;onRefresh:()=>void;onBusyChange?:(busy:boolean)=>void}) {
  const savedFolder=(id==='vpipe'?health?.connectionFields?.values.vpipeWorkdir:health?.connectionFields?.values.comfyDir)||'';
  const savedAddress=health?.connectionFields?.values.comfyUrl||'';
  const [folder,setFolder]=useState(savedFolder),[address,setAddress]=useState(savedAddress);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  useEffect(()=>{setFolder(savedFolder);},[savedFolder]);
  useEffect(()=>{setAddress(savedAddress);},[savedAddress]);
  const state=health?.connections?.[id],connected=!!state?.enabled&&state.available;
  const dirty=!!health&&(folder.trim()!==savedFolder||(id==='comfyui'&&address.trim().replace(/\/+$/,'')!==savedAddress));
  const pending=busy||checking||!health;
  function edit(){setError('');setNotice('');}
  async function save(disconnect=false) {
    if(lock.current)return;
    lock.current=true;setBusy(true);edit();
    try {
      await api('settings','PATCH',disconnect?{connections:{[id]:false}}:{connections:{[id]:true},...(id==='vpipe'?{vpipeWorkdir:folder}:{comfyDir:folder,comfyUrl:address})});
      const next=await api<Health>('health?refresh=1');
      if(!disconnect){setFolder((id==='vpipe'?next.connectionFields?.values.vpipeWorkdir:next.connectionFields?.values.comfyDir)||'');setAddress(next.connectionFields?.values.comfyUrl||'');}
      setNotice(disconnect?'Disconnected.':dirty?'Connection saved and checked. Pipeline readiness refreshed.':'Connection checked. Pipeline readiness refreshed.');
      await onRefresh();
    }catch(error){setError((error as Error).message);onRefresh();}
    finally{lock.current=false;setBusy(false);}
  }
  const defaults=health?.connectionFields?.defaults;
  return <section className="service-card">
    <header><div><h3>{connectionNames[id]}</h3><p>{id==='vpipe'?'Images and video through native Metal on Apple Silicon.':'Use pipelines and models from your local ComfyUI installation.'}</p></div>
      <span className={pending?'settings-working':dirty?'settings-pending':connected?'settings-ready':state?.enabled?'settings-pending':'service-idle'}>{pending?<><Loader2 size={13} className="spin"/>Checking</>:dirty?'Unsaved changes':connected?<><Check size={13}/>Connected</>:state?.enabled?'Offline':'Not connected'}</span>
    </header>
    <form onSubmit={event=>{event.preventDefault();void save();}}>
      {id==='comfyui'&&<label className="settings-field">Service address<input type="url" disabled={busy} value={address} placeholder={defaults?.comfyUrl||'http://127.0.0.1:8000'} spellCheck={false} autoCapitalize="none" onChange={event=>{setAddress(event.target.value);edit();}}/><small>Start ComfyUI first. Desktop normally uses port 8000; manual installations use 8188.</small></label>}
      <label className="settings-field">{id==='vpipe'?'Model workspace':'ComfyUI folder'}<input disabled={busy} value={folder} placeholder={id==='vpipe'?defaults?.vpipeWorkdir||'~/vpipe':defaults?.comfyDir||'~/Documents/ComfyUI'} spellCheck={false} autoCapitalize="none" onChange={event=>{setFolder(event.target.value);edit();}}/><small>{id==='vpipe'?'Leave blank to use the default workspace. New model downloads use this location.':'Leave blank to use the default folder, or choose the folder containing models, input and output.'}</small></label>
      {(folder||id==='comfyui'&&address)&&<button type="button" className="settings-text-button connection-defaults" disabled={pending} onClick={()=>{setFolder('');if(id==='comfyui')setAddress('');edit();}}>Use default location</button>}
      {!dirty&&state?.enabled&&!state.available&&<p className="service-warning">{state.detail}</p>}
      {error&&<p className="viewer-error" role="alert">{error}</p>}
      {notice&&!error&&<p className="settings-hint" role="status">{notice}</p>}
      <footer>
        <button type="submit" className="settings-button" disabled={pending}>{busy?<><Loader2 size={13} className="spin"/>Checking…</>:dirty?'Save & check':connected?<><RefreshCw size={13}/>Check connection</>:<><Plug size={13}/>Connect {connectionNames[id]}</>}</button>
        {state?.enabled&&<button type="button" className="settings-text-button" disabled={pending} onClick={()=>void save(true)}>Disconnect</button>}
        <a className="settings-text-button" href={id==='vpipe'?'https://vpipe.ai/':'https://www.comfy.org/download'} target="_blank" rel="noreferrer">Get {connectionNames[id]} ↗</a>
      </footer>
    </form>
  </section>;
}
