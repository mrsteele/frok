import type { PipelineSnapshot, PipelineSelections, PipelineStatus } from './pipelines/schema';
import type { ImageModelId } from './image-models';
import type { Connections, ModelSelections, ConnectionId, ConnectionStatus, Capability, CapabilityStatus } from './service-config';
export type Mode = "image" | "video" | "reference" | "upscale";
export type VideoStyle = "normal" | "fun" | "custom" | "preset";
export type VideoPreset = { id: string; name: string; prompt: string; isDefault?: boolean };
export type Adapters = { primary?: string; primaryWeight: number; secondary: string; secondaryWeight: number };
export type Upscaler = 'realesrgan' | 'seedvr2';
export type Runner = import('./providers/definitions').ProviderId;
export type PromptTrace = {
  raw: string; enhanced: boolean;
  image?: { original: string; actual: string };
};
export type Media = {
  sectionId?: string;
  id: string; kind: "image" | "video"; filename: string; prompt: string;
  enhancedPrompt: string; width: number; height: number; duration?: number;
  seed: number; favorite: boolean; sourceId?: string; createdAt: string;
  jobId?: string; origin: "generated" | "upload" | "upscale" | "poster";
  referenceOnly?: boolean;
  runner?: Runner; imageModel?: ImageModelId; upscaler?: Upscaler; upscalePipeline?: {id:string;name:string;revision:string}; quality?: string; batchIndex?: number; videoStyle?: VideoStyle;
  rootId?: string; assetNumber?: number; generation?: Generation; promptTrace?: PromptTrace; runnerSeconds?: number; elapsedSeconds?: number;
};
export type Generation = {
  sectionId?: string;
  pipelineId?: string; pipeline?: PipelineSnapshot; pipelineChoices?: Partial<Record<Mode,string|undefined>>;
  ollama?: OllamaConfig;
  imageModel?: ImageModelId;
  upscaler?: Upscaler;
  mode: Mode; prompt: string; aspect: string; duration: number;
  quality: "preview" | "standard"; count: number; enhance: boolean;
  videoStyle?: VideoStyle;
  videoPreset?: VideoPreset;
  rootId?: string;
  sourceId?: string; referenceIds: string[]; seed?: number;
  adapters?: Adapters;
};
export type JobStep = { current: number; total: number; label?: string };
export type VideoProgressState = {
  phase: 'preparing' | 'denoise' | 'decode' | 'finishing' | 'completed';
  percent: number; stagePercent?: number;
};
export type OllamaConfig = { url: string; model: string };
// Legacy fields keep older job history readable; new jobs reference only a bundled starter.
export type SetupRequest = { preparation?:string; preparationRevision?:string; name?:string; pipeline?: PipelineSnapshot; task: string; ollama?: OllamaConfig; imageModel?: ImageModelId };
export type Job = {
  id: string; kind: "generate" | "setup"; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  queuePosition?: number; pauseRequested?: boolean; accumulatedSeconds?: number;
  request: Generation | SetupRequest; runner: Runner; completed: number;
  total: number; startedAt?: string; finishedAt?: string; elapsedSeconds?: number; runnerSeconds?: number; dismissedAt?: string; step?: JobStep | null; videoProgress?: VideoProgressState; message: string; error?: string; createdAt: string; updatedAt: string;
};
export type Settings = { promptModelSetting?: string|null; pipelineDirectory?: string; pipelineSelections: PipelineSelections; connections: Connections; modelSelections: ModelSelections; imageModel: ImageModelId; ollamaModel: string; ollamaUrl: string; upscaler: Upscaler; runner: Runner; vpipeWorkdir: string; comfyUrl: string; comfyDir: string; setupDismissed: boolean; videoAdapters: Adapters; referenceAdapters: Adapters };
export type Check = { id: string; name: string; ready: boolean; detail: string };
export type ImageHealth = { setupTask?: string; model: ImageModelId; runner: Runner; connected: boolean; ready: boolean; detail: string };
export type ConnectionFields = {values:import('./runner-locations').RunnerLocations & {ollamaUrl:string};defaults:import('./runner-locations').RunnerLocations & {ollamaUrl:string}};
export type Health = { promptModelSetting?: string|null; connectionFields?: ConnectionFields; pipelineLibrary?: import('./pipelines/location').PipelineLibrary; runnerDefaults?: import('./runner-locations').RunnerLocations; pipelines?: PipelineStatus[]; pipelineSelections?: PipelineSelections; pipelineErrors?: string[]; connections?: Record<ConnectionId,ConnectionStatus>; modelSelections?: ModelSelections; capabilities?: Record<Capability,CapabilityStatus>; recommendedPromptModel?: string; image?: ImageHealth; upscaler?: Upscaler; checks: Check[]; runner: Runner; worker: boolean; ollama: boolean; ollamaModel?: string; ollamaModels?: string[]; ollamaUrl?: string; ollamaConnected: boolean; platform: string; memoryGB: number; diskGB: number; workdir: string; comfyUrl?: string; comfyDir?: string; setupDismissed: boolean; videoAdapters: Adapters; referenceAdapters: Adapters; upscalerReady: boolean; upscalerSupported: boolean; models: Record<string, boolean> };
export const mediaUrl = (id: string) => `/api/media/${id}`;

export type GpuSample = { at: number; busy: number | null };
export type Telemetry = { samples: GpuSample[]; busy: number | null; sampledAt?: number; detail: string };

export type MediaFamily = { root: Media; renders: { media: Media; hd?: Media }[]; legacyRootIds?:string[]; references?: {id:string;media?:Media}[] };

export type DeleteTarget = { scope: 'media'; id: string } | { scope: 'history' } | { scope: 'section'; sectionId?: string; jobIds: string[] };
export type DeletePlan = { token: string; total: number; images: number; referenceImages?: number; videos: number; hdVersions: number; favorites: number; protectedCount: number; jobs?: number; blocked?: string };
