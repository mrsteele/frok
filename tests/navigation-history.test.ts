import test from 'node:test';
import assert from 'node:assert/strict';
import { assetBackTarget, navigationDepth, trackBrowserNavigation } from '../src/lib/navigation';

// In-memory session history: no library, media, worker or model access.
function browserAt(path: string) {
  const location = new URL(path, 'http://localhost:3000');
  const entries = [{ url: location.href, state: { __NA: true } as Record<string, unknown> }];
  let index = 0;
  const history = {
    get state() { return entries[index].state; },
    pushState(data: Record<string, unknown>, _unused: string, url?: string | URL | null) {
      location.href = new URL(url == null ? location.href : String(url), location).href;
      entries.splice(++index, entries.length, { url: location.href, state: structuredClone(data) });
    },
    replaceState(data: Record<string, unknown>, _unused: string, url?: string | URL | null) {
      location.href = new URL(url == null ? location.href : String(url), location).href;
      entries[index] = { url: location.href, state: structuredClone(data) };
    },
    go(steps: number) {
      assert.ok(index + steps >= 0 && index + steps < entries.length, 'target must exist in this session');
      index += steps;
      location.href = entries[index].url;
    },
  };
  const browser = { history, location } as unknown as Pick<Window, 'history' | 'location'>;
  return {
    browser, history, location,
    push: (url: string) => history.pushState({ __NA: true }, '', url),
    replace: (url?: string) => history.replaceState({ __NA: true }, '', url),
    assetBack() {
      const target = assetBackTarget(history.state);
      if ('steps' in target) history.go(target.steps);
      else history.replaceState({ __NA: true }, '', target.href);
    },
  };
}

test('asset Back skips every render and returns to the exact source page', () => {
  for (const source of ['/', '/history', '/history/videos', '/favorites/images?sort=newest#creations']) {
    const b = browserAt(source);
    trackBrowserNavigation(b.browser);
    b.push('/asset/cat'); b.push('/asset/cat/2'); b.push('/asset/cat/5'); b.push('/asset/cat');
    assert.deepEqual(assetBackTarget(b.history.state), { steps: -4 });
    b.assetBack();
    assert.equal(b.location.pathname + b.location.search + b.location.hash, source);
  }
});

test('browsing another root and browser Back/Forward retain the original source', () => {
  const b = browserAt('/history'); trackBrowserNavigation(b.browser);
  b.push('/asset/cat/2'); b.push('/asset/dog'); b.push('/asset/dog/3');
  b.history.go(-1);
  assert.deepEqual(assetBackTarget(b.history.state), { steps: -2 });
  b.history.go(1);
  b.assetBack();
  assert.equal(b.location.pathname, '/history');
});

test('legacy redirects, canonical replacements and a remount preserve the source', () => {
  const b = browserAt('/favorites/videos'); let stop = trackBrowserNavigation(b.browser);
  b.push('/videos/old-id'); b.replace('/asset/cat/2'); b.replace();
  stop(); stop = trackBrowserNavigation(b.browser);
  b.push('/asset/cat/4');
  b.assetBack();
  assert.equal(b.location.pathname, '/favorites/videos');
  stop();
});

test('direct asset visits fall back to Envision even after browsing renders', () => {
  const b = browserAt('/asset/cat/2'); trackBrowserNavigation(b.browser);
  b.push('/asset/cat/3'); b.push('/asset/dog/2');
  assert.deepEqual(assetBackTarget(b.history.state), { href: '/' });
  b.assetBack();
  assert.equal(b.location.pathname, '/');
});

test('leaving the viewer and opening it again records a fresh source', () => {
  const b = browserAt('/'); trackBrowserNavigation(b.browser);
  b.push('/asset/cat'); b.push('/asset/cat/2'); b.push('/favorites'); b.push('/asset/dog/3');
  b.assetBack();
  assert.equal(b.location.pathname, '/favorites');
  b.history.go(-1);
  b.assetBack();
  assert.equal(b.location.pathname, '/');
});

test('entering with replace returns to the source URL without skipping an unrelated entry', () => {
  const b = browserAt('/'); trackBrowserNavigation(b.browser);
  b.push('/history/videos'); b.replace('/asset/cat'); b.push('/asset/cat/3');
  assert.deepEqual(assetBackTarget(b.history.state), { href: '/history/videos' });
  b.assetBack();
  assert.equal(b.location.pathname, '/history/videos');
});

test('framework history state and ordinary page navigation depth remain intact', () => {
  const b = browserAt('/'); trackBrowserNavigation(b.browser);
  const frameworkState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ['synthetic'] } };
  b.history.pushState(frameworkState, '', '/history');
  assert.equal(navigationDepth(b.history.state), 1);
  assert.deepEqual(b.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE, frameworkState.__PRIVATE_NEXTJS_INTERNALS_TREE);
  b.replace('/queue'); assert.equal(navigationDepth(b.history.state), 1);
  b.history.go(-1); assert.equal(navigationDepth(b.history.state), 0);
  b.push('/settings'); assert.equal(navigationDepth(b.history.state), 1);
});

test('invalid origins cannot send asset Back outside the app or back into the viewer', () => {
  for (const path of ['https://example.com', '//example.com', '/\\example.com', '/\t/example.com', '/\t/[', 'javascript:alert(1)', '/asset/cat', '/api/settings']) {
    assert.deepEqual(assetBackTarget({ frokNavigationDepth: 3, frokAssetOrigin: { path, depth: 0 } }), { href: '/' }, path);
  }
  assert.deepEqual(assetBackTarget(null), { href: '/' });
  assert.deepEqual(assetBackTarget({ frokAssetOrigin: { path: '/history', depth: -1 } }), { href: '/' });
});
