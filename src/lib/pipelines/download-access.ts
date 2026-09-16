import { gatedAccess } from './details';
import type { Dependency, PipelineStatus } from './schema';

export type DownloadAccessState = 'not-required' | 'token-required' | 'granted' | 'denied' | 'unchecked' | 'unavailable' | 'unknown';
export type DownloadRepository = {
  repository?: string;
  name: string;
  url: string;
  state: DownloadAccessState;
  checkedAt?: string;
};
export type DownloadAccess = {
  state: DownloadAccessState;
  detail: string;
  repositories: DownloadRepository[];
};

const details: Record<DownloadAccessState, string> = {
  'not-required': 'No gated downloads are needed.',
  'token-required': 'Save a Hugging Face read token in Settings → Advanced → API tokens, then restart Frok. Its account must also have access to the model.',
  granted: 'Hugging Face confirmed this token can read the required model repositories. Model files still need to be downloaded.',
  denied: 'Hugging Face refused access. Check the token’s read permissions and the account’s model access, including any required terms or publisher approval.',
  unchecked: 'A token is available, but model access has not been checked. A saved token alone does not confirm access.',
  unavailable: 'Couldn’t check access with Hugging Face. Try again; this does not mean access was denied.',
  unknown: 'The workflow’s remaining gated download requirements could not be verified. Review the runner’s model files and manual setup instructions.',
};

export function downloadAccess(state: DownloadAccessState, repositories: DownloadRepository[] = []): DownloadAccess {
  return { state, detail: details[state], repositories };
}

// Only canonical Hub model repositories may receive an access-check request.
export function huggingFaceRepository(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://huggingface.co' || url.username || url.password || url.search || url.hash) return;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || !parts.slice(0, 2).every(part => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')) return;
    if (['api', 'datasets', 'spaces'].includes(parts[0])) return;
    return parts.slice(0, 2).join('/');
  } catch { return; }
}

export function dependencyRepository(dependency: Dependency, runner: PipelineStatus['runner']): string | undefined {
  if (dependency.fetch) return huggingFaceRepository(`https://huggingface.co/${dependency.fetch.model}`);
  if (dependency.url) return huggingFaceRepository(dependency.url);
  // A generated/quantized local target is not evidence that its source needs downloading.
  if (runner === 'vpipe' && !dependency.generated && !dependency.reference.startsWith('local/')) {
    return huggingFaceRepository(`https://huggingface.co/${dependency.reference.replace(/^models\//, '')}`);
  }
}

// Call only after the provider's local dependency checks have completed.
export function requiredGatedDownloads(pipeline: PipelineStatus): DownloadAccess {
  const gates = gatedAccess(pipeline.catalog);
  if (pipeline.ready || !gates.length || pipeline.files?.every(file => file.ready)) return downloadAccess('not-required');
  const repositories: DownloadRepository[] = [];
  for (const gate of gates) {
    const repository = huggingFaceRepository(gate.url);
    const files = repository ? pipeline.files?.filter(file => file.repository === repository) : undefined;
    if (files?.length && files.every(file => file.ready)) continue;
    if (repositories.some(item => repository && item.repository === repository)) continue;
    repositories.push({ ...gate, repository, state: files?.length ? 'unchecked' : 'unknown' });
  }
  return aggregateDownloadAccess(repositories);
}

export function aggregateDownloadAccess(repositories: DownloadRepository[]): DownloadAccess {
  if (!repositories.length) return downloadAccess('not-required');
  const state = (['token-required', 'denied', 'unavailable', 'unknown', 'unchecked'] as const)
    .find(state => repositories.some(repository => repository.state === state)) || 'granted';
  return downloadAccess(state, repositories);
}

export function workflowDownloadAccess(pipeline: PipelineStatus): DownloadAccess {
  if (pipeline.ready || !gatedAccess(pipeline.catalog).length) return downloadAccess('not-required');
  return pipeline.downloadAccess || downloadAccess('unknown');
}
