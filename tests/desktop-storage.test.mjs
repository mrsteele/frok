import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { storagePaths, applicationPaths } from '../desktop/storage-paths.mjs';
import { workspacePaths } from '../desktop/workspace.mjs';
import { processLog } from '../desktop/process-log.mjs';

test('all launch modes use the same user workspace regardless of the checkout', () => {
  const userHome = path.resolve('synthetic-user');
  const expected = { home: path.join(userHome, 'frok'), data: path.join(userHome, 'frok/data'), pipelineHome: path.join(userHome, 'frok') };
  for (const root of [path.resolve('checkout-one'), path.resolve('checkout-two')]) {
    assert.deepEqual(storagePaths({}, { root, userHome, platform: 'darwin' }), expected);
    assert.equal(workspacePaths(expected.home).data, expected.data);
  }
});

test('explicit workspace and fixture overrides stay isolated', () => {
  const root = path.resolve('synthetic-checkout'), userHome = path.resolve('synthetic-user');
  const home = path.join(userHome, 'separate-frok');
  assert.deepEqual(storagePaths({ FROK_HOME: home }, { root, userHome, platform: 'darwin' }), { home, data: path.join(home, 'data'), pipelineHome: home });
  assert.deepEqual(storagePaths({ FROK_HOME: home, FROK_DATA_DIR: 'fixture/data', FROK_LOG_DIR: 'fixture/logs', FROK_PIPELINE_HOME: 'fixture/pipelines' }, { root, userHome }), { home, data: path.join(root, 'fixture/data'), pipelineHome: path.join(root, 'fixture/pipelines') });
  for (const invalid of [userHome, path.parse(userHome).root]) assert.throws(() => storagePaths({ FROK_HOME: invalid }, { root, userHome }), /dedicated/);
});

test('machine files use OS application data on every platform', () => {
  const userHome = path.resolve('synthetic-user');
  for (const [platform, folder] of [['darwin', 'Library/Application Support'], ['win32', 'AppData/Roaming'], ['linux', '.config']]) {
    const profile = path.join(userHome, folder, 'Frok');
    assert.deepEqual(applicationPaths({}, { userHome, platform }), { profile, state: profile, logs: path.join(profile, 'logs') });
    assert.equal(applicationPaths({}, { userHome, platform, appData: path.join(userHome, 'electron-data') }).profile, path.join(userHome, 'electron-data/Frok'));
  }
  assert.equal(applicationPaths({ APPDATA: path.join(userHome, 'roaming') }, { userHome, platform: 'win32' }).profile, path.join(userHome, 'roaming/Frok'));
  assert.equal(applicationPaths({ XDG_CONFIG_HOME: path.join(userHome, 'config') }, { userHome, platform: 'linux' }).profile, path.join(userHome, 'config/Frok'));
});

test('separate workspaces keep credentials and diagnostics separate without putting them in user data', () => {
  const userHome = path.resolve('synthetic-user'), root = path.resolve('checkout');
  const options = { userHome, root, platform: 'darwin' };
  const first = applicationPaths({ FROK_HOME: path.join(userHome, 'frok/first') }, options);
  const second = applicationPaths({ FROK_HOME: path.join(userHome, 'frok/second') }, options);
  assert.equal(first.profile, second.profile);
  assert.notEqual(first.state, second.state);
  assert.ok(first.state.startsWith(path.join(first.profile, 'workspaces') + path.sep));
  assert.equal(applicationPaths({ FROK_HOME: path.join(userHome, 'frok/first') }, { ...options, root: path.resolve('another-checkout') }).state, first.state);
  assert.equal(applicationPaths({ FROK_LOG_DIR: 'fixture/logs' }, options).logs, path.join(root, 'fixture/logs'));
});

test('backend library, job files and settings resolve to the selected home', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-storage-test-'));
  try {
    const env = { ...process.env, FROK_HOME: home, FROK_ENV_FILE: path.join(home, 'absent.env'), NODE_ENV: 'test' };
    for (const key of ['FROK_DATA_DIR', 'FROK_PIPELINE_HOME', 'FROK_APP_ROOT']) delete env[key];
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import { dataDir, defaultPipelinesDir } from './src/lib/paths.ts';
      import { libraryDatabase, libraryMediaDir, libraryJobsDir, closeLibraryDatabase } from './src/lib/library.ts';
      assert.equal(dataDir, path.join(process.env.FROK_HOME, 'data'));
      assert.equal(defaultPipelinesDir, path.join(process.env.FROK_HOME, 'pipelines'));
      libraryDatabase().prepare('INSERT INTO settings VALUES (?,?)').run('storage-test', 'true');
      fs.writeFileSync(path.join(libraryMediaDir(), 'synthetic.jpg'), 'image fixture');
      fs.writeFileSync(path.join(libraryJobsDir(), 'synthetic.log'), 'job fixture');
      closeLibraryDatabase();
    `], { cwd: process.cwd(), env, stdio: 'pipe' });
    assert.equal(await fs.readFile(path.join(home, 'data/library/media/synthetic.jpg'), 'utf8'), 'image fixture');
    assert.equal(await fs.readFile(path.join(home, 'data/library/jobs/synthetic.log'), 'utf8'), 'job fixture');
    await fs.access(path.join(home, 'data/library/frok.sqlite'));
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('backend logs use the chosen log folder, redact tokens and rotate large files', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-log-test-'));
  try {
    const directory = applicationPaths({ FROK_HOME: home }, { appData: path.join(home, 'os-app-data') }).logs;
    const log = processLog(directory, { API_KEY: 'synthetic-private-key' });
    log.write('working synthetic-private-key hf_syntheticToken\n');
    await log.close();
    const file = path.join(directory, 'backend.log');
    assert.equal(await fs.readFile(file, 'utf8'), 'working [redacted] [redacted]\n');
    await fs.truncate(file, 10 * 1024 * 1024 + 1);
    const next = processLog(directory, {}); next.write('new session\n'); await next.close();
    assert.equal(await fs.readFile(file, 'utf8'), 'new session\n');
    assert.equal((await fs.stat(file + '.previous')).size, 10 * 1024 * 1024 + 1);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
