import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {seedvr2Fingerprint, seedvr2Models} from '../src/lib/seedvr2-profile';
import type {Media} from '../src/lib/types';

// Synthetic runtime only: the .venv executable below is a Node stub. Neither
// the real installed Python/SeedVR2 nor real FFmpeg or model files are opened.
const root = await fs.realpath(await fs.mkdtemp(path.join(process.cwd(), '.data', 'seedvr2-isolation-test-')));
process.env.FROK_DATA_DIR = root;
process.env.FFMPEG_BIN = path.join(root, 'ffmpeg.mjs');
process.env.FFPROBE_BIN = path.join(root, 'ffprobe.mjs');
const {registry} = await import('../src/lib/registry');
const {libraryDirectory:libraryDirectory}=await import('../src/lib/library');
const runJob=<T>(_label:string,fn:()=>T,_kind?:string)=>fn();
const {seedvr2Dir, seedvr2Ready, upscaleSeedvr2} = await import('../src/lib/seedvr2');
const owners=['job-a','job-b'];
const python = path.join(seedvr2Dir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const source = path.join(seedvr2Dir, 'source'), models = path.join(seedvr2Dir, 'models');
const cacheKeys = ['HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
  'HF_HOME', 'HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE', 'HF_ASSETS_CACHE', 'HF_XET_CACHE', 'TRANSFORMERS_CACHE', 'TORCH_HOME',
  'TORCH_EXTENSIONS_DIR', 'TORCHINDUCTOR_CACHE_DIR', 'TORCH_COMPILE_DEBUG_DIR', 'TRITON_CACHE_DIR', 'CUDA_CACHE_PATH', 'NUMBA_CACHE_DIR',
  'MPLCONFIGDIR', 'PIP_CACHE_DIR', 'UV_CACHE_DIR', 'PYTHONPYCACHEPREFIX'];
const stub = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2), cwd=process.cwd();
const kind=path.basename(process.argv[1]).startsWith('python')?'python':path.basename(process.argv[1]).split('.')[0];
const keys=${JSON.stringify(cacheKeys)};
const env=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
for(const dir of new Set(Object.values(env))){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'synthetic-scratch'),'synthetic private scratch');}
fs.writeFileSync(path.join(cwd,kind+'-frames.tmp'),'synthetic frame/latent spill');
fs.writeFileSync(path.join(path.dirname(cwd),path.basename(cwd)+'-'+kind+'.json'),JSON.stringify({cwd,args,env,pythonPath:process.env.PYTHONPATH,noBytecode:process.env.PYTHONDONTWRITEBYTECODE,pythonHome:process.env.PYTHONHOME,ffreport:process.env.FFREPORT,torchTrace:process.env.TORCH_TRACE,hasToken:!!process.env.HF_TOKEN||!!process.env.HUGGING_FACE_HUB_TOKEN}));
if(kind==='python'){
  const mode=fs.readFileSync(args[1],'utf8');
  fs.writeFileSync(args[args.indexOf('--output')+1],'synthetic restored output');
  if(mode==='fail')process.exit(7);
  if(mode==='cancel'){process.stdout.write('SYNTHETIC_READY\\n');setInterval(()=>{},1000);}
}else if(kind==='ffprobe')process.stdout.write(JSON.stringify({streams:[{codec_type:'video',width:1280,height:720}],format:{duration:'6'}}));
else fs.copyFileSync(args[args.indexOf('-i')+1],args.at(-1));
`;
for (const directory of [path.dirname(python), source, models]) await fs.mkdir(directory, {recursive: true});
for (const executable of [python, process.env.FFMPEG_BIN!, process.env.FFPROBE_BIN!]) await fs.writeFile(executable, stub, {mode: 0o700});
const required = [python, ...['inference_cli.py', 'pos_emb.pt', 'neg_emb.pt'].map(name => path.join(source, name)), ...seedvr2Models.map(model => path.join(models, model.name))];
for (const file of required.slice(1)) await fs.writeFile(file, 'synthetic installation marker');
const files: Record<string, {size: number; mtimeMs: number}> = {};
for (const file of required) { const stat = await fs.stat(file); files[path.relative(seedvr2Dir, file)] = {size: stat.size, mtimeMs: stat.mtimeMs}; }
await fs.writeFile(path.join(seedvr2Dir, 'ready.json'), JSON.stringify({fingerprint: seedvr2Fingerprint, device: 'mps', files}));
const sentinel = path.join(seedvr2Dir, 'cache', 'keep.txt');
await fs.mkdir(path.dirname(sentinel)); await fs.writeFile(sentinel, 'shared install cache sentinel');
const inheritedKeys = ['HF_HUB_CACHE', 'TORCHINDUCTOR_CACHE_DIR', 'TRITON_CACHE_DIR', 'PYTHONHOME', 'FFREPORT', 'TORCH_TRACE', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'];
const savedEnvironment = Object.fromEntries(inheritedKeys.map(key => [key, process.env[key]]));
for (const key of inheritedKeys) process.env[key] = path.join(seedvr2Dir, 'cache', `unsafe-${key}`);

async function job(owner: string, mode = 'success') {
  const user = runJob(owner, libraryDirectory), id = randomUUID();
  const directory = path.join(user, 'jobs', id, '0'), mediaDirectory = path.join(user, 'media');
  await fs.mkdir(directory, {recursive: true}); await fs.mkdir(mediaDirectory, {recursive: true});
  const filename = `${id}.mp4`; await fs.writeFile(path.join(mediaDirectory, filename), mode);
  const media: Media = {id, filename, kind: 'video', prompt: 'synthetic', enhancedPrompt: '', width: 640, height: 360, duration: 6,
    seed: 1, favorite: false, createdAt: new Date(0).toISOString(), origin: 'upload'};
  return {owner, directory, media, output: path.join(mediaDirectory, `${id}-upscaled.mp4`), controller: new AbortController()};
}
async function execute(input: Awaited<ReturnType<typeof job>>) {
  return runJob(input.owner, () => upscaleSeedvr2(input.media, input.output, input.directory, input.controller.signal,
    line => {if (line.includes('SYNTHETIC_READY')) input.controller.abort();}, () => {}), 'worker');
}
async function observations(directory: string) {
  const names = await fs.readdir(directory);
  assert.ok(names.every(name => name.endsWith('.json')), 'all inference workspaces must be removed');
  return Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
}
after(async () => {
  for (const [key, value] of Object.entries(savedEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  registry.close(); await fs.rm(root, {recursive: true, force: true});
});

// The shebang fixture intentionally cannot execute as a Windows .exe.
const syntheticTest = (name: string, fn: () => Promise<void>) => test(name, {skip: process.platform === 'win32'}, fn);
syntheticTest('SeedVR2 gives each job private cwd/temp/caches and keeps shared Python/source/models', async () => {
  assert.equal(await seedvr2Ready(), true);
  const inputs = await Promise.all(owners.map(owner => job(owner)));
  await Promise.all(inputs.map(execute));
  const workspaces = new Set<string>();
  for (const input of inputs) {
    assert.equal(await fs.readFile(input.output, 'utf8'), 'synthetic restored output');
    const records = await observations(input.directory); assert.equal(records.length, 3);
    for (const record of records) {
      assert.ok(record.cwd.startsWith(input.directory + path.sep)); workspaces.add(record.cwd);
      for (const key of cacheKeys) assert.ok(record.env[key].startsWith(record.cwd + path.sep), key);
      assert.equal(record.pythonPath, source); assert.equal(record.noBytecode, '1');
      assert.equal(record.pythonHome, undefined); assert.equal(record.ffreport, undefined); assert.equal(record.torchTrace, undefined);
      assert.equal(record.hasToken, false);
      await assert.rejects(fs.stat(record.cwd), {code: 'ENOENT'});
    }
    const inference = records.find(record => record.args[0] === path.join(source, 'inference_cli.py'))!;
    assert.equal(inference.args[inference.args.indexOf('--model_dir') + 1], models);
  }
  assert.equal(workspaces.size, 2);
  assert.deepEqual(await fs.readdir(path.dirname(sentinel)), ['keep.txt']);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'shared install cache sentinel');
  assert.equal(await seedvr2Ready(), true);
});

syntheticTest('SeedVR2 removes private intermediate and cache files on failure and cancellation', async () => {
  for (const mode of ['fail', 'cancel']) {
    const input = await job(owners[0], mode);
    await assert.rejects(execute(input));
    const records = await observations(input.directory); assert.equal(records.length, 1);
    await assert.rejects(fs.stat(records[0].cwd), {code: 'ENOENT'});
    await assert.rejects(fs.stat(input.output), {code: 'ENOENT'});
  }
});

test('SeedVR2 rejects outside workspaces, outside media, and output symlinks', async () => {
  const a=await job(owners[0]),outside=path.join(root,'outside.mp4');await fs.writeFile(outside,'synthetic outside');
  await assert.rejects(execute({...a,directory:root}),/local library/);
  await assert.rejects(execute({...a,output:outside}),/local library/);
  const sourcePath=path.join(libraryDirectory(),'media',a.media.filename);
  await fs.unlink(sourcePath);await fs.symlink(outside,sourcePath);await assert.rejects(execute(a),/local library/);
  await fs.unlink(sourcePath);await fs.writeFile(sourcePath,'success');await fs.symlink(outside,a.output);await assert.rejects(execute(a),/output file/);
  assert.deepEqual(await fs.readdir(a.directory),[]);
});
