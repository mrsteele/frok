import test, { after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mediaToolsStatus } from '../src/lib/media-tool-status';
import type { runProcess } from '../src/lib/process';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frok-architecture-test-')));
Object.assign(process.env, {
  FROK_DATA_DIR: path.join(root, 'data'), FROK_ENV_FILE: path.join(root, 'absent.env'),
  FROK_PIPELINE_HOME: root, FROK_DOCUMENTS_DIR: path.join(root, 'documents'),
  FROK_ORIGIN: 'http://127.0.0.1:3000', FROK_OLLAMA_MANAGED: '0',
  VPIPE_BIN: path.join(root, 'unused-vpipe'), OLLAMA_BIN: path.join(root, 'unused-ollama'),
  FFMPEG_BIN: path.join(root, 'unused-ffmpeg'), FFPROBE_BIN: path.join(root, 'unused-ffprobe'),
  REALESRGAN_BIN: path.join(root, 'unused-upscaler'), REALESRGAN_MODEL_DIR: path.join(root, 'unused-models'),
});
await fs.mkdir(path.join(root, 'pipelines'));
const store = await import('../src/lib/db');
const library = await import('../src/lib/library');
const registry = await import('../src/lib/registry');
const { claimNextJob, queueBusy } = await import('../src/lib/worker-queue');
const { assertRunnerLocationsIdle } = await import('../src/lib/runner-settings');
const { runtimeOptions } = await import('../src/lib/preferences');
const routes = await import('../src/app/api/[[...segments]]/route');
const call = (resource: string, method: 'GET' | 'PATCH' = 'GET', input?: unknown) => routes[method](
  new Request(`http://127.0.0.1:3000/api/${resource}`, { method, headers: { Origin: 'http://127.0.0.1:3000', 'X-Frok-Request': '1' }, body: input === undefined ? undefined : JSON.stringify(input) }),
  { params: Promise.resolve({ segments: resource.split('?')[0].split('/') }) },
);
beforeEach(() => {
  mock.restoreAll();
  store.db.exec('DELETE FROM settings; DELETE FROM jobs');
  store.setValue('environmentDefaults', {});
  store.setValue('pipelineDirectory', path.join(root, 'pipelines'));
  store.setValue('runnerLocations', { vpipeWorkdir: path.join(root, 'vpipe'), comfyDir: path.join(root, 'comfy'), comfyUrl: 'http://127.0.0.1:19882' });
  store.setValue('ollamaUrl', 'http://127.0.0.1:19881');
  // Any accidental service request must fail before it reaches a real service.
  mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected service request in architecture fixture.'); });
});
after(async () => {
  mock.restoreAll(); library.closeLibraryDatabase(); registry.registry.close();
  await fs.rm(root, { recursive: true, force: true });
});

const commands = { ffmpeg: 'synthetic-ffmpeg', ffprobe: 'synthetic-ffprobe' };
function toolStub(chunks: string[], probeAvailable = true): typeof runProcess {
  return async (command, args, options = {}) => {
    assert.equal(options.timeout, 5000);
    if (command === commands.ffprobe) {
      assert.deepEqual(args, ['-version']);
      if (!probeAvailable) throw Error('Synthetic missing FFprobe');
      return 'ffprobe version synthetic';
    }
    assert.equal(command, commands.ffmpeg); assert.deepEqual(args, ['-hide_banner', '-encoders']);
    for (const chunk of chunks) options.onLog?.(chunk);
    return chunks.join('').slice(-16000);
  };
}

test('external FFmpeg readiness requires libx264 and AAC, not just a successful command', async () => {
  for (const output of ['ffmpeg version synthetic\n', ' V....D libx264 H.264\n', ' A..... aac AAC\n']) {
    const result = await mediaToolsStatus(commands, undefined, toolStub([output]));
    assert.equal(result.ready, false); assert.match(result.detail, /encoding support/);
  }
  const result = await mediaToolsStatus(commands, undefined, toolStub([' V....D libx264 H.264\n A..... aac AAC\n'], false));
  assert.equal(result.ready, false); assert.match(result.detail, /included video tools could not start/);
});

test('encoder checks survive chunk boundaries, long listings and a final line without a newline', async () => {
  const result = await mediaToolsStatus(commands, undefined, toolStub([' V....D lib', 'x264 H.264\n', ' V..... other description\n'.repeat(2000), ' A..... aac AAC']));
  assert.equal(result.ready, true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(mediaToolsStatus(commands, controller.signal, toolStub([])), { name: 'AbortError' });
});

test('cancelled jobs keep runner and runtime locations locked until their worker releases ownership', async () => {
  const job = store.createJob({ kind: 'setup', request: { task: 'runtime' }, runner: 'vpipe', total: 1 });
  const claimed = claimNextJob()!;
  assert.equal(claimed.job.id, job.id);
  store.updateJob(job.id, { status: 'cancelled' });
  const folder = path.join(root, 'new-tools');
  try {
    assert.equal(queueBusy(), true);
    for (const input of [{ mediaToolsDirectory: folder }, { manageOllama: true }]) {
      const response = await call('settings/runtime', 'PATCH', input);
      assert.equal(response.status, 409); assert.match((await response.json()).error, /wait for the runner to stop/);
    }
    assert.equal(runtimeOptions().mediaToolsDirectory, ''); assert.equal(runtimeOptions().manageOllama, false);
    assert.throws(() => assertRunnerLocationsIdle({ vpipeWorkdir: path.join(root, 'new-vpipe') }), /wait for the runner to stop/);
    assert.throws(() => assertRunnerLocationsIdle({ comfyDir: path.join(root, 'new-comfy') }), /wait for the runner to stop/);
    assert.doesNotThrow(() => assertRunnerLocationsIdle({ vpipeWorkdir: store.settings().vpipeWorkdir }));
    assert.equal((await call('settings/runtime', 'PATCH', { liveImagePreviews: false })).status, 200);
  } finally { registry.endOperation(claimed.operation); registry.setServiceValue('activeJob', null); }
  assert.equal(queueBusy(), false);
  assert.equal((await call('settings/runtime', 'PATCH', { mediaToolsDirectory: folder })).status, 200);
  assert.doesNotThrow(() => assertRunnerLocationsIdle({ vpipeWorkdir: path.join(root, 'new-vpipe') }));
});

test('an in-flight health request retries after the external tools folder changes', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const good = path.join(root, 'good-tools'), incompatible = path.join(root, 'incompatible-tools');
  for (const folder of [good, incompatible]) {
    await fs.mkdir(folder);
    for (const name of ['ffmpeg', 'ffprobe']) {
      const text = name === 'ffprobe' ? 'ffprobe version synthetic' : folder === good ? ' V....D libx264 H.264\n A..... aac AAC\n' : ' A..... aac AAC\n';
      await fs.writeFile(path.join(folder, name), `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(text)});\n`, { mode: 0o700 });
    }
  }
  await call('settings/runtime', 'PATCH', { mediaToolsDirectory: good });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  mock.method(globalThis, 'fetch', async (target: string | URL | Request) => {
    assert.equal(new URL(String(target)).origin, 'http://127.0.0.1:19881');
    entered(); await gate;
    return Response.json({ models: [] });
  });
  const checking = call('health?refresh=1');
  try {
    await started;
    assert.equal((await call('settings/runtime', 'PATCH', { mediaToolsDirectory: incompatible })).status, 200);
  } finally { release(); }
  const response = await checking;
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.checks.find((check: { id: string }) => check.id === 'ffmpeg').ready, false);
  assert.match(data.checks.find((check: { id: string }) => check.id === 'ffmpeg').detail, /libx264/);
  const cached = await (await call('health')).json();
  assert.equal(cached.checks.find((check: { id: string }) => check.id === 'ffmpeg').ready, false);
});
