import type { Health, Job } from '../../src/lib/types';
import { generationOptions } from '../../src/lib/onboarding';
import { pipelineMetadata } from '../../src/lib/pipelines/schema';
import { runtimeDefaults } from '../../desktop/preferences.mjs';
import type { ExportPreferences } from '../../src/lib/export-preferences';

export const scenario = new URLSearchParams(location.search).get('state') || 'connected';
const available = !['offline', 'disconnected'].includes(scenario);
export const health = {
  worker: true,
  checks: [],
  runner: 'vpipe',
  ollama: available,
  ollamaConnected: available,
  ollamaModel: 'example-prompt-model',
  recommendedPromptModel: 'example-prompt-model',
  ollamaModels: ['example-prompt-model', 'another-example-model'],
  ollamaUrl: '',
  connections: Object.fromEntries(
    ['vpipe', 'comfyui', 'ollama'].map((id) => [
      id,
      {
        enabled: scenario !== 'disconnected',
        available,
        detail: 'This example service is offline. Check its address and try again.',
      },
    ]),
  ),
  modelSelections: { prompt: 'example-prompt-model' },
  capabilities: Object.fromEntries(
    ['image', 'video', 'reference', 'upscale', 'prompt'].map((kind) => [
      kind,
      {
        ready: available && scenario !== 'queued',
        configured: true,
        detail: 'Connect the example service to continue.',
      },
    ]),
  ),
  connectionFields: {
    values: { vpipeWorkdir: '', comfyDir: '', comfyUrl: '', ollamaUrl: '' },
    defaults: {
      vpipeWorkdir: '~/vpipe',
      comfyDir: '~/ComfyUI',
      comfyUrl: 'http://127.0.0.1:8000',
      ollamaUrl: 'http://127.0.0.1:11434',
    },
  },
  pipelineSelections: Object.fromEntries(
    generationOptions.map(({ kind }) => [kind, `example-${kind}`]),
  ),
  pipelines: generationOptions.map(({ kind, name }) => ({
    ...pipelineMetadata.parse({
      version: 1,
      id: `example-${kind}`,
      name: `Example ${name.toLowerCase()} workflow`,
      runner: 'vpipe',
    }),
    kind,
    supportsSource: true,
    maxReferences: 4,
    state: available ? 'ready' : 'missing',
    ready: available,
    detail: 'Example workflow',
    missing: [],
    canPrepare: !available,
    revision: 'gallery',
  })),
  pipelineLibrary: {
    configured: '',
    path: '~/frok/pipelines',
    defaultPath: '~/frok/pipelines',
    counts: { vpipe: 4, comfyui: 0 },
    errors: [],
    warnings: [],
  },
  platform: 'Gallery',
  memoryGB: 16,
  diskGB: 100,
  workdir: '~/vpipe',
  setupDismissed: true,
  videoAdapters: {},
  referenceAdapters: {},
  upscalerReady: available,
  upscalerSupported: true,
  models: { ollama: available },
} as unknown as Health;
export const jobs: Job[] =
  scenario === 'queued'
    ? health.pipelines!.map<Job>((pipeline, index) => ({
        id: `example-job-${index}`,
        kind: 'setup',
        status: index === 0 ? 'running' : 'queued',
        request: {
          task: 'pipeline',
          pipeline: {
            metadata: pipelineMetadata.parse({
              version: 1,
              id: pipeline.id,
              name: pipeline.name,
              runner: pipeline.runner,
            }),
            kind: pipeline.kind,
            graph: {},
            revision: 'gallery',
          },
        },
        runner: 'vpipe',
        completed: 0,
        total: 1,
        message: index === 0 ? 'Preparing example workflow…' : 'Waiting in the example queue',
        createdAt: '2026-01-01T12:00:00Z',
        updatedAt: '2026-01-01T12:00:00Z',
      }))
    : [];
let preferences: ExportPreferences = {};
let runtime = { ...runtimeDefaults };
export const calls: { url: string; method: string; body: unknown }[] = [];
Object.assign(window, { __uiCalls: calls });

// Every request is intercepted. No fallback can contact Frok or a model runner.
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.origin,
  );
  const method = init?.method || 'GET',
    body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ url: url.pathname, method, body });
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
    throw Error('The gallery blocks external requests.');
  if (scenario === 'error' && method !== 'GET')
    return Response.json(
      { error: 'Example failure: changes could not be saved. Try again.' },
      { status: 503 },
    );
  await new Promise((resolve) => setTimeout(resolve, 60));
  const route = url.pathname.slice(5);
  if (route === 'envision' || route === 'media') return Response.json({ media: [], sections: [] });
  if (route === 'telemetry')
    return Response.json({ samples: [], busy: null, detail: 'Synthetic preview' });
  if (route === 'health') return Response.json(health);
  if (route === 'jobs') return Response.json({ jobs });
  if (route === 'settings/interface') {
    if (body) preferences = { ...preferences, ...body };
    return Response.json(preferences);
  }
  if (route === 'settings/runtime') {
    if (body) runtime = { ...runtime, ...body };
    return Response.json({ options: runtime });
  }
  if (route === 'settings') {
    if (body?.connections)
      for (const [id, enabled] of Object.entries(body.connections))
        health.connections![id as keyof NonNullable<Health['connections']>].enabled = !!enabled;
    if (body?.pipelineSelections)
      Object.assign(health.pipelineSelections!, body.pipelineSelections);
    for (const key of ['vpipeWorkdir', 'comfyDir', 'comfyUrl', 'ollamaUrl'] as const)
      if (body?.[key] !== undefined) health.connectionFields!.values[key] = body[key];
    return Response.json(health);
  }
  if (route === 'pipelines/library' || route === 'pipelines/reset')
    return Response.json(health.pipelineLibrary);
  if (route === 'setup') return Response.json({ job: { id: 'example-job', status: 'queued' } });
  return Response.json(
    { error: 'This preview does not perform exports, deletions or generation.' },
    { status: 400 },
  );
};
const credentials = {
  available: scenario !== 'offline',
  configured: { HF_TOKEN: false, COMFYUI_API_KEY: false },
  restartRequired: false,
};
const update = { status: 'disabled' as const, message: 'Updates are disabled in this preview.' };
const noop = async () => {};
window.frokDesktop = {
  credentialsStatus: async () => ({ ...credentials }),
  saveCredential: async (key, value) => {
    credentials.configured[key] = !!value;
    return { ...credentials, restartRequired: true };
  },
  info: async () => ({
    version: 'preview',
    workspace: '~/frok',
    pipelines: '~/frok/pipelines',
    development: true,
    update,
  }),
  checkUpdates: async () => update,
  installUpdate: noop,
  cancelUpdateRestart: noop,
  onUpdate: () => () => {},
  openDocs: noop,
  openPipelines: noop,
  openLogs: noop,
  openPipelineUpdates: noop,
};
