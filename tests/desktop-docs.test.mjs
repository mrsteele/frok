import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { docsPage, docsResponse, isDocsUrl, onlineDocsUrl } from '../desktop/docs-content.mjs';

test('documentation routes preserve anchors and reject URLs or arbitrary file paths', () => {
  assert.equal(docsPage('/guide/images#variations'), '/guide/images.html#variations');
  assert.equal(docsPage(), '/index.html');
  for (const value of ['https://example.com', '//evil', '/../secret', '/%2e%2e/file', '/a\\b', '/a?token=secret', '/file.json', null]) assert.throws(() => docsPage(value));
  assert.ok(isDocsUrl('frok-docs://help/index.html'));
  for (const value of ['frok-docs://help.evil/', 'frok-docs://user@help/', 'file:///help', 'http://127.0.0.1:3440/']) assert.equal(isDocsUrl(value), false);
});
test('online links are optional HTTPS and keep deployment subpaths and section anchors', () => {
  assert.equal(onlineDocsUrl('https://docs.example.com/frok', '/guide/images#variations'), 'https://docs.example.com/frok/guide/images.html#variations');
  for (const base of [undefined, '', 'http://example.com', 'https://user:pass@example.com', 'file:///tmp', 'https://example.com/?token=secret']) assert.equal(onlineDocsUrl(base, '/'), undefined);
});
test('offline site serves pages, modules and downloads without exposing files outside its root', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-docs-test-'));
  try {
    const root = path.join(temp, 'site');
    await fs.mkdir(path.join(root, 'examples/krea'), { recursive:true });
    await fs.writeFile(path.join(root, 'index.html'), '<h1>Offline help</h1>');
    await fs.writeFile(path.join(root, 'app.js'), 'export default 1');
    await fs.writeFile(path.join(root, 'examples/krea/run.vpipeline'), 'pipeline fixture');
    await fs.writeFile(path.join(root, 'examples/krea/VPIPE-LICENSE.txt'), 'upstream license fixture');
    await fs.writeFile(path.join(temp, 'private.html'), 'private fixture');
    let symlink = true;
    try { await fs.symlink(path.join(temp, 'private.html'), path.join(root, 'escape.html')); }
    catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') symlink = false; else throw error; }
    const serve = docsResponse(root);
    const get = (pathname, method='GET') => serve({ url:`frok-docs://help${pathname}`, method });
    const home = await get('/');
    assert.equal(home.status, 200); assert.match(await home.text(), /Offline help/);
    assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match((await get('/app.js')).headers.get('content-type'), /javascript/);
    assert.match((await get('/examples/krea/run.vpipeline')).headers.get('content-disposition'), /attachment/);
    const license=await get('/examples/krea/VPIPE-LICENSE.txt');
    assert.equal(license.status,200);assert.match(license.headers.get('content-type'),/text\/plain/);assert.match(license.headers.get('content-disposition'),/attachment/);
    assert.equal(await license.text(),'upstream license fixture');
    assert.equal(await (await get('/', 'HEAD')).text(), '');
    assert.equal((await get('/', 'POST')).status, 405);
    if (symlink) assert.equal((await get('/escape.html')).status, 403);
    assert.equal((await get('/%2e%2e%2fprivate.html')).status, 403);
    assert.equal((await get('/.env')).status, 403);
    assert.equal((await get('/missing.html')).status, 404);
    assert.equal((await serve({ url:'file:///private.html', method:'GET' })).status, 403);
  } finally { await fs.rm(temp, { recursive:true, force:true }); }
});
test('desktop installer carries the compiled docs, not their source or dependency tree', async () => {
  const config = JSON.parse(await fs.readFile(new URL('../electron-builder.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.extraResources.find(item => item.to === 'docs'), { from:'.desktop/docs', to:'docs' });
});

test('offline demo videos support full playback, byte ranges and HEAD', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'frok-docs-video-test-'));
  try {
    await fs.writeFile(path.join(root,'clip.mp4'),Buffer.from('0123456789'));
    const serve=docsResponse(root);
    const get=(range,method='GET')=>serve(new Request('frok-docs://help/clip.mp4',{method,headers:range?{Range:range}:{}}));
    const full=await get();assert.equal(full.headers.get('content-type'),'video/mp4');assert.equal(await full.text(),'0123456789');
    const part=await get('bytes=2-5');assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),'bytes 2-5/10');assert.equal(await part.text(),'2345');
    assert.equal(await (await get('bytes=-3')).text(),'789');
    assert.equal(await (await get('bytes=7-')).text(),'789');
    for(const range of ['bytes=10-','bytes=6-2','bytes=-0','bytes=0-1,4-5','garbage'])assert.equal((await get(range)).status,416);
    const head=await get(undefined,'HEAD');assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
