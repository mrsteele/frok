import { OllamaConnection } from '../src/components/settings/ollama-connection';
import { createLibraryFixture } from './fixtures/library';
import { mock, test as pureTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PromptModelSettings } from '../src/components/settings/prompt-model-settings';
import { installedOllamaModels } from '../src/lib/ollama-models';

const previousDir = process.cwd();
const testDir = fs.mkdtempSync(path.join(previousDir, '.data', 'ollama-readiness-test-'));
const endpoint = 'http://127.0.0.1:19081';
const original = 'qwen3:4b-instruct';
const replacement = 'huihui_ai/qwen3-abliterated:4b-instruct-2507-q4_K_M';
function configure(model = original, url = endpoint) { store.setValue('ollamaUrl', url); select(model); }
process.env.OLLAMA_MODEL = original; process.env.OLLAMA_URL = endpoint;
process.env.FROK_DATA_DIR = path.join(testDir, 'data');
process.env.VPIPE_WORKDIR = path.join(testDir, 'unused-models');
process.env.VPIPE_BIN = process.execPath;
process.env.FFMPEG_BIN = process.execPath; process.env.FFPROBE_BIN = process.execPath;
process.chdir(testDir);
const { ollamaConfig, defaultOllamaModel } = await import('../src/lib/ollama-config');
const { health, runSetup } = await import('../src/lib/setup');
const { promptModelStatus } = await import('../src/lib/ollama-status');
const { enhancePrompt } = await import('../src/lib/ollama');
const routes = await import('../src/app/api/[[...segments]]/route');
const fixture = await createLibraryFixture();
const { test, after, beforeEach } = fixture;
const { setServiceValue } = await import('../src/lib/registry');
const store = await import('../src/lib/db');
function select(model:string){store.setValue('modelSelections',{...store.settings().modelSelections,prompt:model});}
let installed = new Map<string, Set<string>>();
let installCompletes = true, pullText = '{"status":"success"}';
const calls: { path: string; url: string; body: Record<string, unknown> }[] = [];
async function call(method: 'GET'|'POST'|'PATCH', route: string, body?: object) {
  return routes[method](fixture.request(`http://localhost:3000/api/${route}`, { method, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ segments: route.split('?')[0].split('/') }) });
}
async function status(force = true) { return (await call('GET', `health${force ? '?refresh=1' : ''}`)).json(); }
beforeEach(() => {
  delete process.env.FROK_MANAGE_OLLAMA;
  installed = new Map([[endpoint, new Set([original])]]); installCompletes = true; pullText = '{"status":"success"}'; calls.length = 0;
  store.db.exec('DELETE FROM jobs; DELETE FROM settings;'); configure();store.setValue('connections',{vpipe:false,comfyui:false,ollama:true}); setServiceValue('workerHeartbeat', Date.now());
  mock.restoreAll();
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) mock.method(childProcess, method, () => { throw new Error('Processes are disabled in Ollama readiness tests'); });
  syncBuiltinESMExports();
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)), body = init.body ? JSON.parse(String(init.body)) : {};
    init.signal?.throwIfAborted();
    calls.push({ path: url.pathname, url: url.origin, body });
    assert.equal(init.redirect, 'error', `${url.pathname} must reject redirects`);
    const models = installed.get(url.origin) || new Set<string>();
    if (url.pathname === '/api/show') return Response.json({capabilities:models.has(body.model)?['completion']:[]});
    if (url.pathname === '/api/tags') return Response.json({ models: [...models].map(name => ({ name })) });
    if (url.pathname === '/api/pull') { if (installCompletes) { models.add(body.model); installed.set(url.origin, models); } return new Response(pullText); }
    if (url.pathname === '/api/chat') return Response.json({ message: { content: 'A detailed synthetic prompt.' } });
    assert.fail(`Unexpected request: ${url}`);
  });
});
after(() => { mock.restoreAll(); syncBuiltinESMExports(); fixture.close(); process.chdir(previousDir); fs.rmSync(testDir, { recursive: true, force: true }); });

test('Ready checks the exact configured model, ignoring old models and preparation receipts', async () => {
  assert.equal((await status()).ollama, true);
  assert.equal(store.settings().ollamaModel, original);
  setServiceValue(`prepared:ollama:${JSON.stringify([endpoint,original])}`,true);
  configure(replacement); select(replacement);
  const next = await status(false); // Model identity must invalidate the cached Ready immediately.
  assert.equal(next.ollamaModel, replacement); assert.equal(next.ollamaUrl, endpoint);
  assert.equal(store.settings().ollamaModel, next.ollamaModel);
  assert.equal(next.ollamaConnected, true); assert.equal(next.ollama, false); assert.equal(next.models.ollama, false);
  assert.equal(next.checks.find((check: {id:string}) => check.id === 'ollama').ready, false);
  assert.match(next.checks.find((check: {id:string}) => check.id === 'ollama').detail, /installed text-generation model/);
});

test('installation and completion capability checks reflect model deletion on recheck', async () => {
  assert.equal((await status()).ollama, true);
  assert.deepEqual(calls.filter(call=>call.path.startsWith('/api/')).map(call => call.path), ['/api/tags','/api/show']);
  installed.get(endpoint)!.clear(); assert.equal((await status()).ollama, false);
  installed.get(endpoint)!.add(original); assert.equal((await status()).ollama, true);
});

test('changing the service invalidates readiness even with the same model name', async () => {
  assert.equal((await status()).ollama, true);
  configure(original, 'http://127.0.0.1:19082');
  const next = await status(false); assert.equal(next.ollama, false); assert.equal(next.ollamaUrl, 'http://127.0.0.1:19082');
});

test('missing, malformed and unreachable services never claim model readiness', async () => {
  for (const response of [new Response('', {status:503}), Response.json({}), Response.json({models:[{name: original + '-different'}]})]) {
    mock.method(globalThis, 'fetch', async () => response);
    assert.equal((await promptModelStatus({url:endpoint,model:original})).ready, false);
  }
  mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
  assert.deepEqual(await promptModelStatus({url:endpoint,model:original}), {connected:false,ready:false,models:[]});
});

pureTest('installed choices accept Ollama name/model fields, normalize latest aliases and discard invalid entries', () => {
  assert.deepEqual(installedOllamaModels([{name:'zeta:4b'},{model:'alpha:latest'},{name:'alpha'},null,{name:42},{name:''},{name:'bad model'},{name:'<script>'}]),['alpha','zeta:4b']);
});

test('health lists installed choices from the configured service and settings revalidate selection before saving', async () => {
  installed.get(endpoint)!.add(replacement);
  const initial=await status();
  assert.deepEqual(initial.ollamaModels,[replacement,original].sort());
  calls.length=0;
  assert.equal((await call('PATCH','settings',{ollamaModel:replacement})).status,200);
  assert.deepEqual(calls.filter(call=>call.path.startsWith('/api/')).map(call=>call.path),['/api/tags','/api/show','/api/show']);
  const updated=await status(false);
  assert.equal(updated.ollamaModel,replacement); assert.equal(updated.ollama,true);
  installed.get(endpoint)!.delete(original);
  assert.equal((await call('PATCH','settings',{ollamaModel:original,setupDismissed:true})).status,409);
  assert.equal(store.settings().ollamaModel,replacement); assert.equal(store.settings().setupDismissed,false);
  installed.get(endpoint)!.delete(replacement);
  const removed=await status();assert.deepEqual(removed.ollamaModels,[]);assert.equal(removed.ollama,false);
  mock.method(globalThis,'fetch',async()=>{throw Error('Offline');});
  assert.equal((await call('PATCH','settings',{ollamaModel:original})).status,503);
  assert.equal(store.settings().ollamaModel,replacement);
});

test('prompt settings offer installed models in a select and clearly identify a missing saved model', async () => {
  configure(replacement); select(replacement);
  const state=await status();
  const html=renderToStaticMarkup(createElement(PromptModelSettings,{health:state,jobs:[],checking:false,onRefresh:()=>{},onPrepare:async()=>{}}));
  assert.match(html,/<select/); assert.match(html,/Ollama model/);
  assert.ok(html.includes(`value="${original}"`));
  assert.ok(html.includes(`value="${replacement}" disabled=""`));
  assert.match(html,/Connection or model unavailable/);
  installed.get(endpoint)!.clear();
  const empty=renderToStaticMarkup(createElement(PromptModelSettings,{health:await status(),jobs:[],checking:false,onRefresh:()=>{},onPrepare:async()=>{}}));
  assert.match(empty,/No compatible text-generation models are installed/);
});

test('chat and queued installs use the current configuration; queued targets stay fixed', async () => {
  const old = (await (await call('POST', 'setup', {task:'ollama'})).json()).job;
  configure(replacement); select(replacement);
  await enhancePrompt('Test prompt', false, new AbortController().signal);
  assert.equal(calls.find(call => call.path === '/api/chat')!.body.model, replacement);
  const next = (await (await call('POST', 'setup', {task:'ollama'})).json()).job;
  assert.notEqual(next.id, old.id); assert.equal(next.request.ollama.model, replacement);
  assert.equal((await (await call('POST', 'setup', {task:'ollama'})).json()).job.id, next.id);
  await runSetup('ollama', new AbortController().signal, () => {}, old.request.ollama);
  assert.equal(calls.find(call => call.path === '/api/pull')!.body.model, original);
  assert.equal((await status()).ollama, false);
  await runSetup('ollama', new AbortController().signal, () => {}, next.request.ollama);
  assert.equal((await status()).ollama, true);
});

test('a pull is not complete until the target is available; final stream errors are checked', async () => {
  configure(replacement); select(replacement); installCompletes = false;
  await assert.rejects(runSetup('ollama', new AbortController().signal, () => {}), /not made .* available/);
  assert.equal((await status()).ollama, false);
  pullText = '{"error":"Download failed"}';
  await assert.rejects(runSetup('ollama', new AbortController().signal, () => {}), /Download failed/);
});

test('editing old environment files no longer changes the active saved configuration', () => {
  const current = ollamaConfig();
  fs.writeFileSync(path.join(testDir, '.env.local'), 'OLLAMA_MODEL=another:model\nOLLAMA_URL=http://localhost:19999\n');
  assert.deepEqual(ollamaConfig(), current);
  configure(replacement); assert.equal(ollamaConfig().model, replacement);
  fs.writeFileSync(path.join(testDir, '.env.local'), '');
  assert.equal(ollamaConfig().model, replacement);
});

test('Models shows the missing selected model and a download action without a stale Ready badge', async () => {
  configure(replacement); select(replacement); const state = await health();
  const props = {health:state,jobs:[],checking:false,onPrepare:async()=>{},onRefresh:()=>{}};
  const html = renderToStaticMarkup(createElement(OllamaConnection, props));
  const promptRow = html.slice(html.indexOf('Prompt enhancement</h3>'), html.indexOf('</section>',html.indexOf('Prompt enhancement</h3>')));
  assert.ok(promptRow.includes(replacement));
  assert.ok(promptRow.includes('Download prompt model')); assert.ok(!promptRow.includes('settings-ready'));
  const checking = renderToStaticMarkup(createElement(OllamaConnection, {...props,checking:true,health:{...state,ollama:true}}));
  const checkingRow = checking.slice(checking.indexOf('Prompt enhancement</h3>'), checking.indexOf('</section>',checking.indexOf('Prompt enhancement</h3>')));
  assert.ok(checkingRow.includes('Checking')); assert.ok(!checkingRow.includes('settings-ready'));
});

test('saving a local connection refreshes its models, persists the address, and sends prompts to the chosen model',async()=>{
  const nextUrl='http://127.0.0.1:19082';installed.set(nextUrl,new Set([replacement]));
  assert.equal((await status()).ollama,true);
  const connected=await call('PATCH','settings',{ollamaUrl:`${nextUrl}/`,connections:{ollama:true}});
  assert.equal(connected.status,200,await connected.clone().text());
  assert.equal(store.settings().ollamaUrl,nextUrl);assert.equal(ollamaConfig().url,nextUrl);
  const next=await status(false);assert.equal(next.ollama,false);assert.deepEqual(next.ollamaModels,[replacement]);
  assert.equal(next.ollamaModel,original); // Preserve the choice, but mark it unavailable.
  assert.equal((await call('PATCH','settings',{modelSelections:{prompt:original}})).status,409);
  const chosen=await call('POST','setup/connection',{connection:'ollama',promptModel:replacement});
  assert.equal(chosen.status,201,await chosen.clone().text());assert.deepEqual((await chosen.json()).jobs,[]);
  assert.equal((await status(false)).ollama,true);
  await enhancePrompt('Synthetic prompt',false,new AbortController().signal);
  const chat=calls.find(call=>call.path==='/api/chat')!;assert.equal(chat.url,nextUrl);assert.equal(chat.body.model,replacement);
  assert.equal(store.listJobs().length,0);assert.ok(!calls.some(call=>call.path==='/api/pull'));
});

test('invalid addresses and failed connection checks leave the saved connection unchanged',async()=>{
  for(const url of ['https://other.example','http://127.0.0.1:11434/path','http://user:secret@localhost:11434','http://localhost:11434?token=secret','file:///tmp/models']){
    calls.length=0;
    assert.equal((await call('PATCH','settings',{ollamaUrl:url})).status,400);
    assert.equal(calls.length,0);assert.equal(store.settings().ollamaUrl,endpoint);
  }
  mock.method(globalThis,'fetch',async()=>{throw Error('Synthetic offline service');});
  assert.equal((await call('PATCH','settings',{ollamaUrl:'http://127.0.0.1:19099',setupDismissed:true})).status,409);
  assert.equal(store.settings().ollamaUrl,endpoint);assert.equal(store.settings().setupDismissed,false);
});

test('empty external Ollama connections never automatically queue a starter download',async()=>{
  installed.get(endpoint)!.clear();store.setValue('modelSelections',{...store.settings().modelSelections,prompt:null});
  assert.equal((await call('PATCH','settings',{ollamaUrl:endpoint,connections:{ollama:true}})).status,200);
  assert.equal((await call('POST','setup/connection',{connection:'ollama'})).status,409);
  assert.equal(store.listJobs().length,0);
  const state=await status();
  const html=renderToStaticMarkup(createElement(PromptModelSettings,{health:state,jobs:[],checking:false,onRefresh:()=>{},onPrepare:async()=>{}}));
  assert.match(html,/Install one in Ollama/);assert.doesNotMatch(html,/Download prompt model/);
  const connection=renderToStaticMarkup(createElement(OllamaConnection,{health:state,jobs:[],checking:false,onRefresh:()=>{},onPrepare:async()=>{}}));
  assert.match(connection,/<input type="url"/);assert.doesNotMatch(connection,/readOnly|readonly|Install runtime/);
});

test('discovery excludes embedding-only and cloud models while allowing text-capable vision models',async()=>{
  const requested:string[]=[];
  mock.method(globalThis,'fetch',async(input:string|URL|Request,init:RequestInit={})=>{
    const url=new URL(String(input));
    if(url.pathname==='/api/tags')return Response.json({models:[{name:'writer'},{name:'vision'},{name:'embed'},{name:'remote',remote_model:'cloud-writer'},{name:'remote-show'},{name:'unknown'}]});
    assert.equal(url.pathname,'/api/show');const {model}=JSON.parse(String(init.body));requested.push(model);
    return Response.json(model==='remote-show'?{capabilities:['completion'],remote_host:'https://ollama.com'}:{capabilities:({writer:['completion'],vision:['completion','vision'],embed:['embedding']} as Record<string,string[]>)[model]});
  });
  assert.deepEqual(await promptModelStatus({url:endpoint,model:'writer:latest'}),{connected:true,ready:true,models:['vision','writer']});
  assert.ok(!requested.includes('remote'));
});

test('standard local Ollama remains the default even with a retired managed setting', () => {
  store.setValue('environmentDefaults', {}); store.setValue('ollamaUrl', '');
  assert.equal(ollamaConfig().url, 'http://127.0.0.1:11434');
  store.setValue('runtimeOptions', {manageOllama:true});
  assert.equal(ollamaConfig().url, 'http://127.0.0.1:11434');
  store.setValue('modelSelections', {...store.settings().modelSelections, prompt:''});
  assert.equal(ollamaConfig().model, defaultOllamaModel);
});

test('an in-flight old model check cannot publish Ready after configuration changes', async () => {
  let started!: () => void, release!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetch = globalThis.fetch;
  let first = true;
  mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).endsWith('/api/tags') && first) { first = false; started(); await gate; }
    return fetch(...args);
  });
  const old = status();
  await pending; configure(replacement); select(replacement);
  const current = await status(); release();
  assert.equal(current.ollama, false); assert.equal(current.ollamaModel, replacement);
  const late = await old;
  assert.equal(late.ollama, false); assert.equal(late.ollamaModel, replacement);
});
