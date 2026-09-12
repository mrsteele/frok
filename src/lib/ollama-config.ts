import { settings } from './db';
import type { OllamaConfig } from './types';
export { defaultOllamaModel } from './ollama-defaults';
export function ollamaConfig(): OllamaConfig { const current=settings(); return {url:current.ollamaUrl,model:current.ollamaModel}; }
export const ollamaConfigKey = (config: OllamaConfig) => JSON.stringify([config.url, config.model]);
