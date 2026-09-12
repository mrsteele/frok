import { ollamaModelKey } from './ollama-models';
import { emptyModelSelections, type ConnectionId } from './service-config';
import type { Health } from './types';

// Shared by the success dialog and server. Fill empty capabilities, preserving
// existing choices, including choices assigned to another service.
export function connectionDefaults(id:ConnectionId, health:Health) {
  const selections={...emptyModelSelections,...health.modelSelections};
  const tasks:string[]=[], labels:string[]=[];
  let promptModel:string|undefined;
  if(id==='ollama') {
    const installed=health.ollamaModels||[];
    promptModel=installed.find(model=>ollamaModelKey(model)===ollamaModelKey(selections.prompt||''))
      || installed.find(model=>ollamaModelKey(model)===ollamaModelKey(health.recommendedPromptModel||'')) || installed[0]
      || (health.ollamaManaged?selections.prompt||health.recommendedPromptModel:undefined);
    if(promptModel) {
      if(installed.some(model=>ollamaModelKey(model)===ollamaModelKey(promptModel!)))selections.prompt=promptModel;
      else tasks.push('ollama');
      labels.push(promptModel);
    }
  } else if(health.pipelines){
    for(const kind of ['image','video','reference'] as const){const selected:import('./pipelines/schema').PipelineStatus|undefined=health.pipelines.find(p=>p.id===health.pipelineSelections?.[kind])||health.pipelines.find(p=>p.kind===kind&&p.runner===id&&p.default);if(selected?.runner===id)labels.push(selected.name);}
  }
  const missing=tasks.filter(task=>!health.models[task]);
  return {selections,tasks:missing,labels,promptModel};
}
