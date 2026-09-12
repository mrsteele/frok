// Shared by the backend and its launchers. Only non-secret legacy defaults are
// imported, once per library. Saved settings always take precedence.
const legacyKeys = ['AI_RUNNER', 'VIDEO_UPSCALER', 'VPIPE_WORKDIR', 'COMFYUI_DIR', 'COMFYUI_URL', 'COMFYUI_INPUT_DIR', 'COMFYUI_OUTPUT_DIR', 'COMFYUI_TEMP_DIR', 'FROK_PIPELINES_DIR', 'OLLAMA_URL', 'OLLAMA_MODEL', 'VPIPE_IMAGE_MODEL', 'VPIPE_VIDEO_MODEL', 'VPIPE_REFERENCE_MODEL', 'COMFY_IMAGE_MODEL', 'COMFY_VIDEO_MODEL', 'COMFY_REFERENCE_MODEL', 'COMFY_TEXT_ENCODER'];
export const runtimeDefaults = Object.freeze({ liveImagePreviews: true, jobTimeoutMinutes: 180, manageOllama: false, jobRetentionHours: 3, mediaToolsDirectory: '' });
export const defaultPromptModel = 'huihui_ai/qwen3-abliterated:4b-instruct-2507-q4_K_M';
export const ollamaAddress = managed => managed ? 'http://127.0.0.1:11435' : 'http://127.0.0.1:11434';

export function readSetting(database, key, fallback) {
  const row = database.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function importEnvironment(database, environment = process.env) {
  let saved = readSetting(database, 'environmentDefaults', null);
  if (saved !== null) return saved;
  const legacy = {};
  for (const key of legacyKeys) {
    const value = environment[key]?.trim();
    if (!value) continue;
    if (key.endsWith('_URL')) {
      // Never copy credentials embedded in old service URLs into the library.
      try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (key === 'COMFYUI_URL' && url.pathname !== '/')) continue; }
      catch { continue; }
    }
    legacy[key] = value;
  }
  const minutes = Number(environment.JOB_TIMEOUT_MINUTES);
  saved = { legacy, runtime: { liveImagePreviews: environment.VPIPE_LIVE_PREVIEWS !== '0', jobTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(10080, Math.max(1, Math.ceil(minutes))) : 180, manageOllama: environment.FROK_MANAGE_OLLAMA === '1' } };
  database.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run('environmentDefaults', JSON.stringify(saved));
  // Another process may have completed the same migration first.
  return readSetting(database, 'environmentDefaults', saved);
}
export function readRuntimeOptions(database, environment = process.env) {
  const migrated = importEnvironment(database, environment);
  return { ...runtimeDefaults, ...migrated.runtime, ...readSetting(database, 'runtimeOptions', {}) };
}
export function readOllamaAddress(database, environment = process.env) {
  const migrated = importEnvironment(database, environment);
  const fallback = ollamaAddress(readRuntimeOptions(database, environment).manageOllama);
  return (readSetting(database, 'ollamaUrl', migrated.legacy?.OLLAMA_URL || fallback) || fallback).replace(/\/+$/, '');
}
