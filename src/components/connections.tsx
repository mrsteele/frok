'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Check, Plug, RefreshCw } from 'lucide-react';
import type { Health, Job } from '@/lib/types';
import { type ConnectionId } from '@/lib/service-config';
import { settingsAttention } from '@/lib/settings-attention';
import { ConnectionReadyDialog } from './connection-ready-dialog';
import { OllamaConnection } from './ollama-connection';
import { RunnerConnection } from './runner-connection';

export function Connections({health,jobs,checking,onRefresh,onPrepare,enhance,onEnhancementChange}:{health?:Health;jobs:Job[];checking:boolean;onRefresh:()=>void;onPrepare:(task:string)=>Promise<void>;enhance?:boolean;onEnhancementChange?:(enabled:boolean)=>void}) {
  const attention=settingsAttention(health);
  const [connected,setConnected]=useState<{id:ConnectionId;health:Health}>(),[notice,setNotice]=useState('');
  return <>
    <div id="setup-runner" className="settings-section-heading"><h3>Connect your local services</h3><p>Connect the tools on this computer, then choose the pipelines you want to use.</p></div>
    {health&&!attention.connected&&<p className="connection-required" role="status"><Plug size={16}/><span>Start here: connect at least one service to unlock pipeline selection.</span></p>}
    <div className="service-cards">{(['vpipe','comfyui'] as const).map(id=><RunnerConnection key={id} id={id} health={health} jobs={jobs} checking={checking} onRefresh={onRefresh} onPrepare={onPrepare} onConnected={health=>setConnected({id,health})}/>)}<OllamaConnection health={health} jobs={jobs} checking={checking} onRefresh={onRefresh} onPrepare={onPrepare} enhance={enhance} onEnhancementChange={onEnhancementChange}/></div>
    {notice&&<p className="connection-setup-notice" role="status"><Check size={15}/><span>{notice} <Link href="/settings/pipelines">View pipelines →</Link></span></p>}
    {connected&&<ConnectionReadyDialog connection={connected.id} health={connected.health} onClose={()=>setConnected(undefined)} onReady={(queued,enableEnhancement)=>{if(enableEnhancement)onEnhancementChange?.(true);setNotice(enableEnhancement?(queued.length?'Prompt model installation is queued. Optimizations will be ready after verification.':'Prompt optimizations are enabled.'):(queued.length?'Pipelines selected. Preparation is queued; each capability becomes available when ready.':'Pipeline choices saved. Installed dependencies are ready to use.'));onRefresh();}}/>}
    <div className="settings-save-row"><button className="settings-text-button" disabled={checking} onClick={onRefresh}><RefreshCw size={13} className={checking?'spin':''}/>Refresh connections</button>{attention.connected?<Link className="settings-button" href="/settings/pipelines">Choose pipelines →</Link>:<span className="settings-hint">Connect a service to continue</span>}</div>
    {health?.checks.filter(check=>['worker','ffmpeg'].includes(check.id)&&!check.ready).map(check=><p id={`setup-${check.id}`} key={check.id} className="service-warning" role="status">{check.name}: {check.detail}</p>)}
  </>;
}
