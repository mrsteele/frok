import { runProcess } from './process';
import { missingMediaToolsMessage } from './media-tools';

// External FFmpeg builds vary. A successful -version alone does not prove
// that the encoders used by generation and HD finishing are available.
export async function mediaToolsStatus(
  commands: { ffmpeg: string; ffprobe: string },
  signal?: AbortSignal,
  execute: typeof runProcess = runProcess,
) {
  signal?.throwIfAborted();
  const encoders = new Set<string>();
  let pending = '';
  const readEncoders = (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/[\r\n]/);
    pending = (lines.pop() || '').slice(-1024);
    for (const line of lines) {
      const match = /^\s*[VAS][A-Z.]{5}\s+(\S+)\s/.exec(line);
      if (match) encoders.add(match[1]);
    }
  };
  const [ffmpeg, ffprobe] = await Promise.all([
    execute(commands.ffmpeg, ['-hide_banner', '-encoders'], { signal, timeout: 5000, onLog: readEncoders }).then(() => true, () => false),
    execute(commands.ffprobe, ['-version'], { signal, timeout: 5000 }).then(() => true, () => false),
  ]);
  signal?.throwIfAborted();
  readEncoders('\n');
  if (!ffmpeg || !ffprobe) return { ready: false, detail: missingMediaToolsMessage };
  const missing = ['libx264', 'aac'].filter(name => !encoders.has(name));
  if (missing.length) return { ready: false, detail: `The selected FFmpeg build is missing ${missing.join(' and ')} encoding support. Choose a build with H.264 (libx264) and AAC encoders under Advanced → Background tasks & tools → Video tools folder.` };
  return { ready: true, detail: 'FFmpeg H.264/AAC encoding and FFprobe ready' };
}
