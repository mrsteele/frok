import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';
const previous = process.env.FROK_DESKTOP_TOKEN;
after(() => { if (previous === undefined) delete process.env.FROK_DESKTOP_TOKEN; else process.env.FROK_DESKTOP_TOKEN = previous; });
test('browser development does not require the Electron launch token', () => {
  delete process.env.FROK_DESKTOP_TOKEN;
  assert.equal(proxy(new NextRequest('http://127.0.0.1:3000/')).status, 200);
});
test('desktop pages, assets and API require the launch secret', () => {
  process.env.FROK_DESKTOP_TOKEN = 'test-launch-secret';
  for (const path of ['/', '/api/library', '/api/media/private', '/_next/static/main.js']) {
    assert.equal(proxy(new NextRequest('http://127.0.0.1:3440' + path)).status, 403);
    assert.equal(proxy(new NextRequest('http://127.0.0.1:3440' + path, { headers: { 'x-frok-desktop-token': 'wrong' } })).status, 403);
    assert.equal(proxy(new NextRequest('http://127.0.0.1:3440' + path, { headers: { 'x-frok-desktop-token': 'test-launch-secret' } })).status, 200);
  }
});
