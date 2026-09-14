'use client';
import { useState } from 'react';
import { Layers3, Plug, SlidersHorizontal, Sparkles, WandSparkles } from 'lucide-react';
import Link from 'next/link';
import type { Health, Job } from '@/lib/types';
import { api } from '@/lib/client-api';
import { settingsPath, type SettingsSection } from '@/lib/navigation';
import { settingsAttention } from '@/lib/settings-attention';
import { VideoPresets } from './video-presets';
import { ResetLibrary } from './reset-library';
import { Connections } from './connections';
import { PipelineSettings } from './pipeline-settings';
import { PipelineLibrary } from './pipeline-library';
import { DesktopSettings } from './desktop-settings';
import { RuntimeSettings } from './runtime-settings';
import { CredentialSettings } from './credential-settings';
import { LegalNotice } from './legal-notice';

const tabs = [
  {id:'services',label:'Services',icon:Plug},
  {id:'generation',label:'Generation',icon:Layers3},
  {id:'recipes',label:'Recipes',icon:Sparkles},
  {id:'advanced',label:'Advanced',icon:SlidersHorizontal},
] as const;

export function Setup({health,jobs,section='services',checkingHealth=false,resetting=false,onResetting,onRefresh,enhance,onEnhancementChange,onOnboarding}:{
  health?:Health;jobs:Job[];section?:Exclude<SettingsSection,'welcome'>;checkingHealth?:boolean;
  resetting?:boolean;onResetting?:(pending:boolean)=>void;onRefresh:()=>void;
  enhance?:boolean;onEnhancementChange?:(enabled:boolean)=>void;onOnboarding?:()=>void;
}) {
  const [error,setError]=useState('');
  const attention=settingsAttention(health);
  async function prepare(task:string){setError('');try{await api('setup','POST',{task});await onRefresh();}catch(error){setError((error as Error).message);}}
  return <div className="settings-page">
    <nav inert={resetting} className="settings-tabs" aria-label="Settings sections">{tabs.map(tab=>{
      const badge=tab.id==='services'?attention.connection:tab.id==='generation'?attention.models:undefined;
      return <Link key={tab.id} href={settingsPath(tab.id)} aria-current={section===tab.id?'page':undefined}><tab.icon size={15}/>{tab.label}{badge&&<span className={'settings-attention '+badge} role="img" aria-label={badge==='error'?'Action required':'Needs attention'}/>}</Link>;
    })}</nav>
    <div className="settings-body">
      {section==='services'&&<>
        <div className="settings-section-heading settings-intro"><div><h3>Your local services</h3><p>Connect the tools you use. You can use more than one.</p></div>{onOnboarding&&<button className="settings-text-button" onClick={onOnboarding}><WandSparkles size={14}/>Quick setup</button>}</div>
        <Connections health={health} jobs={jobs} checking={checkingHealth} onRefresh={onRefresh} onPrepare={prepare} enhance={enhance} onEnhancementChange={onEnhancementChange}/>
      </>}
      {section==='generation'&&<PipelineSettings health={health} jobs={jobs} checking={checkingHealth} onRefresh={onRefresh}/>}
      {section==='recipes'&&<VideoPresets/>}
      {section==='advanced'&&<div className="advanced-settings">
        <div className="settings-section-heading"><h3>Make Frok your own</h3><p>Workflow files, access tokens, background tasks, and your library.</p></div>
        <PipelineLibrary health={health} checking={checkingHealth} onRefresh={onRefresh}/>
        <CredentialSettings/>
        <RuntimeSettings onRefresh={onRefresh}/>
        <DesktopSettings/>
        <ResetLibrary onPending={onResetting}/>
        <LegalNotice/>
      </div>}
      {error&&<p className="viewer-error" role="alert">{error}</p>}
    </div>
  </div>;
}
