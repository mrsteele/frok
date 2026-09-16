import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';

// Unlike fetch(), these clients preserve archive bytes even when a server
// labels the archive itself as Content-Encoding: gzip.
export async function downloadMediaSource(source) {
  async function download(url, signal, redirects = 0) {
    const client = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!client) throw Error(`Unsupported media source protocol: ${url.protocol}`);
    return new Promise((resolve, reject) => {
      const request = client.get(url, { signal, headers: { 'Accept-Encoding': 'identity' } }, response => {
        const status = response.statusCode;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          const next = new URL(response.headers.location, url);
          if (redirects >= 5 || (url.protocol === 'https:' && next.protocol !== 'https:')) {
            reject(Error(`Unsafe or excessive redirects downloading ${source.name}`));
          } else resolve(download(next, signal, redirects + 1));
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(Error(`Could not download ${source.name}: HTTP ${status} from ${url}`));
          return;
        }
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const data = Buffer.concat(chunks);
          const actual = createHash('sha256').update(data).digest('hex');
          if (actual !== source.sha256) {
            reject(Error(`${source.name} source checksum mismatch from ${url}. Expected ${source.sha256}, received ${actual} (${data.length} bytes; Content-Type: ${response.headers['content-type'] || 'unknown'}; Content-Encoding: ${response.headers['content-encoding'] || 'none'}). Refusing to build.`));
          } else resolve(data);
        });
      });
      request.on('error', reject);
    });
  }
  const urls = [source.url, ...(source.mirrors || [])];
  const errors = [];
  for (const [index, url] of urls.entries()) {
    try {
      // Each source gets its own deadline; every candidate must match the same
      // pinned hash before any bytes can be cached or extracted.
      return await download(new URL(url), AbortSignal.timeout(120_000));
    } catch (error) {
      errors.push(error);
      if (index + 1 < urls.length) console.warn(`${error.message}\nTrying alternate source for ${source.name}: ${urls[index + 1]}`);
    }
  }
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, `Could not download verified ${source.name} source from any configured URL:\n${errors.map(error => error.message).join('\n')}`);
}
