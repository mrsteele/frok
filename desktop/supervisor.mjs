import { fork, spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { processLog } from './process-log.mjs';

const development = process.env.FROK_DESKTOP_DEV === '1';
const root = process.env.FROK_APP_ROOT;
const port = Number(process.env.PORT);
const children = [];
let stopping = false, worker, workerReady = false;
const log = processLog(process.env.FROK_LOG_DIR);
const output = chunk => log.write(chunk);
function send(message) { if (process.connected) process.send?.(message); }
function track(child, label) {
  children.push(child);
  child.stdout?.on('data', output); child.stderr?.on('data', output);
  child.on('error', error => fail(`${label}: ${error.message}`));
  child.on('exit', code => { if (!stopping) fail(`${label} stopped (${code ?? 'signal'}). See backend.log for details.`); });
  return child;
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  worker?.connected && worker.send({ type: 'stop' });
  for (const child of children) if (child !== worker) child.kill('SIGTERM');
  await Promise.race([
    Promise.all(children.map(child => child.exitCode !== null || child.signalCode ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))),
    delay(12_000),
  ]);
  for (const child of children) if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  await log.close();
  process.exit(code);
}
function fail(message) { output(message + '\n'); send({ type: 'fatal', message }); void stop(1); }
process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop());
process.on('disconnect', () => void stop());
process.on('message', message => {
  if (message?.type === 'stop') void stop();
  else if (['drain', 'resume'].includes(message?.type) && worker?.connected) worker.send(message);
});

try {
  if (!root || !Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid desktop server configuration.');
  // A stable port preserves cookies and localStorage. Never silently switch to
  // another port (or attach the desktop bridge to an unrelated local service).
  await new Promise((resolve, reject) => {
    const check = net.createServer();
    check.once('error', () => reject(Error(`Port ${port} is already in use. Close the other instance or set FROK_DESKTOP_PORT.`)));
    check.listen(port, '127.0.0.1', () => check.close(resolve));
  });
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '127.0.0.1' };
  worker = track(fork(path.join(root, development ? 'src/worker/index.ts' : 'worker.mjs'), [], { cwd: root, env, execArgv: development ? ['--import', 'tsx'] : [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }), 'Queue worker');
  worker.on('message', message => { if (message?.type === 'queue-state') { workerReady = true; send(message); } });
  const serverArgs = development ? [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)] : [path.join(root, 'server.js')];
  track(spawn(process.execPath, serverArgs, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }), 'Web server');
  const deadline = Date.now() + 90_000;
  while (!stopping && Date.now() < deadline) {
    const ready = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'x-frok-desktop-token': env.FROK_DESKTOP_TOKEN }, signal: AbortSignal.timeout(2000) }).then(async response => { await response.body?.cancel(); return response.ok; }).catch(() => false);
    if (ready && workerReady) { send({ type: 'ready' }); break; }
    await delay(300);
  }
  if (!stopping && (!workerReady || Date.now() >= deadline)) throw Error('Frok did not finish starting. See backend.log for details.');
} catch (error) { fail(error.message); }
