import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const credentialKeys = Object.freeze(['HF_TOKEN', 'COMFYUI_API_KEY']);

export function createCredentialStore({ directory, safeStorage, environment = process.env, platform = process.platform }) {
  const file = path.join(directory, 'credentials.json');
  const available = () => safeStorage.isEncryptionAvailable() && (platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  let tokens = {};
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.version !== 1 || !saved.tokens || typeof saved.tokens !== 'object' || Array.isArray(saved.tokens)) throw Error();
    for (const key of credentialKeys) if (Object.hasOwn(saved.tokens, key)) {
      if (saved.tokens[key] !== null && typeof saved.tokens[key] !== 'string') throw Error();
      tokens[key] = saved.tokens[key];
    }
  } catch (error) { if (error.code !== 'ENOENT') throw Error('Saved API tokens could not be read. Check credentials.json in Frok’s application-data folder.'); }
  function write(next) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, tokens: next }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file); tokens = next;
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  const legacy = { HF_TOKEN: environment.HF_TOKEN || environment.HUGGING_FACE_HUB_TOKEN || '', COMFYUI_API_KEY: environment.COMFYUI_API_KEY || '' };
  if (available()) {
    const next = { ...tokens }; let changed = false;
    for (const key of credentialKeys) if (!Object.hasOwn(next, key) && legacy[key]) { next[key] = safeStorage.encryptString(legacy[key]).toString('base64'); changed = true; }
    if (changed) write(next);
  }
  function values() {
    return Object.fromEntries(credentialKeys.map(key => {
      if (!Object.hasOwn(tokens, key)) return [key, legacy[key]];
      if (!tokens[key] || !available()) return [key, ''];
      try { return [key, safeStorage.decryptString(Buffer.from(tokens[key], 'base64'))]; }
      catch { throw Error('A saved API token could not be unlocked. Save it again in Settings.'); }
    }));
  }
  const launched = values();
  function status() {
    const current = values();
    return { available: available(), configured: Object.fromEntries(credentialKeys.map(key => [key, !!current[key]])), restartRequired: credentialKeys.some(key => current[key] !== launched[key]) };
  }
  return {
    status,
    environment: () => ({ ...launched, HUGGING_FACE_HUB_TOKEN: '' }),
    save(key, value) {
      if (!credentialKeys.includes(key) || typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) throw Error('Choose a supported API token and enter a single value.');
      if (!available()) throw Error('Secure storage is unavailable. Unlock your system keychain and reopen Frok.');
      const token = value.trim();
      write({ ...tokens, [key]: token ? safeStorage.encryptString(token).toString('base64') : null });
      return status();
    },
  };
}
