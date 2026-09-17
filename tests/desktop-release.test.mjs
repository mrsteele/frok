import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { load, dump } from 'js-yaml';
import { releaseConfiguration } from '../scripts/desktop-release-config.mjs';
import { collectReleaseArtifacts } from '../scripts/release-artifacts.mjs';

test('release update feed follows the repository and macOS uses Sparkle without Apple signing', () => {
  const env = { GITHUB_REPOSITORY: 'example/studio' };
  const local = releaseConfiguration({}, env, 'darwin');
  assert.equal(local.extraMetadata.frokUpdates, true);
  assert.match(local.extraMetadata.frokSparkle.appcastUrl, /^https:\/\/github.com\/example\/studio\/releases\/latest\/download\/appcast-(arm64|x64).xml$/);
  assert.equal(local.mac.extendInfo.SUVerifyUpdateBeforeExtraction, true);
  assert.equal(local.mac.extendInfo.SUAutomaticallyUpdate, false);
  assert.deepEqual(local.publish, [{ provider: 'github', owner: 'example', repo: 'studio', releaseType: 'release' }]);
  assert.throws(() => releaseConfiguration({}, { ...env, FROK_SIGN_RELEASE: '1' }, 'darwin'), /requires/);
  const signed = releaseConfiguration({}, { ...env, FROK_SIGN_RELEASE: '1', CSC_LINK: 'certificate', APPLE_ID: 'account', APPLE_APP_SPECIFIC_PASSWORD: 'password', APPLE_TEAM_ID: 'team' }, 'darwin');
  assert.equal(signed.extraMetadata.frokUpdates, true); assert.equal(signed.forceCodeSigning, true); assert.equal(signed.mac.notarize, true);
  assert.equal(releaseConfiguration({}, env, 'win32').extraMetadata.frokUpdates, true);
});

async function artifacts(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-update-artifacts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input'), output = path.join(root, 'output');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const publicEdKey=Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('base64');
  for (const arch of ['arm64', 'x64']) {
    const folder = path.join(input, arch), name = `Frok-1.2.3-mac-${arch}.zip`, bytes = Buffer.from(`synthetic ${arch} installer`);
    await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, name), bytes);
    await fs.writeFile(path.join(folder,`appcast-${arch}.xml`),`<rss><channel><item><enclosure url="https://github.com/example/studio/releases/download/v1.2.3/${name}" length="${bytes.length}" sparkle:edSignature="${sign(null,bytes,privateKey).toString('base64')}" /></item></channel></rss>`);
    const file = { url: name, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length };
    await fs.writeFile(path.join(folder, 'latest-mac.yml'), dump({ version: '1.2.3', files: [file], path: name, sha512: file.sha512 }));
  }
  return { input, output, publicEdKey };
}
test('release collection retains both macOS architectures and verifies their appcasts', async t => {
  const { input, output, publicEdKey } = await artifacts(t);
  await collectReleaseArtifacts(input, output, {publicEdKey});
  const info = load(await fs.readFile(path.join(output, 'latest-mac.yml'), 'utf8'));
  assert.equal(info.files.length, 2);
  for (const file of info.files) assert.equal(createHash('sha512').update(await fs.readFile(path.join(output, file.url))).digest('base64'), file.sha512);
});
test('release collection refuses corrupted downloads and mismatched release versions', async t => {
  const { input, output, publicEdKey } = await artifacts(t);
  const zip = path.join(input, 'arm64/Frok-1.2.3-mac-arm64.zip'), original = await fs.readFile(zip);
  await fs.writeFile(zip, 'corrupt'); await assert.rejects(collectReleaseArtifacts(input, output, {publicEdKey}), /invalid|verification|mismatched/);
  await fs.writeFile(zip, original);
  const manifest = path.join(input, 'arm64/latest-mac.yml'), info = load(await fs.readFile(manifest, 'utf8'));
  info.version = '9.9.9'; await fs.writeFile(manifest, dump(info));
  await assert.rejects(collectReleaseArtifacts(input, output, {publicEdKey}), /Conflicting release versions/);
});
test('the packaged updater loads without a node_modules tree or a running Electron app', async () => {
  const result = await build({ entryPoints: ['desktop/update-provider.cjs'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'] });
  const require = createRequire(import.meta.url), nativeUpdater = new EventEmitter();
  const app = { isPackaged: true, getVersion: () => '1.2.3', getName: () => 'Frok', getPath: () => os.tmpdir(), getAppPath: () => os.tmpdir(), whenReady: () => Promise.resolve(), on: () => {} };
  const module = { exports: {} };
  const context = { module, exports: module.exports, process: Object.defineProperty(Object.assign(Object.create(process), { resourcesPath: os.tmpdir() }), 'platform', { value: 'win32' }), console, URL, Buffer, setImmediate, setTimeout, clearTimeout, require: name => {
    if (name === 'electron') return { app, autoUpdater: nativeUpdater };
    assert.ok(name.startsWith('node:') || require('node:module').isBuiltin(name), `Unexpected external dependency: ${name}`);
    return require(name);
  } };
  context.global = context;
  vm.runInNewContext(result.outputFiles[0].text, context);
  const updater = module.exports();
  assert.equal(typeof updater.checkForUpdates, 'function'); assert.equal(typeof updater.quitAndInstall, 'function');
  // Constructing the provider performs no update check or download.
  assert.equal(updater.updateInfoAndProvider, null);
});

// This exercises the actual workflow's shell step rather than duplicating its version logic.
test('branch preflight validates the package version but only tag runs may publish', { skip: process.platform === 'win32' }, async () => {
  const workflow = load(await fs.readFile('.github/workflows/release.yml', 'utf8'));
  const step = workflow.jobs.version.steps.find(step => step.id === 'version');
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const check = (preflight, ref) => spawnSync('bash', ['-e', '-c', step.run], {
    encoding: 'utf8', env: { ...process.env, PREFLIGHT: String(preflight), GITHUB_REF_NAME: ref, GITHUB_OUTPUT: '' },
  });
  assert.equal(check(true, 'release-candidate').status, 0);
  assert.equal(check(false, `v${pkg.version}`).status, 0);
  assert.notEqual(check(false, 'release-candidate').status, 0);
  assert.notEqual(check(false, 'v999.0.0').status, 0);
  assert.deepEqual(workflow.jobs.build.needs, ['version', 'checks']);
  assert.deepEqual(workflow.jobs.release.needs, ['version', 'checks', 'build']);
  const publishing = workflow.jobs.release.steps.find(step => step.name === 'Attach installers to a draft release');
  assert.equal(publishing.if, "startsWith(github.ref, 'refs/tags/')");
  const collecting = workflow.jobs.release.steps.find(step => step.run?.includes('scripts/release-artifacts.mjs'));
  assert.equal(collecting.if, undefined);
});
