'use client';
import { useEffect, useState } from 'react';
import { applyDefaultVideoPreset, assignDefaultVideoPreset, decodeVideoPresets, defaultVideoPreset, needsDefaultVideoPreset, normalizeVideoPresetDefaults, videoPresetsKey } from '@/lib/video-presets';
import type { Generation, VideoPreset } from '@/lib/types';

const changed = 'frok-video-presets-changed';
type PresetState = { presets: VideoPreset[]; ready: boolean; error: string };
function read(): VideoPreset[] {
  const raw = localStorage.getItem(videoPresetsKey);
  const presets = decodeVideoPresets(raw);
  // Persist first-use defaults and one-time upgrades together in the same key.
  const encoded = JSON.stringify(presets);
  if (raw !== encoded) localStorage.setItem(videoPresetsKey, encoded);
  return presets;
}
function write(presets: VideoPreset[]) {
  const next = normalizeVideoPresetDefaults(presets);
  localStorage.setItem(videoPresetsKey, JSON.stringify(next));
  window.dispatchEvent(new Event(changed));
  return next;
}
export function useVideoPresets() {
  const [state, setState] = useState<PresetState>({ presets: [], ready: false, error: '' });
  useEffect(() => {
    const refresh = () => {
      try { setState({ presets: read(), ready: true, error: '' }); }
      catch (e) { setState({ presets: [], ready: true, error: `Could not load motion presets: ${(e as Error).message} Your saved data has been kept.` }); }
    };
    const storage = (event: StorageEvent) => { if (event.storageArea === localStorage && (event.key === videoPresetsKey || event.key === null)) refresh(); };
    window.addEventListener(changed, refresh); window.addEventListener('storage', storage); refresh();
    return () => { window.removeEventListener(changed, refresh); window.removeEventListener('storage', storage); };
  }, []);
  return {
    ...state,
    defaultPreset: defaultVideoPreset(state.presets),
    resolveGeneration(input: Generation) {
      // Read at click time, including changes made in another window. A storage
      // error must not silently switch an empty prompt back to built-in motion.
      return needsDefaultVideoPreset(input) ? applyDefaultVideoPreset(input, read()) : input;
    },
    setDefaultPreset(id: string) { write(assignDefaultVideoPreset(read(), id)); },
    savePreset(preset: VideoPreset) {
      const current = read();
      write(current.some(item => item.id === preset.id) ? current.map(item => item.id === preset.id ? preset : item) : [...current, preset]);
    },
    deletePreset(id: string) { return write(read().filter(item => item.id !== id)); },
    resetPresets() { write(decodeVideoPresets(null)); },
  };
}
