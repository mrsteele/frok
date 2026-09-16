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

test('archive downloads fall back after HTML, HTTP errors, corrupted bytes, and connection failures', async t => {
  const archive = gzipSync('synthetic source archive');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const requests = [];
  t.mock.method(console, 'warn', () => {});
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    assert.equal(request.headers['accept-encoding'], 'identity');
    switch (request.url) {
      case '/html': response.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>Unavailable</html>'); break;
      case '/unavailable': response.writeHead(503).end(); break;
      case '/corrupt': response.end(gzipSync('modified source archive')); break;
      case '/disconnected': request.socket.destroy(); break;
      case '/redirect': response.writeHead(302, { Location: '/archive' }).end(); break;
      case '/archive': response.writeHead(200, { 'Content-Encoding': 'gzip' }).end(archive); break;
      default: response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = {
    name: 'test archive', sha256, url: `${base}/html`,
    mirrors: ['/unavailable', '/corrupt', '/disconnected', '/redirect', '/unused'].map(route => base + route),
  };
  assert.deepEqual(await downloadMediaSource(source), archive);
  assert.deepEqual(requests, ['/html', '/unavailable', '/corrupt', '/disconnected', '/redirect', '/archive']);
});

test('archive downloads reject all sources when no candidate matches the pinned checksum', async t => {
  const archive = gzipSync('synthetic source archive');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  t.mock.method(console, 'warn', () => {});
  const server = http.createServer((request, response) => response.end(gzipSync(`modified archive from ${request.url}`)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(downloadMediaSource({ name: 'test archive', sha256, url: `${base}/primary`, mirrors: [`${base}/mirror`] }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /checksum mismatch.*\/primary/);
    assert.match(error.message, /checksum mismatch.*\/mirror/);
    return true;
  });
});

test('archive downloads do not request mirrors when the primary matches the pinned checksum', async t => {
  const archive = gzipSync('synthetic source archive');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const requests = [];
  const server = http.createServer((request, response) => { requests.push(request.url); response.end(archive); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await downloadMediaSource({ name: 'test archive', sha256, url: `${base}/primary`, mirrors: [`${base}/mirror`] }), archive);
  assert.deepEqual(requests, ['/primary']);
});
