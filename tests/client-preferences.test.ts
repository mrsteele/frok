import test from 'node:test';
import assert from 'node:assert/strict';

test('a fresh window restores portable preferences, migrates once and serializes edits', async t => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const old = new Map([
    ['userPrompts', '[]'], ['frok-composer', '{"seed":5}'], ['frok-video-audio', '{"muted":true,"volume":1}'],
    ['Preferences', 'browser internals'], ['HF_TOKEN', 'synthetic-private'],
  ]);
  const storage = { getItem: (key: string) => old.get(key) ?? null, setItem: (key: string, value: string) => old.set(key, value), removeItem: (key: string) => old.delete(key) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, addEventListener() {} } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, descriptor] of [['window', originalWindow], ['localStorage', originalStorage]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  });
  let saved: Record<string, string> = { 'frok-video-audio': '{"muted":false,"volume":0.4}' };
  const requests: { method: string; input: Record<string, string> }[] = [];
  let active = 0, maximum = 0, rejectNext = false;
  globalThis.fetch = async (_url, options) => {
    active++; maximum = Math.max(maximum, active);
    const method = options?.method || 'GET', input = options?.body ? JSON.parse(String(options.body)) : {};
    requests.push({ method, input });
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    if (rejectNext) { rejectNext = false; return Response.json({ error: 'Synthetic save failure' }, { status: 500 }); }
    if (method === 'POST') saved = { ...input, ...saved };
    if (method === 'PATCH') saved = { ...saved, ...input };
    return Response.json(saved);
  };
  const preferences = await import('../src/lib/client-preferences');
  await Promise.all([preferences.loadInterfacePreferences(), preferences.loadInterfacePreferences()]);
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
  assert.deepEqual(requests.find(request => request.method === 'POST')!.input, { 'frok-composer': '{"seed":5}', userPrompts: '[]' });
  assert.equal(preferences.readInterfacePreference('frok-video-audio'), '{"muted":false,"volume":0.4}');
  assert.equal(old.has('userPrompts'), false);
  assert.equal(old.get('HF_TOKEN'), 'synthetic-private');
  await Promise.all([preferences.writeInterfacePreference('frok-composer', '{"seed":7}'), preferences.refreshInterfacePreferences(), preferences.writeInterfacePreference('frok-composer', '{"seed":8}')]);
  assert.equal(maximum, 1);
  assert.equal(preferences.readInterfacePreference('frok-composer'), '{"seed":8}');
  rejectNext = true;
  await assert.rejects(preferences.writeInterfacePreference('frok-composer', '{"seed":9}'), /Synthetic save failure/);
  assert.equal(preferences.readInterfacePreference('frok-composer'), '{"seed":8}');
  await preferences.writeInterfacePreference('frok-composer', '{"seed":10}');
  await preferences.flushInterfacePreferences();
  assert.equal(saved['frok-composer'], '{"seed":10}');
});
