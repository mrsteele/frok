import { pipelineId } from './pipelines/schema';
import { z } from "zod";
import { videoPresetSchema } from "./video-presets";
export const adapterSchema = z.object({
    primary: z.string().trim().max(2048).refine(s => !/[\x00-\x1f]/.test(s), 'Use a file path or registered model name.').optional(),
    primaryWeight: z.number().min(0).max(2).default(1),
    secondary: z.string().trim().max(2048).refine(s => !/[\x00-\x1f]/.test(s), 'Use a file path or registered model name.').default(''),
    secondaryWeight: z.number().min(0).max(2).default(0.7),
  });

export const generationSchema = z.object({
  sectionId: z.string().uuid().optional(),
  pipelineId:pipelineId.optional(),
  mode: z.enum(["image", "video", "reference", "upscale"]),
  prompt: z.string().trim().max(8000).default(""),
  aspect: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9", "3:2", "2:3"]).default("1:1"),
  duration: z.union([z.literal(6), z.literal(8), z.literal(10)]).default(6),
  quality: z.enum(["preview", "standard"]).default("preview"),
  count: z.number().int().min(1).max(12).default(4),
  enhance: z.boolean().default(false),
  videoStyle: z.enum(["normal", "fun", "custom", "preset"]).optional(),
  videoPreset: videoPresetSchema.optional(),
  rootId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(), referenceIds: z.array(z.string().uuid()).max(9).default([]),
  adapters: adapterSchema.optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
}).superRefine((v, ctx) => {
  if(v.rootId && (!['video','reference'].includes(v.mode) || v.sourceId)) ctx.addIssue({code:'custom',message:'A video root is only used for text or reference video renders.',path:['rootId']});
  if (v.videoStyle === 'preset' && !v.videoPreset) ctx.addIssue({code:'custom', message:'Choose a motion preset.', path:['videoPreset']});
  if (v.videoPreset && (v.videoStyle !== 'preset' || v.mode !== 'video' || !v.sourceId)) ctx.addIssue({code:'custom', message:'Presets need a starting image and preset motion style.', path:['videoPreset']});
  if (v.adapters && !['video', 'reference'].includes(v.mode)) ctx.addIssue({code:'custom', message:'Adapters are available for video generation only.', path:['adapters']});
  if (v.videoStyle && (v.mode !== "video" || !v.sourceId)) ctx.addIssue({code:"custom", message:"Choose a starting image for animation styles.", path:["videoStyle"]});
  if (v.mode !== "upscale" && !(v.mode === "video" && v.sourceId) && !v.prompt) ctx.addIssue({code:"custom", message:"Describe what you want to create.", path:["prompt"]});
  if (v.mode === "upscale" && !v.sourceId) ctx.addIssue({code:"custom", message:"Choose a video to upscale.", path:["sourceId"]});
  if (v.mode === "reference" && !v.referenceIds.length) ctx.addIssue({code:"custom", message:"Add at least one reference image.", path:["referenceIds"]});
  if (v.mode === "reference" && v.sourceId) ctx.addIssue({code:"custom", message:"References and a starting frame use separate models. Choose one.", path:["sourceId"]});
  if (v.mode === "image" && (v.sourceId || v.referenceIds.length)) ctx.addIssue({code:"custom", message:"Choose video to animate an image.", path:["mode"]});
  if (v.mode !== "reference" && v.referenceIds.length) ctx.addIssue({code:"custom", message:"Choose reference video for reference images.", path:["mode"]});
}).transform(v => v.mode === 'video' && (v.videoStyle === 'preset' || v.videoStyle === 'normal') ? { ...v, prompt: '' } : v);
export function dimensions(aspect: string, quality: string, video = false, source?: {width:number;height:number}) {
  const [a,b] = aspect.split(":").map(Number);
  const ratio = source ? source.width / source.height : a / b;
  if(video) {
    const shortEdge = quality === "preview" ? 480 : 720;
    const maxLong = quality === "preview" ? 1280 : 1920;
    let w = ratio >= 1 ? shortEdge * ratio : shortEdge;
    let h = ratio >= 1 ? shortEdge : shortEdge / ratio;
    const scale = Math.min(1, maxLong / Math.max(w,h), source ? Math.min(source.width/w, source.height/h) : 1);
    w *= scale; h *= scale;
    const outputWidth = Math.max(2, Math.round(w / 2) * 2);
    const outputHeight = Math.max(2, Math.round(h / 2) * 2);
    return { width: Math.ceil(outputWidth/32)*32, height: Math.ceil(outputHeight/32)*32, outputWidth, outputHeight };
  }
  const edge = quality === "preview" ? 512 : 1024;
  const w = ratio >= 1 ? edge : edge * ratio;
  const h = ratio >= 1 ? edge / ratio : edge;
  return { width: Math.max(16, Math.round(w/16)*16), height: Math.max(16, Math.round(h/16)*16), outputWidth:0, outputHeight:0 };
}
export function frameCount(seconds: number) { return Math.ceil((seconds * 24 - 5) / 17) * 17 + 5; }
export function hdDimensions(width: number, height: number) {
  if (Math.min(width, height) >= 720) throw new Error('This video is already HD (720p or higher).');
  const scale = Math.min(720 / Math.min(width, height), 1920 / Math.max(width, height));
  if (scale <= 1) throw new Error('This video is already at the supported maximum size.');
  return { width: Math.round(width * scale / 2) * 2, height: Math.round(height * scale / 2) * 2 };
}
