import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { desktopNotices } from '../scripts/desktop-notices.mjs';

test('desktop notices retain runtime and compiled dependency licenses, excluding dev code and binaries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-notices-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({packages:{'':{},'node_modules/runtime':{version:'1.0.0'},'node_modules/development':{version:'1.0.0',dev:true},'node_modules/other-platform':{optional:true}}}));
  for (const name of ['runtime','development']) {
    const folder=path.join(root,'node_modules',name); await fs.mkdir(path.join(folder,'compiled/vendor'),{recursive:true});
    await fs.writeFile(path.join(folder,'package.json'),JSON.stringify({name,version:'1.0.0',license:'MIT'}));
    await fs.writeFile(path.join(folder,'LICENSE'),'supplied license');
    await fs.writeFile(path.join(folder,'compiled/vendor/NOTICE.txt'),'compiled dependency notice');
    await fs.writeFile(path.join(folder,'library.dylib'),'not a license');
  }
  const destination=path.join(root,'output');
  const inventory=await desktopNotices(root,destination);
  assert.deepEqual(inventory.map(item=>item.name),['runtime']);
  assert.equal(await fs.readFile(path.join(destination,'runtime/compiled/vendor/NOTICE.txt'),'utf8'),'compiled dependency notice');
  await assert.rejects(fs.stat(path.join(destination,'runtime/library.dylib')),{code:'ENOENT'});
  await assert.rejects(fs.stat(path.join(destination,'development')),{code:'ENOENT'});
});
