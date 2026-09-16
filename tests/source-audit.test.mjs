import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { candidateFiles, checkSource, sourceIssues } from '../scripts/check-source.mjs';

test('source checks reject environment and private files without returning secret values', () => {
  assert.deepEqual(sourceIssues('.env.development.example', ''), ['private/runtime file is included']);
  assert.ok(sourceIssues('.env', '').length);
  assert.ok(sourceIssues('.env.local', '').length);
  assert.ok(sourceIssues('frok-backup.tar.gz', '').length);
  assert.deepEqual(sourceIssues('docs/public/demo/sailboat.mp4', ''), []);
  assert.ok(sourceIssues('docs/public/demo/personal.mp4', '').length);
  assert.ok(sourceIssues('.data/sailboat.mp4', '').length);
  assert.ok(sourceIssues('.next-product-review/server/app.js', '').length);
  assert.ok(sourceIssues('.media-tools/darwin-arm64/ffmpeg', '').length);
  assert.ok(sourceIssues('resources/pipelines/custom.local/run.json', '').length);
  const token = 'hf_' + 'a'.repeat(36);
  assert.deepEqual(sourceIssues('config.ts', token), ['possible Hugging Face token']);
});

test('a first-commit audit honors nested ignores without initializing the project', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-audit-test-'));
  try {
    await fs.writeFile(path.join(directory, '.gitignore'), '.data/\nnode_modules/\n.env*\n');
    await fs.mkdir(path.join(directory, '.data'));
    await fs.mkdir(path.join(directory, 'docs/node_modules'), { recursive: true });
    await fs.writeFile(path.join(directory, '.data/private.sqlite'), 'private fixture');
    await fs.writeFile(path.join(directory, 'docs/node_modules/cache.json'), 'cache fixture');
    await fs.writeFile(path.join(directory, '.env.local'), 'private fixture');
    await fs.writeFile(path.join(directory, '.env.development.example'), 'private fixture');
    await fs.writeFile(path.join(directory, 'app.ts'), 'export const version = "0.1.0";\n');
    const result = await checkSource(directory);
    assert.deepEqual(result.files, ['.gitignore', 'app.ts']);
    assert.deepEqual(result.findings, []);
    await assert.rejects(fs.stat(path.join(directory, '.git')), { code: 'ENOENT' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('ignored files that were already staged are still reported', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-audit-test-'));
  try {
    const options = { cwd: directory, stdio: 'ignore' };
    execFileSync('git', ['init'], options);
    await fs.writeFile(path.join(directory, '.gitignore'), '*.sqlite\n');
    await fs.writeFile(path.join(directory, 'private.sqlite'), 'private fixture');
    execFileSync('git', ['add', '-f', 'private.sqlite'], options);
    assert.ok((await candidateFiles(directory)).includes('private.sqlite'));
    assert.deepEqual((await checkSource(directory)).findings, ['private.sqlite: private/runtime file is included']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('shipped pipeline bundles exclude personal and obsolete templates', async () => {
  const groups = JSON.parse(await fs.readFile(new URL('../desktop/pipelines.json', import.meta.url), 'utf8'));
  assert.ok(groups.length);
  for (const file of groups.flat()) {
    assert.match(file, /^(image|video|reference|upscale)\/[a-z0-9-]+\/(meta\.json|run\.(?:json|vpipeline))$/);
    assert.ok(!file.includes('.local'));
    await fs.access(new URL(`../resources/pipelines/${file}`, import.meta.url));
  }
  const preparations=JSON.parse(await fs.readFile(new URL('../desktop/preparations.json',import.meta.url),'utf8'));
  for(const folder of preparations){
    assert.match(folder,/^(image|video|reference|upscale)\/[a-z0-9-]+$/);
    const metadata=JSON.parse(await fs.readFile(new URL(`../resources/pipelines/${folder}/meta.json`,import.meta.url),'utf8'));
    const extension=metadata.runner==='vpipe'?'vpipeline':'json';
    assert.ok(groups.flat().includes(`${folder}/run.${extension}`));
    const file=JSON.parse(await fs.readFile(new URL(`../resources/pipelines/${folder}/prepare.${extension}`,import.meta.url),'utf8'));
    if(extension==='vpipeline')assert.ok(file.stages.length,'A native setup has a preparation pipeline.');
    else {assert.deepEqual(file.files,metadata.dependencies);assert.ok(file.files.every(d=>d.url&&d.size&&d.sha256),'File setup pins every download.');}
  }
});

test('an unstaged tracked deletion does not abort the source audit',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'frok-audit-test-'));
  try{
    const options={cwd:directory,stdio:'ignore'};
    execFileSync('git',['init'],options);
    await fs.writeFile(path.join(directory,'obsolete.ts'),'export const obsolete=true;\n');
    execFileSync('git',['add','obsolete.ts'],options);
    await fs.unlink(path.join(directory,'obsolete.ts'));
    assert.deepEqual((await checkSource(directory)).findings,[]);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('documentation images are present in the source files Git will include', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = await candidateFiles(root), included = new Set(files);
  for (const filename of files.filter(file => file.startsWith('docs/') && file.endsWith('.md'))) {
    const markdown = await fs.readFile(path.join(root, filename), 'utf8');
    for (const [, url] of markdown.matchAll(/!\[[^\]]*\]\((\/[^\s)]+)\)/g)) {
      const asset = `docs/public${url}`;
      assert.ok(included.has(asset), `${filename} references ${asset}, but Git excludes it from the source checkout`);
      assert.ok((await fs.stat(path.join(root, asset))).isFile(), `${filename} references a missing image: ${asset}`);
    }
  }
});

test('documentation screenshots remain includable on case-insensitive checkouts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-docs-ignore-test-'));
  try {
    const options = { cwd: directory, stdio: 'ignore' };
    execFileSync('git', ['init'], options);
    execFileSync('git', ['config', 'core.ignorecase', 'true'], options);
    await fs.copyFile(new URL('../.gitignore', import.meta.url), path.join(directory, '.gitignore'));
    await fs.mkdir(path.join(directory, 'docs/public/screenshots'), { recursive: true });
    await fs.writeFile(path.join(directory, 'docs/public/screenshots/navigation.png'), 'documentation image fixture');
    await fs.writeFile(path.join(directory, 'Screenshot personal.png'), 'personal screenshot fixture');
    const files = await candidateFiles(directory);
    assert.ok(files.includes('docs/public/screenshots/navigation.png'));
    assert.ok(!files.includes('Screenshot personal.png'));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
