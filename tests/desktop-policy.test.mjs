import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { isAppUrl, externalUrl } from '../desktop/policy.mjs';
import { WorkerControl } from '../desktop/worker-control.mjs';

test('native bridge accepts only the exact desktop origin', () => {
  const origin = 'http://127.0.0.1:3440';
  assert.equal(isAppUrl(origin + '/images/test', origin), true);
  for (const url of ['http://127.0.0.1:3000', 'http://localhost:3440', 'https://evil.test', 'file:///tmp/index.html', 'http://user@127.0.0.1:3440', 'invalid']) assert.equal(isAppUrl(url, origin), false);
});
test('external navigation never launches filesystem or executable schemes', () => {
  assert.equal(externalUrl('https://example.com/docs'), 'https://example.com/docs');
  for (const url of ['file:///tmp/a', 'javascript:alert(1)', 'http://localhost:3000', 'https://user:pass@example.com', 'vpipe://execute']) assert.equal(externalUrl(url), undefined);
});
test('queue drain prevents new claims without stopping the current job', () => {
  const control = new WorkerControl(); assert.equal(control.mayClaim, true);
  assert.equal(control.accept({ type: 'drain' }), false); assert.equal(control.mayClaim, false); assert.equal(control.stopped, false);
  control.accept({ type: 'resume' }); assert.equal(control.mayClaim, true);
  assert.equal(control.accept({ type: 'stop' }), true); assert.equal(control.mayClaim, false);
});
test('unknown control messages do not change worker behavior', () => {
  const control = new WorkerControl(); control.accept({ type: 'delete-everything' }); control.accept(null); assert.equal(control.mayClaim, true);
});
test('local packaging never publishes a release', async () => {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.match(pkg.scripts.package, /desktop-package.mjs/);
  assert.match(await fs.readFile('scripts/desktop-package.mjs', 'utf8'), /'--publish', 'never'/);
  assert.ok(pkg.dependencies['electron-updater']);
});
test('the installer pipeline manifest excludes personal workflows and includes every companion', async () => {
  const groups = JSON.parse(await fs.readFile('desktop/pipelines.json', 'utf8'));
  assert.ok(groups.length > 0);
  for (const group of groups) {
    assert.ok(group.some(file => file.endsWith('/meta.json')));
    for (const file of group) { assert.ok(!file.includes('.local.')); assert.ok((await fs.stat('resources/pipelines/' + file)).isFile()); }
  }
});
