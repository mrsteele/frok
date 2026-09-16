import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pipelineMetadata, type PipelineStatus } from '../src/lib/pipelines/schema';
import { aggregateDownloadAccess, dependencyRepository, downloadAccess, huggingFaceRepository, requiredGatedDownloads, workflowDownloadAccess, type DownloadAccessState } from '../src/lib/pipelines/download-access';
import { accessCacheLifetime, cachedDownloadAccess, checkDownloadAccess } from '../src/lib/providers/huggingface-access';
import { WorkflowSummary } from '../src/components/generation/workflow-summary';
import { PipelineDetails } from '../src/components/settings/pipeline-details';

function workflow(): PipelineStatus {
  return {
    ...pipelineMetadata.parse({ version: 1, id: 'test:model', name: 'Example model', runner: 'vpipe', catalog: {
      family: 'Example', model: 'Base', flavor: 'LoRA', documentation: 'https://example.com', setup: 'Manual setup',
      access: [{ name: 'Base', url: 'https://huggingface.co/example/base', gated: true }],
    } }),
    kind: 'image', supportsSource: false, maxReferences: 0, state: 'missing', ready: false, detail: 'Missing files',
    missing: ['example/base'], revision: 'test',
    files: [{ reference: 'example/base', repository: 'example/base', ready: false }],
  };
}
const access = () => requiredGatedDownloads(workflow());

test('access describes remaining gated files, including installed bases and public LoRAs', () => {
  const pipeline = workflow();
  assert.equal(requiredGatedDownloads(pipeline).state, 'unchecked');
  pipeline.files![0].ready = true;
  pipeline.files!.push({ reference: 'public/lora', repository: 'public/lora', ready: false });
  assert.equal(requiredGatedDownloads(pipeline).state, 'not-required');
  pipeline.ready = true;
  pipeline.downloadAccess = downloadAccess('denied');
  assert.equal(workflowDownloadAccess(pipeline).state, 'not-required', 'stale denial cannot override installed readiness');
  pipeline.ready = false;
  pipeline.files = [{ reference: 'local/quantized', ready: false }];
  assert.equal(requiredGatedDownloads(pipeline).state, 'unknown', 'a missing prepared target does not prove its source needs downloading');
  pipeline.files[0].ready = true;
  assert.equal(requiredGatedDownloads(pipeline).state, 'not-required', 'missing plugins do not require gated downloads');
});

test('origins are mapped conservatively and authenticated requests are restricted to model repositories', () => {
  assert.equal(huggingFaceRepository('https://huggingface.co/owner/model/resolve/main/model.safetensors'), 'owner/model');
  for (const url of ['https://huggingface.co.evil.test/a/b', 'http://huggingface.co/a/b', 'https://secret@huggingface.co/a/b', 'https://huggingface.co:444/a/b', 'https://huggingface.co/spaces/a/b', 'https://huggingface.co/a/%2fb', 'https://huggingface.co/a/b?token=secret']) assert.equal(huggingFaceRepository(url), undefined, url);
  const dependency = pipelineMetadata.parse({ version: 1, id: 'test', name: 'Test', runner: 'vpipe', dependencies: [{ kind: 'model', reference: 'local/quantized', generated: true }] }).dependencies[0];
  assert.equal(dependencyRepository(dependency, 'vpipe'), undefined);
  assert.equal(dependencyRepository({ ...dependency, generated: false, fetch: { model: 'owner/model' } }, 'vpipe'), 'owner/model');
});

test('one denied repository blocks access; every required repository must be verified to unlock', () => {
  const repository = access().repositories[0];
  for (const state of ['denied', 'unchecked', 'unknown', 'unavailable'] as const) {
    assert.equal(aggregateDownloadAccess([{ ...repository, state: 'granted' }, { ...repository, state }]).state, state);
  }
  assert.equal(aggregateDownloadAccess([{ ...repository, state: 'granted' }]).state, 'granted');
});

test('health only reads cached permission; explicit checks send the backend token to auth-check without following redirects', async t => {
  t.mock.property(process, 'env', { ...process.env, HF_TOKEN: 'synthetic-access-check-token' });
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init }); return new Response(null, { status: 200 });
  });
  assert.equal(cachedDownloadAccess(access()).state, 'unchecked');
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal((await checkDownloadAccess(access(), new AbortController().signal)).state, 'granted');
  assert.equal(requests[0].url, 'https://huggingface.co/api/models/example/base/auth-check');
  assert.equal(requests[0].init?.redirect, 'manual');
  assert.equal(new Headers(requests[0].init?.headers).get('Authorization'), 'Bearer synthetic-access-check-token');
  assert.equal(cachedDownloadAccess(access()).state, 'granted');
  assert.equal(fetch.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(cachedDownloadAccess(access())), /synthetic-access-check-token|Bearer/);
  t.mock.method(Date, 'now', () => new Date('2099-01-01').getTime() + accessCacheLifetime);
  assert.equal(cachedDownloadAccess(access()).state, 'unchecked', 'permission expires');
  process.env.HF_TOKEN = 'synthetic-different-token';
  assert.equal(cachedDownloadAccess(access()).state, 'unchecked', 'permission is scoped to credentials');
});

test('missing credentials and unverified dependencies never initiate an access request', async t => {
  t.mock.property(process, 'env', { ...process.env, HF_TOKEN: '' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected request'); });
  assert.equal((await checkDownloadAccess(access(), new AbortController().signal)).state, 'token-required');
  assert.equal(cachedDownloadAccess(downloadAccess('unknown')).state, 'unknown', 'disconnected status stays unknown');
  process.env.HF_TOKEN = 'synthetic-token';
  for (const state of ['not-required', 'unknown'] as const) assert.equal((await checkDownloadAccess(downloadAccess(state), new AbortController().signal)).state, state);
  const unmapped = downloadAccess('unknown', [{ ...access().repositories[0], state: 'unknown' }]);
  assert.equal((await checkDownloadAccess(unmapped, new AbortController().signal)).state, 'unknown');
  assert.equal(fetch.mock.callCount(), 0);
});

test('denials are distinguished from network failures, redirects and unavailable repositories', async t => {
  t.mock.property(process, 'env', { ...process.env, HF_TOKEN: 'synthetic-response-token' });
  let status = 200;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!status) throw Error('secret remote details');
    return new Response(null, { status });
  });
  for (const [code, expected] of [[200, 'granted'], [401, 'denied'], [403, 'denied'], [404, 'unavailable'], [302, 'unavailable'], [429, 'unavailable'], [500, 'unavailable'], [0, 'unavailable']] as const) {
    status = code;
    const result = await checkDownloadAccess(access(), new AbortController().signal);
    assert.equal(result.state, expected);
    assert.equal(cachedDownloadAccess(access()).state, expected, 'a failed recheck replaces any old grant');
    assert.doesNotMatch(JSON.stringify(result), /secret remote details|synthetic-response-token/);
  }
});

test('access requests respect cancellation without a network call', async t => {
  t.mock.property(process, 'env', { ...process.env, HF_TOKEN: 'synthetic-cancel-token' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(checkDownloadAccess(access(), controller.signal), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('lock/color states agree across rich rows and details and never contradict Ready', () => {
  const pipeline = workflow();
  for (const state of ['token-required', 'denied', 'granted', 'unchecked', 'unknown', 'unavailable', 'not-required'] as DownloadAccessState[]) {
    pipeline.downloadAccess = downloadAccess(state, [{ ...access().repositories[0], state }]);
    const summary = renderToStaticMarkup(createElement(WorkflowSummary, { pipeline, connection: { enabled: true, available: true, detail: '' } }));
    const details = renderToStaticMarkup(createElement(PipelineDetails, { pipeline, onCheckAccess: () => {} }));
    if (state === 'token-required' || state === 'denied') assert.match(summary, /workflow-access-icon--warning/);
    else if (state === 'granted') assert.match(summary, /workflow-access-icon--success/);
    else assert.doesNotMatch(summary, /workflow-access-icon/);
    if (['unchecked', 'denied', 'granted', 'unavailable'].includes(state)) assert.match(details, /Check download access/);
    else assert.doesNotMatch(details, /Check download access/);
    if (state === 'unavailable') assert.match(details, /ui-message--danger/);
    if (state === 'unknown') { assert.match(summary, />Setup needed</); assert.doesNotMatch(summary, /Needs download/); }
    pipeline.ready = true;
    const ready = renderToStaticMarkup(createElement(WorkflowSummary, { pipeline, connection: { enabled: true, available: true, detail: '' } }));
    assert.match(ready, />Ready</); assert.doesNotMatch(ready, /workflow-access-icon/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(PipelineDetails, { pipeline })), /pipeline-access|token needed|access needed|Check download/);
    pipeline.ready = false;
    const offline = renderToStaticMarkup(createElement(WorkflowSummary, { pipeline, connection: { enabled: true, available: false, detail: '' } }));
    assert.match(offline, /Connect Vpipe/); assert.doesNotMatch(offline, /workflow-access-icon/);
  }
});
