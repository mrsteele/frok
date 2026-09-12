'use client';
import { PipelineSelect } from './pipeline-select';
import { selectedPipeline } from '@/lib/pipelines/schema';
import type { Generation, Health } from '@/lib/types';

export type VideoRenderPreferences=Pick<Generation,'duration'|'quality'|'seed'|'enhance'|'pipelineId'>;
export function VideoRenderControls({value,health,disabled,onChange,storageError,mode='video',source=true,allowSeed=true}:{allowSeed?:boolean;mode?:'video'|'reference';source?:boolean;value:VideoRenderPreferences;health?:Health;disabled:boolean;onChange:(change:Partial<VideoRenderPreferences>)=>void;storageError?:string}) {
  const pipeline=selectedPipeline(health,mode,value.pipelineId);
  return <fieldset className="video-render-controls" disabled={disabled}>
    <legend className="visually-hidden">Video generation settings</legend>
    <div className="settings-grid"><PipelineSelect kind={mode} value={value.pipelineId} source={source} health={health} disabled={disabled} onChange={onChange}/>
      <label>Duration<select aria-label="Video duration" value={value.duration} onChange={event=>onChange({duration:Number(event.target.value)})}>{(pipeline?.controls.durations||[6,8,10]).map(seconds=><option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
      <label>Resolution<select aria-label="Video resolution" value={value.quality} onChange={event=>onChange({quality:event.target.value as Generation['quality']})}><option value="preview" disabled={!!pipeline&&!pipeline.controls.qualities.includes("preview")}>480p · SD</option><option value="standard" disabled={!!pipeline&&!pipeline.controls.qualities.includes("standard")}>720p · HD</option></select></label>
      {allowSeed&&<label>Seed<input type="number" min={0} max={2147483647} step={1} placeholder="Random each time" value={value.seed??''} onChange={event=>onChange({seed:event.target.value===''?undefined:Number(event.target.value)})}/></label>}
    </div>
      <label className="toggle-row"><span><strong>Prompt enhancement</strong><small>{health?.ollama?'Add detail with your selected Ollama model.':value.enhance?'Saved as on. Finish Ollama setup or switch off to generate.':'Connect Ollama and choose a model to enable.'}</small></span><input type="checkbox" aria-label="Prompt enhancement" checked={value.enhance} disabled={!health?.ollama&&!value.enhance} onChange={event=>onChange({enhance:event.target.checked})}/></label>
      <p className="settings-hint">{source?'Proportions follow the starting image. ':''}Your choices are saved automatically. 720p renders directly at higher resolution; AI upscaling is available after rendering.</p>
    {storageError&&<p className="viewer-error" role="status">{storageError}</p>}
  </fieldset>;
}
