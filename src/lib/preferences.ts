import { libraryStore } from './library';
import { importEnvironment, readRuntimeOptions, readOllamaAddress } from '../../desktop/preferences.mjs';

export type RuntimeOptions = { liveImagePreviews: boolean; jobTimeoutMinutes: number; manageOllama: boolean; jobRetentionHours: number | null; mediaToolsDirectory: string };
export const legacyDefaults = (): Record<string, string | undefined> => importEnvironment(libraryStore).legacy || {};
export const runtimeOptions = (): RuntimeOptions => readRuntimeOptions(libraryStore);
export const savedOllamaAddress = (): string => readOllamaAddress(libraryStore);
export const runtimeStatus = () => {
  const options = runtimeOptions();
  return { options, restartRequired: options.manageOllama !== ((process.env.FROK_OLLAMA_MANAGED ?? process.env.FROK_MANAGE_OLLAMA) === '1') || (options.manageOllama && !!process.env.FROK_OLLAMA_ADDRESS && savedOllamaAddress() !== process.env.FROK_OLLAMA_ADDRESS) };
};
