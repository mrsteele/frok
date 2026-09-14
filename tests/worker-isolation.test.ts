import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

for (const scenario of [
  { name: 'a live legacy worker PID blocks startup without changing the legacy database', legacy: true, message: /Stop the existing Frok worker before starting the upgraded app/ },
  { name: 'maintenance blocks worker startup without claiming the worker PID', legacy: false, message: /maintenance is in progress/ },
]) {
  test(scenario.name, { timeout: 10_000 }, async () => {
    const root = process.cwd();
    const directory = fs.mkdtempSync(path.join(root, '.data', 'worker-startup-test-'));
    let worker: ChildProcess | undefined;
    let closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let output = '';
    let spawnError: Error | undefined;
    try {
      const registryPath = path.join(directory, 'registry.sqlite');
      const registry = new DatabaseSync(registryPath);
      const initialService = { maintenance: !scenario.legacy, workerPid: 0, workerHeartbeat: 12345 };
      try {
        registry.exec('CREATE TABLE service (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        for (const [key, value] of Object.entries(initialService)) registry.prepare('INSERT INTO service VALUES (?,?)').run(key, JSON.stringify(value));
      } finally { registry.close(); }

      const legacyPath = path.join(directory, 'frok.sqlite');
      let legacyBytes: Buffer | undefined;
      if (scenario.legacy) {
        const legacy = new DatabaseSync(legacyPath);
        try {
          legacy.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
          // This test process stays alive throughout the child's startup check.
          legacy.prepare('INSERT INTO settings VALUES (?,?)').run('workerPid', JSON.stringify(process.pid));
          legacy.prepare('INSERT INTO settings VALUES (?,?)').run('syntheticPreference', JSON.stringify('keep legacy data'));
        } finally { legacy.close(); }
        legacyBytes = fs.readFileSync(legacyPath);
      }

      const guard = path.join(directory, 'startup-guard.mjs');
      const attempted = path.join(directory, 'unexpected-runner-or-network');
      fs.writeFileSync(guard, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => {
  fs.writeFileSync(path.join(process.env.FROK_DATA_DIR, 'unexpected-runner-or-network'), 'blocked');
  throw new Error('Unexpected runner or network in startup-refusal test');
};
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
`);
      worker = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(guard).href, path.join(root, 'src/worker/index.ts')], {
        cwd: root,
        env: {
          NODE_ENV: 'test', PATH: process.env.PATH, FROK_DATA_DIR: directory,
          VPIPE_WORKDIR: path.join(directory, 'unused-models'),
          VPIPE_BIN: path.join(directory, 'unused-vpipe'),
          FFMPEG_BIN: path.join(directory, 'unused-ffmpeg'), FFPROBE_BIN: path.join(directory, 'unused-ffprobe'),
          COMFYUI_DIR: path.join(directory, 'unused-comfy'), COMFYUI_URL: 'http://127.0.0.1:19999', FROK_COMFYUI_PRIVATE: '0',
          OLLAMA_URL: 'http://127.0.0.1:19998', OLLAMA_MODEL: 'synthetic:startup-test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      worker.on('error', error => { spawnError = error; });
      for (const stream of [worker.stdout!, worker.stderr!]) stream.on('data', chunk => { output = (output + chunk.toString()).slice(-16_000); });
      closed = new Promise(resolve => worker!.once('close', (code, signal) => resolve({ code, signal })));
      timer = setTimeout(() => worker!.kill('SIGKILL'), 5000);
      const result = await closed;
      clearTimeout(timer);
      assert.equal(spawnError, undefined, output);
      assert.deepEqual(result, { code: 1, signal: null }, output);
      assert.match(output, scenario.message);
      assert.doesNotMatch(output, /Frok generation worker ready/);
      assert.equal(fs.existsSync(attempted), false, output);
      if (legacyBytes) assert.deepEqual(fs.readFileSync(legacyPath), legacyBytes);

      const after = new DatabaseSync(registryPath, { readOnly: true });
      try {
        for (const [key, value] of Object.entries(initialService)) assert.equal(after.prepare('SELECT value FROM service WHERE key=?').get(key)?.value, JSON.stringify(value), key);
        assert.deepEqual(after.prepare('SELECT * FROM operations').all(), []);
      } finally { after.close(); }
      for (const name of ['users', 'jobs', 'media', 'unused-models']) assert.equal(fs.existsSync(path.join(directory, name)), false, name);
    } finally {
      if (timer) clearTimeout(timer);
      if (worker?.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
      if (closed) await closed;
      fs.rmSync(directory, { recursive: true, force: true });
    }
    assert.equal(fs.existsSync(directory), false);
  });
}
