import { AsyncLocalStorage } from 'node:async_hooks';
import os from 'node:os';
import path from 'node:path';

export type RunnerLocations = {vpipeWorkdir:string;comfyDir:string;comfyUrl:string};
const preview = new AsyncLocalStorage<Partial<RunnerLocations>>();

export function defaultRunnerLocations():RunnerLocations {
  const home=os.homedir();
  return {
    vpipeWorkdir:path.join(home,'vpipe'),
    comfyDir:path.join(process.platform==='linux'?home:process.env.FROK_DOCUMENTS_DIR||path.join(home,'Documents'),'ComfyUI'),
    comfyUrl:'http://127.0.0.1:8000',
  };
}

export function resolveRunnerLocations(saved:Partial<RunnerLocations>,legacyVpipeWorkdir?:string,legacy:Record<string,string|undefined>={}):RunnerLocations {
  const defaults=defaultRunnerLocations();
  const locations={...defaults,
    ...(legacyVpipeWorkdir?{vpipeWorkdir:legacyVpipeWorkdir}:{}),
    ...(legacy.VPIPE_WORKDIR?{vpipeWorkdir:legacy.VPIPE_WORKDIR}:{}),
    ...(legacy.COMFYUI_DIR?{comfyDir:legacy.COMFYUI_DIR}:{}),
    ...(legacy.COMFYUI_URL?{comfyUrl:legacy.COMFYUI_URL}:{}),
    ...saved,...preview.getStore()};
  // An explicit blank means the device default, even on older installations
  // that still have environment or legacy workspace locations.
  for(const key of Object.keys(defaults) as (keyof RunnerLocations)[])if(!locations[key].trim())locations[key]=defaults[key];
  return locations;
}

// Candidate connection checks never change another request or a running job.
export const withRunnerLocations=<T>(locations:Partial<RunnerLocations>,run:()=>T):T=>preview.run(locations,run);
export function comfyUsesFolder(saved:Partial<RunnerLocations>) {
  return preview.getStore()?.comfyDir!==undefined||saved.comfyDir!==undefined;
}
export function isLocalService(value:string) {
  try {
    const url=new URL(value);
    return ['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/';
  }catch{return false;}
}
