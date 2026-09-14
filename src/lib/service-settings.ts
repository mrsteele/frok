import { settings } from './db';
import { health } from './setup';
import { HttpError } from './request-security';
import { ollamaModelKey } from './ollama-models';
import { ollamaConfig } from './ollama-config';
import { defaultOllamaUrl, machineOllamaConfig } from './ollama-defaults';
import { connectionIds, connectionNames, modelConnection, type Connections, type ModelSelections, type Capability } from './service-config';
import type { Settings } from './types';
import { type RunnerLocations } from './runner-locations';

type Change = {connections?:Partial<Connections>;modelSelections?:Partial<ModelSelections>} & Partial<Pick<Settings,'runner'|'imageModel'|'ollamaModel'|'ollamaUrl'|'upscaler'>> & Partial<RunnerLocations>;
export async function validateServiceSettings(input:Change,signal:AbortSignal) {
  if(input.upscaler!==undefined||input.modelSelections?.upscale!=null)throw new HttpError(400,'Choose an upscaling pipeline in Settings → Generation.');
  const current=settings();
  const connections={...current.connections,...input.connections};
  const modelSelections={...current.modelSelections,prompt:current.promptModelSetting??null,
    ...(input.runner?{video:input.runner}:{}),...(input.imageModel?{image:input.imageModel}:{}),
    ...(input.ollamaModel?{prompt:input.ollamaModel}:{}),...input.modelSelections};
  const resolvedSelections={...modelSelections,prompt:modelSelections.prompt===''?(connections.ollama?machineOllamaConfig().model:null):modelSelections.prompt};
  const changed=(Object.keys(modelSelections) as Capability[]).filter(key=>resolvedSelections[key]!==current.modelSelections[key]&&resolvedSelections[key]!==null);
  const enabling=connectionIds.filter(id=>connections[id]&&!current.connections[id]);
  const checkingOllama=input.ollamaUrl!==undefined;
  const checkingRunners=[...(input.vpipeWorkdir!==undefined?['vpipe' as const]:[]),...(input.comfyDir!==undefined||input.comfyUrl!==undefined?['comfyui' as const]:[])];
  const choosingPrompt=!!(input.modelSelections?.prompt||input.ollamaModel);
  for(const capability of changed){
    const connection=modelConnection(capability,resolvedSelections);
    if(connection&&!connections[connection])throw new HttpError(409,`Configure ${connectionNames[connection]} in Settings → Services before choosing its models.`);
  }
  if(choosingPrompt&&!connections.ollama)throw new HttpError(409,'Connect Ollama before choosing a prompt model.');
  if(enabling.length||changed.some(key=>modelConnection(key,resolvedSelections))||choosingPrompt||checkingOllama||checkingRunners.length){
    const state=await health({...ollamaConfig(),url:input.ollamaUrl===undefined?current.ollamaUrl:input.ollamaUrl||defaultOllamaUrl()});
    for(const id of new Set([...enabling,...checkingRunners,...changed.map(key=>modelConnection(key,resolvedSelections)).filter(value=>value!==undefined),...(checkingOllama||choosingPrompt?['ollama' as const]:[])])){
      if(!state.connections?.[id].available)throw new HttpError(id==='ollama'&&changed.includes('prompt')?503:409,state.connections?.[id].detail||`Connect ${connectionNames[id]} first.`);
    }
    if(choosingPrompt&&!state.ollamaModels?.some(name=>ollamaModelKey(name)===ollamaModelKey(modelSelections.prompt!)))throw new HttpError(409,'That model is not installed or does not support text generation. Refresh the compatible model list.');
  }
  signal.throwIfAborted();
  const latest=settings();
  if(JSON.stringify([latest.connections,latest.modelSelections,latest.ollamaUrl])!==JSON.stringify([current.connections,current.modelSelections,current.ollamaUrl]))throw new HttpError(409,'Settings changed while checking services. Refresh and try again.');
  return {connections,modelSelections};
}

export async function checkSetupConnection(task:string) {
  if(task!=='ollama')throw new HttpError(400,'Choose a pipeline in Settings → Generation to prepare its dependencies.');
  const s=settings();
  const connection='ollama';
  if(connection){
    if(!s.connections[connection])throw new HttpError(409,`Configure ${connectionNames[connection]} in Settings → Services first.`);
    const state=await health();
    if(!state.connections?.[connection].available)throw new HttpError(409,state.connections?.[connection].detail||'Connect the service first.');
  }
}
