import { capabilityNames, connectionNames, modelConnection, type ModelSelections, type Capability, type CapabilityStatus, type ConnectionId, type ConnectionStatus } from './service-config';
import { imageModels } from './image-models';
import type { ImageHealth } from './types';

export function capabilityStatus(selections:ModelSelections,connections:Record<ConnectionId,ConnectionStatus>,models:Record<string,boolean>,image:ImageHealth|undefined,promptReady:boolean,videoTools:boolean,upscaleReady:boolean) {
  return Object.fromEntries((Object.keys(selections) as Capability[]).map(capability=>{
    const selected=selections[capability],connection=modelConnection(capability,selections);
    const task=capability==='image'&&selections.image?image?.setupTask||imageModels[selections.image].task
      :capability==='video'||capability==='reference'?`${selected==='comfyui'?'comfy-':''}${capability}`
      :capability==='prompt'?'ollama':selected==='seedvr2'?'seedvr2':'upscale';
    let detail='',ready=false;
    if(!selected)detail=`Choose a model for ${capabilityNames[capability].toLowerCase()} in Settings → Generation.`;
    else if(connection&&!connections[connection].enabled)detail=`Enable ${connectionNames[connection]} in Settings → Services.`;
    else if(connection&&!connections[connection].available)detail=connections[connection].detail;
    else if(['video','reference','upscale'].includes(capability)&&!videoTools)detail='Video tools need setup in Settings → Services.';
    else {
      ready=capability==='image'?!!image?.ready:capability==='prompt'?promptReady:capability==='upscale'?upscaleReady:!!models[task];
      if(!ready)detail=capability==='image'?image?.detail||`Download and prepare ${imageModels[selections.image!].name}.`
        :capability==='prompt'?'Choose an installed text-generation model for prompt enhancement.'
        :`Download and prepare the selected ${capabilityNames[capability].toLowerCase()} model.`;
    }
    return [capability,{configured:!!selected,ready,detail,task: selected?task:undefined,connection} satisfies CapabilityStatus];
  })) as Record<Capability,CapabilityStatus>;
}
