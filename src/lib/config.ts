import { legacyDefaults, runtimeOptions } from './preferences';
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { resolveMediaTool } from './media-tools';
import { libraryMediaDir, libraryJobsDir } from "./library";
export { root, dataDir } from "./paths";
export const mediaDir = libraryMediaDir;
export const jobsDir = libraryJobsDir;
export function comfyServiceUrl(value = legacyDefaults().COMFYUI_URL || 'http://127.0.0.1:8000') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a ComfyUI HTTP service address without credentials, a path, query or fragment.');
  return value;
}
export function expandPath(value: string) { return path.resolve(/^~[/\\]/.test(value) ? path.join(os.homedir(), value.slice(2)) : value); }
export function vpipeBin() {
  return process.env.VPIPE_BIN || (["/Applications/Vpipe Manager.app/Contents/Helpers/vpipe"].find(p=>fs.existsSync(p)) || "vpipe");
}
export const ffmpeg = () => resolveMediaTool('ffmpeg', {directory: runtimeOptions().mediaToolsDirectory});
export const ffprobe = () => resolveMediaTool('ffprobe', {directory: runtimeOptions().mediaToolsDirectory});
export const jobTimeoutMs = () => runtimeOptions().jobTimeoutMinutes * 60_000;
export const modelNames = {
  get image() { return legacyDefaults().VPIPE_IMAGE_MODEL || "krea/Krea-2-Turbo"; },
  get video() { return legacyDefaults().VPIPE_VIDEO_MODEL || "local/MiniMax-H3-FL2VA-8bit"; },
  get reference() { return legacyDefaults().VPIPE_REFERENCE_MODEL || "local/MiniMax-H3-Ref2VA-8bit"; },
};
