import { libraryStore } from './library';
import { importEnvironment, readRuntimeOptions, readOllamaAddress } from '../../desktop/preferences.mjs';

export type RuntimeOptions = { liveImagePreviews: boolean; jobTimeoutMinutes: number; jobRetentionHours: number | null; mediaToolsDirectory: string };
export const legacyDefaults = (): Record<string, string | undefined> => importEnvironment(libraryStore).legacy || {};
export const runtimeOptions = (): RuntimeOptions => readRuntimeOptions(libraryStore) as RuntimeOptions;
export const savedOllamaAddress = (): string => readOllamaAddress(libraryStore);
export const runtimeStatus = () => ({ options: runtimeOptions() });
