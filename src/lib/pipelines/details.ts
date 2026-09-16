import { z } from 'zod';

export const publicUrl = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use an HTTPS link without credentials.');
const rating = z.object({
  score: z.number().min(0).max(5),
  basis: z.string().trim().min(1).max(600),
  source: publicUrl,
}).strict();

export const catalogDetails = z.object({
  family: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  flavor: z.string().trim().min(1).max(100),
  precision: z.string().max(100).optional(),
  uses: z.array(z.string().min(1).max(100)).max(12).default([]),
  requirements: z.array(z.string().min(1).max(600)).max(12).default([]),
  access: z.array(z.object({ name: z.string().min(1).max(100), url: publicUrl, gated: z.boolean() }).strict()).max(12).default([]),
  documentation: publicUrl,
  setup: z.string().trim().min(1).max(2000),
  experimental: z.boolean().default(false),
  // Estimates are explicitly distinguished from file-manifest byte totals.
  estimates: z.object({
    downloadGB: z.number().positive().optional(),
    installedGB: z.number().positive().optional(),
    preparationGB: z.number().positive().optional(),
    memoryGB: z.number().positive().optional(),
    basis: z.string().min(1).max(600),
    source: publicUrl,
  }).strict().optional(),
  ratings: z.object({ speed: rating.optional(), adherence: rating.optional() }).strict().optional(),
}).strict();

export type CatalogDetails = z.infer<typeof catalogDetails>;
export type PipelineFiles = { reference: string; ready: boolean; size?: number; url?: string }[];
export function gatedAccess(details?: CatalogDetails) {
  return details?.access.filter(item => item.gated) || [];
}
export function pipelinePrompt(prompt: string, suffix?: string) {
  return suffix ? `${prompt.trimEnd()} ${suffix}`.trim() : prompt;
}
export function knownDownloadBytes(files: PipelineFiles) {
  return files.length && files.every(file => file.size !== undefined)
    ? files.reduce((sum, file) => sum + file.size!, 0)
    : undefined;
}
