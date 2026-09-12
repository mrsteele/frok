'use client';
import { useState } from 'react';
import { ArrowRight, Check, Layers3, Monitor, Sparkles } from 'lucide-react';
import { BrandMark } from './brand-mark';
import Link from 'next/link';
import type { Health, Job } from '@/lib/types';
import { api } from '@/lib/client-api';
import { settingsPath, type SettingsSection } from '@/lib/navigation';
import type { SetupTarget } from '@/lib/readiness';
import { VideoPresets } from './video-presets';
import { settingsAttention } from '@/lib/settings-attention';
import { ResetLibrary } from './reset-library';
import { Connections } from './connections';
import { PipelineSettings } from './pipeline-settings';
import { PipelineLibrary } from './pipeline-library';
import { DesktopSettings } from './desktop-settings';
import { RuntimeSettings } from './runtime-settings';
import { CredentialSettings } from './credential-settings';
import { LegalNotice } from './legal-notice';

export function Setup({health,jobs,target,section=target&&!['worker','runner','ffmpeg','prompt'].includes(target)?'pipelines':'generate',checkingHealth=false,resetting=false,onResetting,onRefresh,onClose,enhance,onEnhancementChange,onNavigate=path=>window.location.assign(path)}:{health?:Health;checkingHealth?:boolean;jobs:Job[];section?:SettingsSection;target?:SetupTarget;resetting?:boolean;onResetting?:(pending:boolean)=>void;onRefresh:()=>void;onClose?:()=>void;enhance?:boolean;onEnhancementChange?:(enabled:boolean)=>void;onNavigate?:(path:string)=>void}) {
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState<{text:string;error?:boolean}>();
  async function prepare(task:string){
    if(busy)return;
    setBusy(task);setNotice(undefined);
    try{await api('setup','POST',{task});setNotice({text:'Added to the setup queue.'});onRefresh();}catch(error){setNotice({text:(error as Error).message,error:true});}finally{setBusy('');}
  }
  async function finish(){
    setBusy('finish');
    try{await api('settings','PATCH',{setupDismissed:true});onRefresh();if(onClose)onClose();else onNavigate('/');}catch(error){setNotice({text:(error as Error).message,error:true});}finally{setBusy('');}
  }
  const tabs=[{id:'generate',label:'Generate',icon:Monitor},{id:'pipelines',label:'Pipelines',icon:Layers3},{id:'recipes',label:'Recipes',icon:Sparkles}] as const;
  const attention=settingsAttention(health),{connected}=attention;
  const configured=Object.values(health?.capabilities||{}).some(capability=>capability.configured);
  const ready=(['image','video','reference'] as const).some(capability=>health?.capabilities?.[capability].ready);
  const preparing=jobs.some(job=>job.kind==='setup'&&['queued','running'].includes(job.status));
  return <div className={`settings-page ${section==='welcome'?'welcome-page':''}`}>
    <nav inert={resetting} className="settings-tabs" aria-label="Settings sections">{tabs.map(tab=>{
      const badge=tab.id==='generate'?attention.connection:tab.id==='pipelines'?attention.models:undefined;
      return <Link key={tab.id} href={settingsPath(tab.id)} aria-current={section===tab.id?'page':undefined} title={badge?'Needs attention':undefined}><tab.icon size={15}/>{tab.label}{badge&&<span className={`settings-attention ${badge}`} role="img" aria-label={badge==='error'?'Action required':'Needs attention'}/>}</Link>;
    })}</nav>
    <div className="settings-body">
      {section==='generate'&&<>
        <Connections health={health} jobs={jobs} checking={checkingHealth} onRefresh={onRefresh} onPrepare={prepare} enhance={enhance} onEnhancementChange={onEnhancementChange}/>
        <RuntimeSettings onRefresh={onRefresh} ollamaUrl={health?.ollamaUrl}/><CredentialSettings/><DesktopSettings/><ResetLibrary onPending={onResetting}/>
      </>}
      {section==='pipelines'&&<><PipelineLibrary health={health} checking={checkingHealth} onRefresh={onRefresh}/>{attention.modelsLocked?<div className="settings-empty" role="status"><Monitor size={24}/><h3>Connect a service first</h3><p>{attention.connectionMessage}</p><Link className="settings-button solid" href="/settings">Set up connections →</Link></div>:<PipelineSettings health={health} jobs={jobs} checking={checkingHealth} onRefresh={onRefresh}/>}</>}
      {section==='recipes'&&<VideoPresets/>}
      {section==='welcome'&&<div className="welcome-intro">
        <div className="welcome-mark"><BrandMark size={32}/></div><h3>Your studio.<br/>Your choice of tools.</h3>
        <p>Frok starts with generation turned off. Connect a local service and accept its suggested setup to get started.</p>
        <ol className="welcome-steps">
          <li><span>{connected?<Check size={15}/>:1}</span><div><strong>Connect your services</strong><p>Use Vpipe, ComfyUI, Ollama, or a combination. Each connection is independent.</p><Link href="/settings">{connected?'Manage connections':'Connect a service'} →</Link></div></li>
          <li><span>{configured?<Check size={15}/>:2}</span><div><strong>Accept the suggested setup</strong><p>The connection dialog selects pipelines and queues their preparation. For Ollama, choose an installed text model in its connection card and turn on Use Prompt Enhancement if desired.</p><Link href={connected?'/settings/pipelines':'/settings'}>{connected?'Review pipelines':'Connect a service first'} →</Link></div></li>
          <li><span>{ready?<Check size={15}/>:3}</span><div><strong>Prepare, then create</strong><p>Follow downloads in the queue. Each capability becomes ready independently; you don’t need to set up everything.</p><Link href={ready?'/':preparing?'/queue':connected?'/settings/pipelines':'/settings'}>{ready?'Open your studio':preparing?'View setup progress':connected?'Prepare pipelines':'Connect a service first'} →</Link></div></li>
        </ol>
        <div className="welcome-note"><Monitor size={16}/><p>Downloads need internet and disk space. Once prepared, generation runs locally. Keep Frok running and your computer awake while the queue works.</p></div>
      </div>}
      {(section==='generate'||section==='welcome')&&<LegalNotice/>}
    </div>
    {(notice||section==='welcome')&&<footer className="settings-footer">{notice&&<div className={notice.error?'is-error':''} role={notice.error?'alert':'status'}>{notice.text}</div>}{section==='welcome'&&<div className="welcome-actions"><button className="welcome-later" disabled={!!busy} onClick={()=>void finish()}>{ready?'Start creating':'Set up later'}</button><Link className="settings-button solid" href={ready?'/':preparing?'/queue':connected?'/settings/pipelines':'/settings'}>{ready?'Open your studio':preparing?'View setup progress':connected?'Review pipelines':'Connect a service'}<ArrowRight size={13}/></Link></div>}</footer>}
  </div>;
}
