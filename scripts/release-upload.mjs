import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { releaseVersion } from './release-version.mjs';

const exec = promisify(execFile);
async function gh(args) {
  try { return (await exec('gh', args, { maxBuffer: 10 * 1024 * 1024, timeout: args[1] === 'upload' ? 300_000 : 60_000 })).stdout; }
  catch (error) { throw Error(error.killed ? 'GitHub request timed out.' : error.stderr || error.message); }
}
const transient = error => error.pendingUpload || /HTTP (?:408|429|5\d\d)|timed? out|TLS handshake|connection reset|unexpected EOF|error connecting|ECONNRESET|ETIMEDOUT/i.test(error.message);
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function uploadRelease({ directory, repo, tag, version, run = gh, sleep = delay, log = console.log }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Provide a GitHub owner/repository.');
  const { prerelease } = releaseVersion(tag, version, version);
  const entries = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.name !== 'SHA256SUMS.txt');
  if (!entries.length || entries.some(entry => !entry.isFile() || !/^[\w.-]+$/.test(entry.name))) throw Error('Release artifacts must be regular files with safe names.');
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.resolve(directory, entry.name);
    files.push({ name: entry.name, file, size: (await fs.stat(file)).size, hash: await digest(file) });
  }
  const sums = path.resolve(directory, 'SHA256SUMS.txt');
  await fs.writeFile(sums, files.map(file => `${file.hash}  ${file.name}\n`).join(''));
  files.push({ name: 'SHA256SUMS.txt', file: sums, size: (await fs.stat(sums)).size, hash: await digest(sums) });

  async function retry(action) {
    for (let attempt = 0; ; attempt++) {
      try { return await action(); }
      catch (error) {
        if (attempt === 4 || !transient(error)) throw error;
        log(`Transient GitHub failure; retrying in ${2 ** (attempt + 1)} seconds (${attempt + 2}/5).`);
        await sleep(1000 * 2 ** (attempt + 1));
      }
    }
  }
  async function findDraft() {
    let info;
    try { info = JSON.parse(await run(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,apiUrl'])); }
    catch (error) { if (/^release not found\s*$/i.test(error.message.trim())) return; throw error; }
    if (!info.isDraft) throw Error('Published releases are immutable; use a new version.');
    if (!info.apiUrl?.startsWith(`https://api.github.com/repos/${repo}/releases/`)) throw Error('Unexpected release API URL.');
    return info;
  }
  await retry(async () => {
    if (await findDraft()) return;
    // Create metadata separately: a failed binary upload must not interrupt draft creation.
    await run(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--generate-notes', '--title', `Frok ${version}`, ...(prerelease ? ['--prerelease'] : [])]);
  });
  async function assets(info) {
    return JSON.parse(await run(['api', `${info.apiUrl}/assets?per_page=100`, '--paginate', '--slurp'])).flat();
  }
  const matches = (asset, file) => asset?.state === 'uploaded' && asset.size === file.size && asset.digest === `sha256:${file.hash}`;
  for (const file of files) {
    await retry(async () => {
      const info = await findDraft();
      if (!info) throw Error('Release draft disappeared.');
      if (matches((await assets(info)).find(asset => asset.name === file.name), file)) {
        log(`Verified existing ${file.name}`); return;
      }
      log(`Uploading ${file.name}`);
      await run(['release', 'upload', tag, file.file, '--repo', repo, '--clobber']);
      if (!matches((await assets(info)).find(asset => asset.name === file.name), file)) {
        const error = Error(`GitHub has not confirmed the checksum for ${file.name}.`);
        error.pendingUpload = true; throw error;
      }
    });
  }
  const final = await retry(async () => {
    const info = await findDraft();
    if (!info) throw Error('Release draft disappeared.');
    return assets(info);
  });
  for (const file of files) if (!matches(final.find(asset => asset.name === file.name), file)) throw Error(`Release asset verification failed: ${file.name}`);
  log(`Verified ${files.length} release assets. Release remains a draft.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await uploadRelease({ directory: process.argv[2] || 'artifacts', repo: process.env.GH_REPO, tag: process.env.RELEASE_TAG, version: process.env.RELEASE_VERSION });
}
