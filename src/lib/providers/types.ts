import type { Generation } from '../types';
import type { Dependency, PipelineSnapshot } from '../pipelines/schema';
import type { ProviderId } from './definitions';

export type RenderInput = {
  request: Generation;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  fps?: number;
  frames?: number;
  output: string;
  directory: string;
  source?: string;
  references: string[];
  signal: AbortSignal;
  log: (line: string) => void;
  onRuntime?: (seconds: number) => void;
  waitForStop?: () => boolean;
};

export type PreparationInput = {
  snapshot: PipelineSnapshot;
  graph?: Record<string, unknown>;
  files?: Dependency[];
  directory: string;
  signal: AbortSignal;
  log: (line: string) => void;
};
export type InspectionContext = { responses: Map<string, Promise<unknown>> };

// A provider owns its native payload, setup and job lifecycle. Cancellation is
// carried by AbortSignal; providers without remote progress may report logs only.
export interface ProviderAdapter {
  id: ProviderId;
  validate(snapshot: PipelineSnapshot): void;
  inspect(snapshot: PipelineSnapshot, missing: Dependency[], context?: InspectionContext): Promise<string | undefined>;
  render(input: RenderInput): Promise<void>;
  prepare?: (input: PreparationInput) => Promise<void>;
}
