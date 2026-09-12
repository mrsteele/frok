import type { OllamaConfig } from './types';
import { installedOllamaModels, ollamaModelKey } from './ollama-models';

export async function promptModelStatus(config: OllamaConfig, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const options = { redirect:'error' as const, cache: 'no-store' as const, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(3000)]) };
  try {
    const response = await fetch(`${config.url}/api/tags`, options);
    if (!response.ok) return { connected: false, ready: false, models: [] as string[] };
    const data = await response.json();
    if (!Array.isArray(data?.models)) return { connected: false, ready: false, models: [] as string[] };
    // /tags proves installation; /show distinguishes text generation from embedding-only models.
    // Metadata requests never load a model or run inference.
    const installed = installedOllamaModels(data.models);
    const compatible = await Promise.all(installed.map(async model=>{
      try {
        const details=await fetch(`${config.url}/api/show`,{...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
        if(!details.ok)return false;
        const modelInfo=await details.json(),capabilities=modelInfo.capabilities;
        return !modelInfo.remote_model&&!modelInfo.remote_host&&Array.isArray(capabilities)&&capabilities.includes('completion');
      } catch {return false;}
    }));
    signal?.throwIfAborted();
    const models = installed.filter((_,index)=>compatible[index]);
    const ready = models.some(name => ollamaModelKey(name) === ollamaModelKey(config.model));
    return { connected: true, ready, models };
  } catch { signal?.throwIfAborted(); return { connected: false, ready: false, models: [] as string[] }; }
}
