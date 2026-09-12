'use client';
import type { Generation,Health } from '@/lib/types';
import { selectedPipeline, type PipelineKind } from '@/lib/pipelines/schema';
export function PipelineSelect({kind,value,health,source=false,disabled,onChange}:{kind:PipelineKind;value?:string;health?:Health;source?:boolean;disabled?:boolean;onChange:(change:Partial<Generation>)=>void}){
 const options=(health?.pipelines||[]).filter(p=>p.kind===kind&&(!source||p.supportsSource));
 const defaultId=health?.pipelineSelections?.[kind],selectedId=value||defaultId||'';
 return <label className="pipeline-select">Pipeline<select value={selectedId} disabled={disabled||!health} onChange={e=>{const id=e.target.value===defaultId?undefined:e.target.value||undefined,p=selectedPipeline(health,kind,id);onChange({pipelineId:id,...(p?{quality:p.controls.qualities[0],duration:p.controls.durations[0]||6,aspect:p.controls.aspects[0]}:{})});}}>
  {!selectedId&&<option value="" disabled>Choose a pipeline</option>}
  {!!selectedId&&!options.some(p=>p.id===selectedId)&&<option value={selectedId} disabled>{value?'Pipeline unavailable':'Default pipeline unavailable'}</option>}
  {options.map(p=><option key={p.id} value={p.id}>{p.name}{p.id===defaultId?' (Default)':''}{p.ready?'':' · Setup needed'}</option>)}
 </select></label>;
}
