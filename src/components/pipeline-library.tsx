'use client';
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { Health } from '@/lib/types';
import type { PipelineLibrary as Library } from '@/lib/pipelines/location';
import { pipelineRunners } from '@/lib/pipelines/schema';
import { connectionNames } from '@/lib/service-config';
import { ConfirmationDialog } from './confirmation-dialog';

export function PipelineLibrary({health,checking,onRefresh}:{health?:Health;checking:boolean;onRefresh:()=>void}) {
  const [library,setLibrary]=useState(health?.pipelineLibrary),[folder,setFolder]=useState(health?.pipelineLibrary?.configured||'');
  const [busy,setBusy]=useState(false),[resetting,setResetting]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false);
  useEffect(()=>{if(health?.pipelineLibrary)setLibrary(health.pipelineLibrary);},[health?.pipelineLibrary]);
  useEffect(()=>{setFolder(health?.pipelineLibrary?.configured||'');},[health?.pipelineLibrary?.configured]);
  async function run(action:'save'|'scan'|'reset') {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      const result=action==='reset'?await api<Library>('pipelines/reset','POST',{confirm:'RESET DEFAULT PIPELINES'}):action==='save'?await api<Library>('pipelines/library','PATCH',{path:folder}):await api<Library>('pipelines/library');
      setLibrary(result);if(action==='save')setFolder(result.configured);
      setNotice(action==='reset'?`Default pipelines restored at ${result.defaultPath}.`:action==='save'?'Workflow folder saved and scanned.':'Pipeline folder refreshed.');
      setResetting(false);onRefresh();
    }catch(error){setError((error as Error).message);}
    finally{lock.current=false;setBusy(false);}
  }
  const pending=busy||checking,dirty=folder.trim()!==(library?.configured||'');
  return <section className="service-card pipeline-library" id="workflow-files" aria-labelledby="pipeline-library-title">
    <header><div><span className="pipeline-library-eyebrow">On your device</span><h3 id="pipeline-library-title">Workflow files</h3><p>One home for your workflows. Edit the files on your device, then refresh to pick up changes.</p></div><span className="pipeline-library-icon"><FolderOpen size={22}/></span></header>
    <form onSubmit={event=>{event.preventDefault();void run('save');}}>
      <label className="settings-field">Workflow folder<input value={folder} disabled={busy} placeholder={library?.defaultPath||'~/frok/pipelines'} spellCheck={false} autoCapitalize="none" onChange={event=>{setFolder(event.target.value);setError('');setNotice('');}}/><small>Leave empty to use {library?.defaultPath||'~/frok/pipelines'}.</small></label>
      <footer>{dirty&&<button className="settings-button" type="submit" disabled={pending}>Save & scan</button>}<button type="button" className="settings-text-button" disabled={pending||dirty} onClick={()=>void run('scan')}><RefreshCw size={13} className={busy?'spin':''}/>Refresh workflows</button>{folder&&<button type="button" className="settings-text-button" disabled={pending} onClick={()=>setFolder('')}>Use default folder</button>}</footer>
    </form>
    {library&&<><p className="pipeline-active-path">Reading from <code>{library.path}</code></p><div className="pipeline-audit-counts" aria-label="Detected workflows">{pipelineRunners.map(runner=><span key={runner}><strong>{library.counts[runner]}</strong> {connectionNames[runner]} workflows</span>)}</div>
      {!!library.errors.length&&<div className="service-warning" role="status"><strong>Some definitions could not be loaded</strong><ul>{library.errors.map(item=><li key={item}>{item}</li>)}</ul></div>}
      {!!library.warnings.length&&<div className="service-warning"><strong>Preparation notes</strong><ul>{library.warnings.map(item=><li key={item}>{item}</li>)}</ul></div>}
      {!library.errors.length&&!library.warnings.length&&<p className="settings-hint">{Object.values(library.counts).some(Boolean)?'Detected definitions look good. Choose defaults and check readiness in Generation.':'No pipelines detected. Add workflow folders here, or restore the defaults.'}</p>}
    </>}
    <div className="pipeline-reset-row"><button className="settings-text-button" disabled={pending||!library} onClick={()=>{setError('');setResetting(true);}}><RotateCcw size={13}/>Reset default pipelines</button><small>Restore the pipelines included with Frok.</small></div>
    {error&&!resetting&&<p className="viewer-error" role="alert">{error}</p>}{notice&&<p className="settings-hint" role="status">{notice}</p>}
    {resetting&&<ConfirmationDialog title="Reset default pipelines?" busy={busy} onClose={()=>setResetting(false)} icon={<RotateCcw size={22}/>}><p>This deletes all files in <strong>{library?.defaultPath}</strong> and replaces them with Frok’s bundled pipelines.</p><p>Custom pipelines and edits inside that folder will be lost. Other pipeline locations, models, images and videos are kept. This cannot be undone.</p>{error&&<p className="delete-warning" role="alert">{error}</p>}<div className="delete-actions"><button className="secondary" autoFocus disabled={busy} onClick={()=>setResetting(false)}>Cancel</button><button className="delete-confirm" disabled={busy} onClick={()=>void run('reset')}>{busy?'Restoring…':'Reset pipelines'}</button></div></ConfirmationDialog>}
  </section>;
}
