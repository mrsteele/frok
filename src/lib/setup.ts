import { mediaToolsStatus } from './media-tool-status';
import { defaultRunnerLocations } from './runner-locations';
import { pipelineHealth } from './pipelines/catalog';
import { workerStatus } from './worker-health';
import fs from "node:fs/promises";
import os from "node:os";
import { dataDir, vpipeBin, ffmpeg, ffprobe } from "./config";
import { workdir, settings, connectionFields } from "./db";
import { available } from "./process";
import { comfyFetch, comfyIsolationIssue } from "./comfyui";
import type { Health } from "./types";
import { ollamaConfig } from "./ollama-config";
import { promptModelStatus } from "./ollama-status";
import { capabilityStatus } from './capabilities';
import { machineOllamaConfig } from './ollama-defaults';
export async function health(promptConfig = ollamaConfig(), selections=settings().modelSelections):Promise<Health> {
  const { model: ollamaModel, url: ollamaUrl } = promptConfig;
  const s=settings();const dir=workdir();
  const [vpipe,videoTools,ollama,comfy]=await Promise.all([
    available(vpipeBin()),mediaToolsStatus({ffmpeg:ffmpeg(),ffprobe:ffprobe()}),
    promptModelStatus(promptConfig),
    comfyFetch("/system_stats").then(()=>true).catch(()=>false),
  ]);
  const models:Record<string,boolean>={ollama:ollama.ready};
  const connections={
    vpipe:{enabled:s.connections.vpipe,available:vpipe,detail:vpipe?'Vpipe CLI detected.':'Install Vpipe Manager, then check the connection.'},
    comfyui:{enabled:s.connections.comfyui,available:comfy,detail:comfy?'Protected ComfyUI service connected.':comfyIsolationIssue()||'Start the configured ComfyUI service, then check the connection.'},
    ollama:{enabled:s.connections.ollama,available:ollama.connected,detail:ollama.connected?'Ollama service connected.':`Start Ollama and check its address in Settings → Services (${ollamaUrl}).`},
  };
  const capabilities=capabilityStatus(selections,connections,models,undefined,ollama.ready,videoTools.ready,false);
  const ollamaReady=capabilities.prompt.ready;
  models.ollama=ollamaReady;
  let diskGB=0;try{const disk=await fs.statfs(await fs.stat(dir).then(()=>dir).catch(()=>dataDir));diskGB=Math.round(disk.bavail*disk.bsize/1024**3);}catch{}
  const queue=workerStatus(),worker=queue.ready;
  const state:Health={promptModelSetting:s.promptModelSetting,connectionFields:connectionFields(),runnerDefaults:defaultRunnerLocations(),connections,modelSelections:selections,capabilities,recommendedPromptModel:machineOllamaConfig().model,runner:selections.video||s.runner,worker,videoAdapters:s.videoAdapters,referenceAdapters:s.referenceAdapters,upscalerReady:false,upscalerSupported:false,upscaler:selections.upscale||s.upscaler,ollama:ollamaReady,ollamaModel:selections.prompt||undefined,ollamaModels:ollama.models,ollamaUrl,ollamaConnected:ollama.connected,models,platform:`${os.platform()} ${os.arch()}`,memoryGB:Math.round(os.totalmem()/1024**3),diskGB,workdir:dir,setupDismissed:s.setupDismissed,comfyUrl:s.comfyUrl,comfyDir:s.comfyDir,
    checks:[{id:"worker",name:"Generation queue",ready:worker,detail:queue.detail},
      {id:"runner",name:s.runner==="vpipe"?"Vpipe":"ComfyUI",ready:s.runner==="vpipe"?vpipe:comfy,detail:s.runner==="vpipe"?(vpipe?"CLI detected":"Install Vpipe Manager, then check the connection"):(comfy?"Connected":comfyIsolationIssue()||`Start ComfyUI at ${s.comfyUrl}`)},
      {id:"ffmpeg",name:"Video tools",ready:videoTools.ready,detail:videoTools.detail},
      {id:"ollama",name:"Prompt enhancement",ready:ollamaReady,detail:ollamaReady?ollamaModel:capabilities.prompt.detail} ]};
  return pipelineHealth(state);
}
