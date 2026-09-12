'use client';
import { useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import { connectionDefaults } from '@/lib/connection-defaults';
import { connectionNames, type ConnectionId } from '@/lib/service-config';
import type { Health, Job } from '@/lib/types';
import { ConfirmationDialog } from './confirmation-dialog';

export function ConnectionReadyDialog({connection,health,onClose,onReady}:{connection:ConnectionId;health:Health;onClose:()=>void;onReady:(jobs:Job[],enhance:boolean)=>void}) {
  const [enable,setEnable]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),prompt=connection==='ollama',plan=connectionDefaults(connection,health);
  const [model,setModel]=useState(plan.promptModel||'');
  async function accept() {
    if(lock.current)return;
    if(!enable){onClose();return;}
    lock.current=true;setBusy(true);setError('');
    try {
      const result=await api<{jobs:Job[]}>('setup/connection','POST',{connection,...(prompt?{promptModel:model}:{})});
      onReady(result.jobs,prompt);onClose();
    } catch(error){setError((error as Error).message);}
    finally{lock.current=false;setBusy(false);}
  }
  return <ConfirmationDialog title={`${connectionNames[connection]} is connected`} busy={busy} onClose={onClose} icon={<Check size={22}/>} tone="success">
    <p>{prompt?'Let Ollama enrich your prompts automatically.':'Your service is ready. Let’s get its models ready to create.'}</p>
    <label className="connection-default-choice"><input type="checkbox" checked={enable} disabled={busy} onChange={event=>setEnable(event.target.checked)}/><span><strong>{prompt?'Enable prompt optimizations':'Enable and prepare pipelines'}</strong><small>{prompt?'Make prompt enhancement your default.':'Select pipelines for available capabilities and queue their download and verification.'}</small></span></label>
    {prompt?<label className="settings-field">Ollama model<select value={model} disabled={busy} onChange={event=>setModel(event.target.value)}>{!model&&<option value="">No compatible models installed</option>}{health.ollamaModels?.map(name=><option key={name} value={name}>{name}</option>)}</select></label>:<div className="connection-model-summary">{plan.labels.map(label=><span key={label}>{label}</span>)}</div>}
    <small>{prompt?'Choose an installed text-generation model. Your models stay with Ollama.':'Your existing pipeline choices are kept. Prepared models are used immediately; missing files are downloaded one at a time.'}</small>
    {connection==='vpipe'&&<small>Fresh MiniMax preparation needs up to 250 GB of free space per model. Krea requires a Hugging Face token configured by the administrator.</small>}
    {!health.worker&&plan.tasks.length>0&&<p className="service-warning">The queue worker is offline. Setup will wait until Frok is started with npm run dev or npm start.</p>}
    {error&&<p className="viewer-error" role="alert">{error}</p>}
    <div className="delete-actions"><button className="secondary" disabled={busy} onClick={onClose}>Skip</button><button className="settings-button solid" disabled={busy||prompt&&enable&&!model} onClick={()=>void accept()}>{busy?<><Loader2 size={14} className="spin"/>Setting up…</>:!enable?'Done':prompt?'Enable optimizations':'Enable & prepare'}</button></div>
  </ConfirmationDialog>;
}
