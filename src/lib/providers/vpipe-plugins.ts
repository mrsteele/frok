import fs from 'node:fs/promises';
import path from 'node:path';
import { workdir } from '../db';
import type { PipelineMetadata } from '../pipelines/schema';

// Explicitly supported native extensions. A workflow cannot inject CLI flags,
// library paths or environment variables. The user installs the plugin in Vpipe.
export async function vpipePluginArgs(metadata: PipelineMetadata) {
  const args: string[] = [];
  for (const plugin of metadata.plugins || []) {
    if (plugin !== 'ltx-2.5') throw Error('Unsupported Vpipe plugin.');
    const file = path.join(workdir(), 'plugins', 'vpipe-ltx-2.5.so');
    if (!(await fs.stat(file).catch(() => undefined))?.isFile())
      throw Error('Install the compatible LTX-2.5 plugin at <Vpipe workspace>/plugins/vpipe-ltx-2.5.so. See this workflow’s setup guide.');
    args.push('--plugin', file);
  }
  return args;
}
