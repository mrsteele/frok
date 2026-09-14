import type { Graph } from '../comfyui';
import type { PipelineMetadata } from './schema';

export type ComfyNodeInfo = Record<string,{input?:{required?:Record<string,unknown[]>;optional?:Record<string,unknown[]>}}>;
export function comfyOptions(info:ComfyNodeInfo,type:string,field:string):unknown[]|undefined {
  const input=info[type]?.input?.required?.[field]??info[type]?.input?.optional?.[field];
  if(Array.isArray(input?.[0]))return input[0];
  // V3 nodes (including current SeedVR2) use a typed COMBO with options
  // in its configuration; older nodes put the options in the first slot.
  const config=input?.[1];
  if(input?.[0]==='COMBO'&&config&&typeof config==='object'&&'options' in config&&Array.isArray(config.options))return config.options;
}

// Device controls explicitly declared in metadata follow the connected service,
// not the OS running Frok. Other workflow settings stay administrator-controlled.
export function resolveComfyDevices(graph:Graph,metadata:PipelineMetadata,info:ComfyNodeInfo) {
  for(const binding of metadata.bindings.device||[]) {
    const node=graph[binding.node];
    const options=node&&comfyOptions(info,node.class_type,binding.field);
    const devices=options?.filter((value):value is string=>typeof value==='string'&&/^(mps|cuda:\d+|xpu:\d+)$/.test(value));
    if(!devices?.length)throw Error(`No compatible GPU is available for ${node?.class_type||binding.node}. Check this node’s devices in ComfyUI.`);
    const current=node.inputs[binding.field];
    node.inputs[binding.field]=devices.includes(current as string)?current:devices[0];
  }
}
