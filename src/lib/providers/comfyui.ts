import { comfyFetch, renderComfy, type Graph } from '../comfyui';
import { comfyModelReference } from '../pipelines/dependencies';
import { comfyOptions, resolveComfyDevices, type ComfyNodeInfo } from '../pipelines/comfy-devices';
import { validateNativeGraph } from './graph-validation';
import { prepareComfyFiles } from './model-download';
import type { ProviderAdapter } from './types';

export const comfyuiProvider: ProviderAdapter = {
  id: 'comfyui',
  validate: validateNativeGraph,
  render: renderComfy,
  prepare: prepareComfyFiles,
  async inspect(snapshot, missing, context) {
    let info: ComfyNodeInfo;
    try {
      let response = context?.responses.get('comfyui:object_info');
      if (!response) {
        response = comfyFetch('/object_info').then(response => response.json());
        context?.responses.set('comfyui:object_info', response);
      }
      info = await response as ComfyNodeInfo;
      if (!info || typeof info !== 'object') throw Error('Invalid node information.');
    } catch {
      return 'Connect the protected ComfyUI service to check its nodes.';
    }
    const { metadata: m } = snapshot;
    const graph = structuredClone(snapshot.graph) as Graph;
    const nodes = [...new Set(Object.values(graph).map(node => node.class_type))];
    if (m.source || m.references) nodes.push('LoadImage');
    const absent = nodes.filter(name => !(name in info));
    if (absent.length) return `Install or update these nodes in ComfyUI, then restart it: ${absent.join(', ')}.`;
    try { resolveComfyDevices(graph, m, info); }
    catch (error) { return (error as Error).message; }
    for (const [id, node] of Object.entries(graph)) {
      for (const [field, value] of Object.entries(node.inputs)) {
        if (m.videoSource?.node === id && m.videoSource.field === field) continue;
        const reference = comfyModelReference(node, field);
        if (reference && missing.some(dependency => dependency.reference === reference)) continue;
        const options = comfyOptions(info, node.class_type, field);
        if (options && !Array.isArray(value) && !options.includes(value))
          return `Refresh ComfyUI’s available models or update ${node.class_type}: ${field} is unavailable.`;
      }
    }
  },
};
