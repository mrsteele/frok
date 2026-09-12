import { defaultPromptModel, ollamaAddress } from '../../desktop/preferences.mjs';
import { legacyDefaults, runtimeOptions, savedOllamaAddress } from './preferences';
import type { OllamaConfig } from './types';

export const defaultOllamaModel = defaultPromptModel;
export const defaultOllamaUrl = () => ollamaAddress(runtimeOptions().manageOllama);
export const machineOllamaConfig = (): OllamaConfig => ({ url: savedOllamaAddress(), model: legacyDefaults().OLLAMA_MODEL || defaultOllamaModel });
