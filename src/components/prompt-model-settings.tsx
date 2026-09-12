'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Download, Loader2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import { ollamaModelKey } from '@/lib/ollama-models';
import type { Health, Job, SetupRequest } from '@/lib/types';

const sameModel=(a:string,b:string)=>ollamaModelKey(a)===ollamaModelKey(b);

export function PromptModelSettings({health,jobs,checking,onRefresh,onPrepare,embedded=false,enhance=false,onEnhancementChange}:{health?:Health;jobs:Job[];checking:boolean;onRefresh:()=>void;onPrepare:(task:string)=>Promise<void>;embedded?:boolean;enhance?:boolean;onEnhancementChange?:(enabled:boolean)=>void}) {
  const setting=health?.promptModelSetting;
  const saved=setting===null?'__off__':setting??health?.modelSelections?.prompt??'';
  const effective=health?.ollamaModel||health?.recommendedPromptModel||'';
  const [value,setValue]=useState(saved),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>setValue(saved),[saved]);
  const state=health?.capabilities?.prompt;
  const pending=checking||busy||value!==saved||!health;
  const connected=!!health?.connections?.ollama.enabled&&health.connections.ollama.available;
  const models=connected?health?.ollamaModels||[]:[];
  const options=models.map(model=>({label:model,value:saved&&sameModel(model,saved)?saved:model}));
  const job=jobs.find(job=>job.kind==='setup'&&(job.request as SetupRequest).task==='ollama'&&['running','queued'].includes(job.status));
  const needsDownload=saved!=='__off__'&&(!models.length||!models.some(model=>sameModel(model,effective)));

  async function choose(model:string) {
    setValue(model);setBusy(true);setError('');
    try{await api('settings','PATCH',{modelSelections:{prompt:model==='__off__'?null:model}});onRefresh();}
    catch(error){setError((error as Error).message);setValue(saved);}
    finally{setBusy(false);}
  }

  return <section id="setup-prompt" className={embedded?'ollama-model-settings':'service-card model-choice'}>
    <header><div><h3>Prompt enhancement</h3><p>Enrich prompts with an installed Ollama text-generation model.</p></div>
      <span className={pending?'settings-working':state?.ready?'settings-ready':state?.configured?'settings-pending':'service-idle'}>
        {pending?<><Loader2 size={13} className="spin"/>Checking</>:state?.ready?<><Check size={13}/>Ready</>:state?.configured?'Setup needed':'Not configured'}
      </span>
    </header>
    <label className="settings-field">Ollama model<select value={value} className={!value?'default-placeholder':undefined} disabled={pending||!connected} onChange={event=>void choose(event.target.value)}>
      <option value="">Default · {health?.recommendedPromptModel||'Default Ollama model'}</option>
      <option value="__off__">None · Enhancement off</option>
      {!!value&&value!=='__off__'&&!options.some(option=>option.value===value)&&<option value={value} disabled>{value} · Connection or model unavailable</option>}
      {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </select><small>Leave on Default to use the default model when it is installed, or choose another installed model.</small></label>
    {!connected&&<p className="settings-hint">Connect Ollama to choose a model. <Link href="/settings">Configure connections →</Link></p>}
    {connected&&!models.length&&<p className="settings-hint">No compatible text-generation models are installed. Install one in Ollama, then refresh this list.</p>}
    {!pending&&state?.configured&&!state.ready&&<p className="service-warning">{state.detail}</p>}
    {connected&&<button className="settings-text-button" disabled={pending} onClick={onRefresh}>Refresh installed models</button>}
    {job?<p className="settings-working"><Loader2 size={13} className="spin"/>{job.message} <Link href={`/queue/${job.id}`}>View job →</Link></p>
      :connected&&health?.ollamaManaged&&needsDownload&&<footer><p className="settings-hint">Download {effective}. Enhancement becomes available once the selected model is installed.</p>
        <button className="settings-button" disabled={pending||!health?.worker} onClick={async()=>{setBusy(true);try{await onPrepare('ollama');}finally{setBusy(false);}}}><Download size={13}/>Download prompt model</button>
      </footer>}
    {onEnhancementChange&&<label className="prompt-enhancement-choice"><input type="checkbox" checked={enhance} disabled={!health?.ollama&&!enhance} onChange={event=>onEnhancementChange(event.target.checked)}/><span>Use Prompt Enhancement</span></label>}
    {error&&<p className="viewer-error" role="alert">{error}</p>}
  </section>;
}
