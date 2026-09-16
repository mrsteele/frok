import krea from '../../resources/pipelines/image/krea-2-turbo/meta.json';
import m87 from '../../resources/pipelines/image/krea-2-turbo-m87/meta.json';
import klein from '../../resources/pipelines/image/flux2-klein-4b-distilled/meta.json';
import qwen from '../../resources/pipelines/image/qwen-image-lightning/meta.json';
import wan from '../../resources/pipelines/video/wan2-2-5b/meta.json';
import ltx from '../../resources/pipelines/video/ltx-2-5/meta.json';
import type { Health, Job } from '../../src/lib/types';
import { generationOptions } from '../../src/lib/onboarding';
import { pipelineMetadata } from '../../src/lib/pipelines/schema';
import { dependencyRepository, downloadAccess, requiredGatedDownloads, type DownloadAccessState } from '../../src/lib/pipelines/download-access';
import { runtimeDefaults } from '../../desktop/preferences.mjs';
import type { ExportPreferences } from '../../src/lib/export-preferences';
import { previewJobs, studioResponse } from './studio-fixtures';

export const scenario = new URLSearchParams(location.search).get('state') || 'connected';
const available = !['offline', 'disconnected'].includes(scenario);
const onlyProvider = scenario === 'vpipe-only' ? 'vpipe' : scenario === 'comfyui-only' ? 'comfyui' : undefined;
const modelsReady = available && scenario !== 'missing' && !onlyProvider && !scenario.startsWith('access-');
export const health = {
  worker: true,
  checks: [{ id: 'ffmpeg', name: 'Video tools', ready: true, detail: 'Synthetic bundled video tools.' }],
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
        enabled: scenario !== 'disconnected' && (!onlyProvider || id === 'ollama' || id === onlyProvider),
        available: available && (!onlyProvider || id === 'ollama' || id === onlyProvider),
        detail: 'This example service is offline. Check its address and try again.',
      },
    ]),
  ),
  modelSelections: { prompt: 'example-prompt-model' },
  capabilities: Object.fromEntries(
    ['image', 'video', 'reference', 'upscale', 'prompt'].map((kind) => [
      kind,
      {
        ready: modelsReady,
        configured: true,
        detail: modelsReady ? 'Ready to generate.' : available ? 'Install the missing models in your runner, then refresh workflows.' : 'Connect the example service to continue.',
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
    state: modelsReady ? 'ready' : 'missing',
    ready: modelsReady,
    detail: modelsReady ? 'Example workflow' : 'Install the missing models in Vpipe, then refresh workflows.',
    missing: modelsReady ? [] : ['example/model'],
    preparation: !modelsReady && kind === 'image' ? 'image/krea-2-turbo' : undefined,
    revision: 'gallery',
  })),
  pipelineLibrary: {
    configured: '',
    path: '~/frok/pipelines',
    defaultPath: '~/frok/pipelines',
    counts: { vpipe: 4, comfyui: 0 },
    errors: [],
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
// A visibly synthetic rated model exercises numeric scores, storage size and long names.
Object.assign(health.pipelines![0], {
  name: 'Example image model · Detailed illustration',
  files: [{ reference: 'example/model.safetensors', size: 4_200_000_000, ready: modelsReady }],
  catalog: {
    family: 'Gallery examples', model: 'Synthetic example', flavor: 'Illustration',
    uses: ['UI testing only'], requirements: [], access: [], experimental: false,
    documentation: 'https://example.com', setup: 'Synthetic data only. No model is installed.',
    ratings: {
      speed: { score: 4.5, basis: 'Synthetic score for UI testing, not a model benchmark.', source: 'https://example.com' },
      adherence: { score: 3, basis: 'Synthetic score for UI testing, not a model benchmark.', source: 'https://example.com' },
    },
  },
});
// Real catalog presentation with synthetic readiness and zero runner access.
for (const [kind, definition] of [['image', krea], ['image', m87], ['image', klein], ['image', qwen], ['video', wan], ['video', ltx]] as const) {
  const metadata = pipelineMetadata.parse(definition);
  health.pipelines!.push({
    ...metadata, kind, supportsSource: !!metadata.source, maxReferences: 0,
    state: modelsReady ? 'ready' : 'missing', ready: modelsReady,
    detail: modelsReady ? 'Synthetic installed model files.' : 'Synthetic missing files. No models are downloaded in this gallery.',
    missing: modelsReady ? [] : metadata.dependencies.map(d => d.reference),
    files: metadata.dependencies.map(d => ({ reference: d.reference, ready: modelsReady, size: d.size, url: d.url, repository: dependencyRepository(d, metadata.runner) })),
    preparation: modelsReady ? undefined : `${kind}/${metadata.id.split(':')[1]}`,
    revision: 'gallery',
  });
}
for (const pipeline of health.pipelines!) pipeline.downloadAccess = available ? requiredGatedDownloads(pipeline) : downloadAccess('unknown');
if (scenario.startsWith('access-')) {
  const state = scenario.slice(7);
  const pipeline = health.pipelines!.find(p => p.id === (state === 'partial' ? 'vpipe:krea-2-turbo-m87' : 'vpipe:krea-2-turbo'))!;
  health.pipelineSelections!.image = pipeline.id;
  if (state === 'ready' || state === 'partial') {
    pipeline.files![0].ready = true;
    pipeline.ready = state === 'ready';
    pipeline.state = pipeline.ready ? 'ready' : 'missing';
    pipeline.missing = pipeline.files!.filter(file => !file.ready).map(file => file.reference);
    pipeline.detail = pipeline.ready ? 'All declared dependencies are installed.' : 'Only the public M87 LoRA needs downloading. The Krea base is already installed.';
    pipeline.downloadAccess = requiredGatedDownloads(pipeline);
    if (pipeline.ready) pipeline.preparation = undefined;
    health.capabilities!.image = { configured: true, ready: pipeline.ready, connection: pipeline.runner, detail: pipeline.detail };
  } else {
    const accessState = state as DownloadAccessState;
    pipeline.downloadAccess = downloadAccess(accessState, pipeline.downloadAccess!.repositories.map(repository => ({ ...repository, state: accessState })));
  }
}
let preferences: ExportPreferences = {};
let runtime = { ...runtimeDefaults };
const studio = new URLSearchParams(location.search).get('view') === 'studio';
export const jobs: Job[] = studio ? previewJobs(scenario) : [];
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
  if (studio && route === 'jobs' && method === 'POST') await new Promise(resolve => setTimeout(resolve, 350));
  const preview = studio ? studioResponse(route, method, body, scenario, jobs) : undefined;
  if (preview) return preview;
  if (route === 'envision' || route === 'media') return Response.json({ media: [], sections: [] });
  if (route === 'telemetry')
    return Response.json({ samples: [], busy: null, detail: 'Synthetic preview' });
  if (route === 'health') return Response.json(health);
  if (route === 'jobs') return Response.json({ jobs });
  if (route === 'pipelines/access-check') {
    // Synthetic permission response: never reads real credentials or contacts HF.
    await new Promise(resolve => setTimeout(resolve, 450));
    const source = health.pipelines!.find(p => p.id === body.id)!;
    const result = scenario === 'access-unavailable' ? 'unavailable' : scenario === 'access-denied' ? 'denied' : 'granted';
    const pipeline = { ...source, downloadAccess: downloadAccess(result, source.downloadAccess!.repositories.map(repository => ({ ...repository, state: result, checkedAt: new Date().toISOString() }))) };
    health.pipelines = health.pipelines!.map(p => p.id === pipeline.id ? pipeline : p);
    return Response.json({ pipeline });
  }
  if (route === 'pipelines/prepare') {
    const pipeline=health.pipelines!.find(p=>p.id===body.id);
    const now=new Date().toISOString();
    const job:Job={id:'11111111-1111-4111-8111-111111111111',kind:'setup',runner:pipeline?.runner || 'vpipe',status:'queued',total:1,completed:0,message:'Queued',createdAt:now,updatedAt:now,request:{task:'builtin-preparation',preparation:pipeline?.preparation || 'image/krea-2-turbo',name:pipeline?.name || 'Example images workflow'}};
    jobs.push(job);return Response.json({job}, {status:201});
  }
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
