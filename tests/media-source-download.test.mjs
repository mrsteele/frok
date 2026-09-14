import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { downloadMediaSource } from '../scripts/download-media-source.mjs';

test('archive downloads preserve gzip bytes, follow redirects, and reject unexpected content', async t => {
  const archive = gzipSync('synthetic source archive');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const server = http.createServer((request, response) => {
    assert.equal(request.headers['accept-encoding'], 'identity');
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/archive' }).end();
    } else if (request.url === '/archive') {
      response.writeHead(200, { 'Content-Type': 'application/x-gzip', 'Content-Encoding': 'gzip' });
      response.end(archive);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>Unavailable</html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const source = { name: 'test archive', sha256, url: `http://127.0.0.1:${server.address().port}/redirect` };
  assert.deepEqual(await downloadMediaSource(source), archive);
  await assert.rejects(downloadMediaSource({ ...source, url: source.url.replace('/redirect', '/bad') }),
    /checksum mismatch.*Expected .*received .*Content-Type: text\/html.*Refusing to build/);
});
