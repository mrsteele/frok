import fs from 'node:fs/promises';
import path from 'node:path';
import { renderVpipe } from '../vpipe';
import { dependencyReady } from '../pipelines/dependencies';
import { workdir } from '../db';
import { vpipeBin } from '../config';
import { runProcess } from '../process';
import { validateNativeGraph } from './graph-validation';
import { vpipePluginArgs } from './vpipe-plugins';
import type { ProviderAdapter } from './types';

function preparationError(output: string) {
  const denied = output.match(/ModelFetchStage[^\r\n]*HTTP\s+(401|403)\b/i);
  if (denied) return `Hugging Face denied the model download (HTTP ${denied[1]}). Confirm that your account has access to the model and your token permits reading it. In Frok Desktop, save the token under Settings → Advanced → API tokens, then quit and reopen Frok before retrying. In browser mode, set HF_TOKEN before starting Frok.`;
  return output.split(/\r?\n/).find(line => /\[ERROR\]/.test(line));
}

export const vpipeProvider: ProviderAdapter = {
  id: 'vpipe',
  validate: validateNativeGraph,
  render: renderVpipe,
  async inspect(snapshot) {
    try { await vpipePluginArgs(snapshot.metadata); }
    catch (error) { return (error as Error).message; }
  },
  async prepare({ snapshot, graph, directory, signal, log }) {
    if (!graph) throw Error('This workflow has no bundled Vpipe preparation.');
    const plugins = await vpipePluginArgs(snapshot.metadata);
    graph = structuredClone(graph);
    const models = snapshot.metadata.dependencies.filter(d => d.kind !== 'lora');
    if (models.length && (await Promise.all(models.map(d => dependencyReady(snapshot, d)))).every(Boolean)) {
      const loras = snapshot.metadata.dependencies.filter(d => d.kind === 'lora');
      const stages = (graph.stages as import('../vpipe').Stage[]).filter(stage =>
        stage.type === 'model-fetch' && loras.some(d => d.fetch?.model === stage.config.model_path));
      if (stages.length) {
        graph.stages = stages.map(stage => ({ ...stage, iports: [] }));
        log('Reusing the installed base model; preparing only the flavor dependencies.\n');
      }
    }
    const file = path.join(directory, 'prepare.vpipeline');
    await fs.writeFile(file, JSON.stringify(graph, null, 2), { mode: 0o600 });
    await fs.mkdir(workdir(), { recursive: true });
    log(`Running the built-in ${snapshot.metadata.name} starter in ${workdir()}.\n`);
    log(`Hugging Face token: ${process.env.HF_TOKEN ? 'available to Vpipe' : 'not set'}.\n`);
    let output: string;
    try {
      output = await runProcess(vpipeBin(), [...plugins, '--launch', file], {
        cwd: workdir(), signal, onLog: log, timeout: 24 * 60 * 60 * 1000,
      });
    } catch (error) {
      const message = (error as Error).message;
      throw Error(preparationError(message) || message);
    }
    signal.throwIfAborted();
    const failure = preparationError(output);
    if (failure) throw Error(failure);
  },
};
