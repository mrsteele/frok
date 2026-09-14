'use client';
import { readInterfacePreference, writeInterfacePreference, subscribeInterfacePreferences } from '@/lib/client-preferences';
import { useEffect, useState } from 'react';
import { applyDefaultVideoPreset, assignDefaultVideoPreset, decodeVideoPresets, defaultVideoPreset, needsDefaultVideoPreset, normalizeVideoPresetDefaults, videoPresetsKey } from '@/lib/video-presets';
import type { Generation, VideoPreset } from '@/lib/types';

type PresetState = { presets: VideoPreset[]; ready: boolean; error: string };
function read(): VideoPreset[] {
  return decodeVideoPresets(readInterfacePreference(videoPresetsKey));
}
async function write(presets: VideoPreset[]) {
  const next = normalizeVideoPresetDefaults(presets);
  await writeInterfacePreference(videoPresetsKey, JSON.stringify(next));
  return next;
}
export function useVideoPresets() {
  const [state, setState] = useState<PresetState>({ presets: [], ready: false, error: '' });
  useEffect(() => {
    const refresh = () => {
      try { setState({ presets: read(), ready: true, error: '' }); }
      catch (e) { setState({ presets: [], ready: true, error: `Could not load motion presets: ${(e as Error).message} Your saved data has been kept.` }); }
    };
    const unsubscribe=subscribeInterfacePreferences(refresh);refresh();
    return unsubscribe;
  }, []);
  return {
    ...state,
    defaultPreset: defaultVideoPreset(state.presets),
    resolveGeneration(input: Generation) {
      // Read at click time, including changes made in another window. A storage
      // error must not silently switch an empty prompt back to built-in motion.
      return needsDefaultVideoPreset(input) ? applyDefaultVideoPreset(input, read()) : input;
    },
    setDefaultPreset(id: string) { return write(assignDefaultVideoPreset(read(), id)); },
    savePreset(preset: VideoPreset) {
      const current = read();
      return write(current.some(item => item.id === preset.id) ? current.map(item => item.id === preset.id ? preset : item) : [...current, preset]);
    },
    deletePreset(id: string) { return write(read().filter(item => item.id !== id)); },
    resetPresets() { return write(decodeVideoPresets(null)); },
  };
}
