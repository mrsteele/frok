import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ensureWorkspace } from '../desktop/workspace.mjs';

// Run only against the packaged payload and a new, disposable workspace.
const base = path.resolve('.data'); await fs.mkdir(base, { recursive: true });
const home = await fs.mkdtemp(path.join(base, 'desktop-smoke-test-'));
const backend = path.resolve('.desktop/backend');
const groups = JSON.parse(await fs.readFile('desktop/pipelines.json', 'utf8'));
const workspace = await ensureWorkspace({ home, templates: path.resolve('.desktop/pipeline-templates'), groups, version: '0.1.0' });
const port = await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const origin = `http://127.0.0.1:${port}`, token = randomBytes(32).toString('hex');
const child = fork(path.join(backend, 'supervisor.mjs'), [], { execPath: path.resolve('.desktop/runtime', process.platform === 'win32' ? 'node.exe' : 'node'), execArgv: [], cwd: backend, env: { ...process.env, FROK_APP_ROOT: backend, FROK_ENV_FILE: workspace.envFile, FROK_DESKTOP_DEV: '0', FROK_DATA_DIR: workspace.data, FROK_PIPELINES_DIR: workspace.pipelines, FROK_LOG_DIR: workspace.logs, FROK_DESKTOP_TOKEN: token, FROK_ORIGIN: origin, NODE_ENV: 'production', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let failed;
child.on('message', message => { if (message?.type === 'fatal') failed = Error(message.message); });
function waitFor(predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(Error('Desktop smoke check timed out')), 60_000);
    const message = value => { if (value?.type === 'fatal') finish(Error(value.message)); else if (predicate(value)) finish(null, value); };
    const exit = code => finish(Error(`Desktop service exited early: ${code}`));
    function finish(error, value) { clearTimeout(timer); child.off('message', message); child.off('exit', exit); if (error) reject(error); else resolve(value); }
    child.on('message', message); child.on('exit', exit);
  });
}
try {
  await waitFor(message => message?.type === 'ready');
  const blocked = await fetch(origin + '/'); assert.equal(blocked.status, 403); await blocked.body?.cancel();
  const headers = { 'x-frok-desktop-token': token, Origin: origin, 'X-Frok-Request': '1' };
  const page = await fetch(origin + '/', { headers }); assert.equal(page.status, 200); assert.match(await page.text(), /Frok/);
  for (let i = 0; i < 2; i++) {
    const jobs = await fetch(origin + '/api/jobs', { headers }); assert.equal(jobs.status, 200); assert.deepEqual((await jobs.json()).jobs, []);
    assert.equal(jobs.headers.get('set-cookie'),null);
  }
  const draining = waitFor(message => message?.type === 'queue-state' && message.draining); child.send({ type: 'drain' }); assert.equal((await draining).running, false);
  const resumed = waitFor(message => message?.type === 'queue-state' && !message.draining); child.send({ type: 'resume' }); await resumed;
  if (failed) throw failed;
  console.log('Packaged backend passed: portable Node, Next server, worker, launch authentication, one library without browser accounts, and drain/resume. No generators ran.');
} finally {
  if (child.connected) { const exit = once(child, 'exit'); child.send({ type: 'stop' }); await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 15_000).unref())]); }
  if (child.exitCode === null && !child.signalCode) { child.kill('SIGTERM'); await once(child, 'exit'); }
  if (failed) console.error(await fs.readFile(path.join(workspace.logs, 'backend.log'), 'utf8'));
  await fs.rm(home, { recursive: true, force: true });
}
