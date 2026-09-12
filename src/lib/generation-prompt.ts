import { motionDirection, motionPrompt } from './motion';
import { enhanceImagePrompts, enhanceMotion, enhancePrompt } from './ollama';
import type { Generation, Media, PromptTrace, VideoStyle } from './types';

type PromptEvents = { enhancing?: (style?: VideoStyle) => void; fallback?: (error: unknown) => void };
export async function prepareGenerationPrompt(request: Generation, source: Media | undefined, signal: AbortSignal, events: PromptEvents = {}) {
  signal.throwIfAborted();
  if (request.mode === 'upscale') return { prompt: source?.enhancedPrompt || request.prompt, videoStyle: source?.videoStyle, promptTrace: source?.promptTrace };
  // New image-to-video submissions snapshot the chosen recipe on the client.
  // The Normal fallback is only for jobs queued before configurable defaults.
  const requestedStyle = request.videoStyle || (request.prompt.trim() ? 'custom' : 'normal');
  const videoStyle = request.mode === 'video' && source?.kind === 'image'
    ? requestedStyle === 'custom' && !request.prompt.trim() ? 'normal' : requestedStyle : undefined;
  const image = videoStyle ? { original: source!.prompt, actual: source!.enhancedPrompt || source!.prompt } : undefined;
  const brief = videoStyle ? { style: videoStyle, prompt: request.prompt, sourcePrompt: image!.actual, duration: request.duration, preset: request.videoPreset } : undefined;
  const raw = brief ? motionDirection(brief) : request.prompt;
  const unenhanced = brief ? motionPrompt(brief, raw) : raw;
  let prompt = unenhanced;
  if (request.enhance) {
    events.enhancing?.(videoStyle);
    try {
      prompt = brief ? await enhanceMotion(brief, signal, request.ollama) : await enhancePrompt(raw, request.mode !== 'image', signal, request.ollama);
    } catch (error) {
      signal.throwIfAborted();
      events.fallback?.(error);
    }
  }
  signal.throwIfAborted();
  const promptTrace: PromptTrace = { raw, enhanced: prompt !== unenhanced, image };
  return { prompt, videoStyle, promptTrace };
}

// Plan all image variations before the first render so Ollama can unload once
// and leave memory available to the image runner for the entire batch.
export async function prepareGenerationPrompts(request: Generation, source: Media | undefined, signal: AbortSignal, events: PromptEvents = {}) {
  if (request.mode !== 'image' || request.count === 1) return [await prepareGenerationPrompt(request, source, signal, events)];
  signal.throwIfAborted();
  let prompts = Array<string>(request.count).fill(request.prompt);
  if (request.enhance) {
    events.enhancing?.();
    try { prompts = await enhanceImagePrompts(request.prompt, request.count, signal, request.ollama); }
    catch (error) { signal.throwIfAborted(); events.fallback?.(error); }
  }
  signal.throwIfAborted();
  return prompts.map(prompt => ({ prompt, videoStyle: undefined, promptTrace: { raw: request.prompt, enhanced: prompt !== request.prompt } }));
}
