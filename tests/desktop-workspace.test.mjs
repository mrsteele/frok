import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureWorkspace, workspacePaths, resetPipelines } from '../desktop/workspace.mjs';

const root = path.resolve('.data/desktop-workspace-test');
const home = path.join(root, 'home'), templates = path.join(root, 'templates');
const group = ['image/example/run.vpipeline', 'image/example/meta.json', 'image/example/prepare.vpipeline'];
const stateDirectory = path.join(root, 'app-data');
const options = { home, stateDirectory, templates, groups: [group], version: '0.1.0' };
beforeEach(async () => {
  await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(path.join(templates, 'image/example'), { recursive: true });
  for (const file of group) await fs.writeFile(path.join(templates, file), `original ${file}`);
  for (const name of ['VPIPE-LICENSE', 'VPIPE-NOTICE']) await fs.writeFile(path.join(templates, name), `original ${name}`);
});
after(() => fs.rm(root, { recursive: true, force: true }));
test('first boot creates all workspace folders and installs matching pipeline companions', async () => {
  const result = await ensureWorkspace(options);
  for (const folder of ['pipelines', 'data']) assert.ok((await fs.stat(result[folder])).isDirectory());
  for (const file of group) assert.equal(await fs.readFile(path.join(result.pipelines, file), 'utf8'), `original ${file}`);
  for (const name of ['VPIPE-LICENSE', 'VPIPE-NOTICE']) assert.equal(await fs.readFile(path.join(result.pipelines, name), 'utf8'), `original ${name}`);
  assert.deepEqual(result.conflicts, []);
  await assert.rejects(fs.access(result.updates), {code:'ENOENT'});
  await assert.rejects(fs.access(path.join(home, '.pipeline-state.json')), {code:'ENOENT'});
  assert.equal(JSON.parse(await fs.readFile(path.join(stateDirectory, '.pipeline-state.json'), 'utf8')).version, 1);
  await assert.rejects(fs.access(path.join(home, 'logs')));
  await assert.rejects(fs.access(path.join(home, 'desktop-profile')));
});
test('repeat boot preserves personal pipelines, media, and configuration', async () => {
  const result = await ensureWorkspace(options);
  const personal = path.join(result.pipelines, 'image/personal.local.meta.json');
  await fs.writeFile(personal, 'personal definition'); await fs.writeFile(path.join(result.data, 'example.txt'), 'saved');
  await fs.writeFile(result.envFile, 'OLLAMA_URL=http://localhost:11434');
  await ensureWorkspace(options);
  assert.equal(await fs.readFile(personal, 'utf8'), 'personal definition');
  assert.equal(await fs.readFile(path.join(result.data, 'example.txt'), 'utf8'), 'saved');
  assert.equal(await fs.readFile(result.envFile, 'utf8'), 'OLLAMA_URL=http://localhost:11434');
});
test('updates replace untouched bundled companions together', async () => {
  const result = await ensureWorkspace(options);
  for (const file of group) await fs.writeFile(path.join(templates, file), `updated ${file}`);
  await ensureWorkspace({ ...options, version: '0.2.0' });
  for (const file of group) assert.equal(await fs.readFile(path.join(result.pipelines, file), 'utf8'), `updated ${file}`);
});
test('one edited companion preserves the entire group and stages the new bundle elsewhere', async () => {
  const result = await ensureWorkspace(options);
  await fs.writeFile(path.join(result.pipelines, group[1]), 'my edited metadata');
  for (const file of group) await fs.writeFile(path.join(templates, file), `updated ${file}`);
  const next = await ensureWorkspace({ ...options, version: '0.2.0' });
  assert.deepEqual(next.conflicts, [group[0]]);
  assert.equal(await fs.readFile(path.join(result.pipelines, group[0]), 'utf8'), `original ${group[0]}`);
  assert.equal(await fs.readFile(path.join(result.pipelines, group[1]), 'utf8'), 'my edited metadata');
  const [incoming] = await fs.readdir(result.updates);
  for (const file of group) assert.equal(await fs.readFile(path.join(result.updates, incoming, file), 'utf8'), `updated ${file}`);
  // User notes in a waiting update survive subsequent launches.
  await fs.writeFile(path.join(result.updates, incoming, 'review.txt'), 'Keep this review.');
  await ensureWorkspace({ ...options, version: '0.2.0' });
  assert.equal(await fs.readFile(path.join(result.updates, incoming, 'review.txt'), 'utf8'), 'Keep this review.');
});
test('local edits without a changed bundled version do not create an updates folder', async () => {
  const result = await ensureWorkspace(options);
  await fs.writeFile(path.join(result.pipelines, group[0]), 'my custom workflow');
  await fs.mkdir(result.updates);
  await fs.writeFile(path.join(result.updates, '.DS_Store'), 'Finder metadata');
  const next = await ensureWorkspace({ ...options, version: '0.2.0' });
  assert.deepEqual(next.conflicts, []);
  assert.equal(await fs.readFile(path.join(result.pipelines, group[0]), 'utf8'), 'my custom workflow');
  await assert.rejects(fs.access(result.updates), {code:'ENOENT'});
});
test('migrating the old installation record preserves automatic upgrades of untouched files', async () => {
  const result = await ensureWorkspace(options);
  const stateFile = path.join(stateDirectory, '.pipeline-state.json');
  const old = await fs.readFile(stateFile);
  await fs.rename(stateFile, path.join(home, '.pipeline-state.json'));
  await ensureWorkspace(options);
  assert.deepEqual(await fs.readFile(stateFile), old);
  await assert.rejects(fs.access(path.join(home, '.pipeline-state.json')), {code:'ENOENT'});
  for (const file of group) await fs.writeFile(path.join(templates, file), `next ${file}`);
  const next = await ensureWorkspace({...options, version:'0.2.0'});
  assert.deepEqual(next.conflicts, []);
  for (const file of group) assert.equal(await fs.readFile(path.join(result.pipelines, file), 'utf8'), `next ${file}`);
  await assert.rejects(fs.access(result.updates), {code:'ENOENT'});
});
test('conflicting installation records and active legacy locks cannot overwrite pipelines', async () => {
  const result = await ensureWorkspace(options);
  const stateFile = path.join(stateDirectory, '.pipeline-state.json'), old = await fs.readFile(stateFile);
  await fs.writeFile(path.join(home, '.pipeline-state.json'), JSON.stringify({version:1,files:{}}));
  await assert.rejects(ensureWorkspace(options), /Two different pipeline installation records/);
  assert.deepEqual(await fs.readFile(stateFile), old);
  await fs.rm(path.join(home, '.pipeline-state.json'));
  await fs.writeFile(path.join(home, '.pipeline-install.lock'), 'older installer');
  await assert.rejects(ensureWorkspace(options), /already in progress/);
  await assert.rejects(resetPipelines(options), /already in progress/);
  assert.equal(await fs.readFile(path.join(result.pipelines, group[0]), 'utf8'), `original ${group[0]}`);
});
test('an existing custom basename is never taken over on first boot', async () => {
  await fs.mkdir(path.join(home, 'pipelines/image/example'), { recursive: true });
  await fs.writeFile(path.join(home, 'pipelines', group[0]), 'custom');
  const result = await ensureWorkspace(options);
  assert.deepEqual(result.conflicts, [group[0]]);
  await assert.rejects(fs.stat(path.join(result.pipelines, group[1])), { code: 'ENOENT' });
});
test('corrupt installation records fail without replacing pipelines', async () => {
  const result = await ensureWorkspace(options);
  await fs.writeFile(path.join(stateDirectory, '.pipeline-state.json'), '{broken');
  await assert.rejects(ensureWorkspace(options));
  assert.equal(await fs.readFile(path.join(result.pipelines, group[0]), 'utf8'), `original ${group[0]}`);
});
test('traversal, duplicate files, and unsafe workspace roots are rejected', async () => {
  assert.throws(() => workspacePaths(path.parse(home).root));
  await assert.rejects(ensureWorkspace({ ...options, groups: [['../outside.json']] }), /manifest/);
  await assert.rejects(ensureWorkspace({ ...options, groups: [group, group] }), /manifest/);
});
test('symlinked pipeline folders cannot redirect installation writes', { skip: process.platform === 'win32' }, async () => {
  await fs.mkdir(path.join(home, 'pipelines'), { recursive: true });
  await fs.symlink(path.join(templates, 'image/example'), path.join(home, 'pipelines/image'));
  await assert.rejects(ensureWorkspace(options), /regular workspace directory/);
});
test('flat bundled pipelines move into a folder while local edits and original hashes survive',async()=>{
  const old=['image/example.vpipeline','image/example.meta.json','image/example.prepare.vpipeline'];
  await fs.mkdir(path.join(home,'pipelines/image'),{recursive:true});
  const files={};
  for(let i=0;i<group.length;i++){
    const original=`original ${group[i]}`;files[old[i]]=createHash('sha256').update(original).digest('hex');
    await fs.writeFile(path.join(home,'pipelines',old[i]),i===0?'edited workflow':original);
  }
  await fs.writeFile(path.join(home,'.pipeline-state.json'),JSON.stringify({version:1,files}));
  const result=await ensureWorkspace(options);
  assert.equal(await fs.readFile(path.join(result.pipelines,group[0]),'utf8'),'edited workflow');
  assert.deepEqual(result.conflicts,[]);
  for(const file of old)await assert.rejects(fs.stat(path.join(result.pipelines,file)),{code:'ENOENT'});
  await ensureWorkspace(options);
  assert.equal(await fs.readFile(path.join(result.pipelines,group[0]),'utf8'),'edited workflow');
});
test('conflicting old and new pipeline definitions are preserved for manual resolution',async()=>{
  const result=await ensureWorkspace(options);
  const old=path.join(result.pipelines,'image/example.vpipeline');await fs.writeFile(old,'different old edit');
  await assert.rejects(ensureWorkspace(options),/different content/);
  assert.equal(await fs.readFile(old,'utf8'),'different old edit');
  assert.equal(await fs.readFile(path.join(result.pipelines,group[0]),'utf8'),`original ${group[0]}`);
});


test('desktop development can keep disposable data while installing pipelines in a separate user folder',async()=>{
  const pipelineHome=path.join(root,'external-frok');
  const result=await ensureWorkspace({...options,pipelineHome});
  assert.equal(result.data,path.join(home,'data'));assert.equal(result.pipelines,path.join(pipelineHome,'pipelines'));
  await assert.rejects(fs.stat(path.join(home,'pipelines')),{code:'ENOENT'});
  for(const file of group)assert.ok((await fs.stat(path.join(result.pipelines,file))).isFile());
});
test('factory reset removes edits and personal files, but preserves data, models and other folders',async()=>{
  const result=await ensureWorkspace(options);
  await fs.writeFile(path.join(result.pipelines,group[0]),'edited');
  await fs.writeFile(path.join(result.pipelines,'private.json'),'custom');
  await fs.writeFile(path.join(result.data,'keep.txt'),'media marker');
  await resetPipelines(options);
  assert.equal(await fs.readFile(path.join(result.pipelines,group[0]),'utf8'),`original ${group[0]}`);
  await assert.rejects(fs.stat(path.join(result.pipelines,'private.json')),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(result.data,'keep.txt'),'utf8'),'media marker');
  assert.deepEqual((await ensureWorkspace(options)).conflicts,[]);
});
test('a missing factory template aborts reset before touching existing pipelines',async()=>{
  const result=await ensureWorkspace(options);
  await fs.writeFile(path.join(result.pipelines,group[0]),'keep this edit');
  await fs.rm(path.join(templates,group[1]));
  await assert.rejects(resetPipelines(options),/Bundled pipeline is missing/);
  assert.equal(await fs.readFile(path.join(result.pipelines,group[0]),'utf8'),'keep this edit');
  await assert.rejects(fs.stat(path.join(stateDirectory,'.pipeline-install.lock')),{code:'ENOENT'});
});
test('factory reset refuses a symlinked default pipeline directory', {skip:process.platform==='win32'},async()=>{
  await fs.mkdir(home,{recursive:true});
  await fs.symlink(templates,path.join(home,'pipelines'));
  await assert.rejects(resetPipelines(options),/regular directory/);
  assert.ok((await fs.stat(path.join(templates,group[0]))).isFile());
});
