import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { comfyFile, verifyFile } from '../pipelines/dependencies';
import type { Dependency } from '../pipelines/schema';
import type { PreparationInput } from './types';

function downloadHost(url: URL) {
  const host = url.hostname;
  return url.protocol === 'https:' && !url.username && !url.password &&
    (host === 'huggingface.co' || host.endsWith('.huggingface.co') || host.endsWith('.hf.co') ||
      host === 'github.com' || host.endsWith('.githubusercontent.com'));
}

async function modelResponse(url: string, signal: AbortSignal) {
  let target = new URL(url);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!downloadHost(target)) throw Error('The model download redirected to an unsupported host. Use manual setup.');
    const headers = new Headers();
    // A token is sent only to Hugging Face, never to its download/CDN redirects.
    if (target.hostname === 'huggingface.co' && process.env.HF_TOKEN)
      headers.set('Authorization', `Bearer ${process.env.HF_TOKEN}`);
    const response = await fetch(target, { headers, signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw Error('The model download returned an invalid redirect.');
      target = new URL(location, target);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status))
        throw Error(`Hugging Face denied the model download (HTTP ${response.status}). Accept the model’s access terms, then save a read token in Settings → Advanced → API tokens and restart Frok.`);
      throw Error(`Model download failed (HTTP ${response.status}). Retry or use manual setup.`);
    }
    if (!response.body) throw Error('The model download returned no file.');
    return response;
  }
  throw Error('Too many redirects while downloading the model.');
}

async function checksum(file: string, signal: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

// Called only with a bundled, revision-matched file manifest. No custom metadata
// URL, executable script or model-loader code is ever installed through this path.
export async function prepareComfyFiles({ files, signal, log }: PreparationInput) {
  if (!files?.length) throw Error('This workflow has no verified download manifest. Use manual setup.');
  signal = AbortSignal.any([signal, AbortSignal.timeout(24 * 60 * 60 * 1000)]);
  for (const dependency of files) {
    if (!dependency.url || !dependency.sha256 || !dependency.size)
      throw Error('A bundled model download is missing its checksum or size. Use manual setup.');
    signal.throwIfAborted();
    await installModelFile(dependency, signal, log);
  }
}

async function installModelFile(dependency: Dependency, signal: AbortSignal, log: (line: string) => void) {
  // comfyFile verifies every path component and refuses model-folder symlinks.
  const destination = await comfyFile(dependency.reference);
  const existing = await fs.lstat(destination).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (existing) {
    try {
      await verifyFile(destination, dependency);
      if (await checksum(destination, signal) !== dependency.sha256) throw Error('Checksum mismatch.');
    } catch (error) {
      signal.throwIfAborted();
      throw Error(`${dependency.reference} already exists but does not match this setup. Review it in ComfyUI before retrying; Frok has kept the existing file.`);
    }
    log(`Reusing ${dependency.reference}.\n`);
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await comfyFile(dependency.reference);
  const space = await fs.statfs(path.dirname(destination));
  if (space.bavail * space.bsize < dependency.size!)
    throw Error(`Not enough free space in the ComfyUI model folder for ${dependency.reference}.`);
  const temporary = path.join(path.dirname(destination), `.frok-download-${randomUUID()}.partial`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    log(`Downloading ${dependency.reference} (${(dependency.size! / 1e9).toFixed(2)} GB).\n`);
    const response = await modelResponse(dependency.url!, signal);
    reader = response.body!.getReader();
    let received = 0, reported = 0;
    const hash = createHash('sha256');
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > dependency.size!) throw Error('The download exceeds its expected size.');
      hash.update(value);
      // FileHandle.write may write fewer bytes than supplied.
      for (let offset = 0; offset < value.length;) {
        const { bytesWritten } = await handle.write(value, offset, value.length - offset);
        if (!bytesWritten) throw Error('Could not write the model download.');
        offset += bytesWritten;
      }
      const percent = Math.floor(received / dependency.size! * 10) * 10;
      if (percent > reported) { reported = percent; log(`${dependency.reference}: ${percent}%\n`); }
    }
    if (received !== dependency.size || hash.digest('hex') !== dependency.sha256)
      throw Error('The downloaded file failed its size or checksum check. Retry or use manual setup.');
    await handle.sync();
    await handle.close();
    // Check the safetensors header as well, using the final extension.
    if (destination.endsWith('.safetensors')) {
      const { tensorFile } = await import('../model-tensors');
      await tensorFile(temporary);
    }
    await comfyFile(dependency.reference);
    signal.throwIfAborted();
    // Atomic, exclusive publication: never overwrite a file another process installed.
    await fs.link(temporary, destination);
    log(`Installed ${dependency.reference}.\n`);
  } finally {
    await reader?.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await fs.rm(temporary, { force: true });
  }
}
