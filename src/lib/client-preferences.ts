import { api } from './client-api';
import { captureExportPreferences, exportPreferenceKeys, type ExportPreferences } from './export-preferences';

let values: ExportPreferences = {};
let loading: Promise<void> | undefined;
let writes = Promise.resolve();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export const readInterfacePreference = (key: keyof ExportPreferences) => values[key] ?? null;
export function subscribeInterfacePreferences(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function loadInterfacePreferences() {
  return loading ??= (async () => {
    // The first response checks the library-reset epoch before reading old storage.
    values = await api<ExportPreferences>('settings/interface');
    let legacy: ExportPreferences = {};
    try { legacy = captureExportPreferences(window.localStorage); } catch { /* Browser storage is optional. */ }
    if (Object.keys(legacy).length) {
      const missing = Object.fromEntries(Object.entries(legacy).filter(([key]) => !Object.hasOwn(values, key)));
      if (Object.keys(missing).length) values = await api<ExportPreferences>('settings/interface', 'POST', missing);
      // The library now owns these settings. Keep no competing browser copy.
      for (const key of exportPreferenceKeys) try { window.localStorage.removeItem(key); } catch { /* Optional storage. */ }
    }
    notify();
  })().catch(error => { loading = undefined; throw error; });
}
export function writeInterfacePreference(key: keyof ExportPreferences, value: string) {
  // Serialize edits so a slower request cannot restore an earlier preference.
  const saved = writes.then(async () => {
    values = await api<ExportPreferences>('settings/interface', 'PATCH', { [key]: value });
    notify();
  });
  writes = saved.catch(() => {});
  return saved;
}
export function refreshInterfacePreferences() {
  const refreshed = writes.then(async () => {
    values = await api<ExportPreferences>('settings/interface');
    notify();
  });
  writes = refreshed.catch(() => {});
  return refreshed;
}
export const flushInterfacePreferences = () => writes;
