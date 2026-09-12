import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Tool = 'ffmpeg' | 'ffprobe';
type Options = { directory?: string; env?: Partial<NodeJS.ProcessEnv>; platform?: NodeJS.Platform; home?: string };

// Resolve installed commands only. Never download tools or search the library,
// model workspaces, current directory, or Electron's bundled dependencies.
export function resolveMediaTool(tool: Tool, { directory = '', env = process.env, platform = process.platform, home = os.homedir() }: Options = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const executable = `${tool}${platform === 'win32' ? '.exe' : ''}`;
  if (directory.trim()) {
    const expanded = /^~[/\\]/.test(directory.trim()) ? paths.join(home, directory.trim().slice(2)) : directory.trim();
    if (!paths.isAbsolute(expanded)) throw Error('Choose an absolute video tools folder, or leave it blank for automatic detection.');
    return paths.join(expanded, executable);
  }
  const override = env[tool === 'ffmpeg' ? 'FFMPEG_BIN' : 'FFPROBE_BIN']?.trim();
  if (override) return override;
  const defaults = platform === 'win32'
    ? [env.LOCALAPPDATA && paths.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'), env.ProgramFiles && paths.join(env.ProgramFiles, 'FFmpeg', 'bin'), paths.join(home, 'ffmpeg', 'bin')]
    : [...(platform === 'darwin' ? ['/opt/homebrew/bin'] : []), '/usr/local/bin', '/usr/bin'];
  const folders = [...(env.PATH || '').split(platform === 'win32' ? ';' : ':'), ...defaults].filter((folder): folder is string => !!folder && paths.isAbsolute(folder));
  for (const folder of new Set(folders)) {
    const file = paths.join(folder, executable);
    try { if (fs.statSync(file).isFile()) { fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return file; } } catch { /* Try the next installed location. */ }
  }
  // Keep a missing command absolute: Node must not fall back to a relative PATH
  // entry, which could execute a file from the app's working directory.
  return paths.join(defaults.filter((folder): folder is string => !!folder).at(-1)!, executable);
}

export const missingMediaToolsMessage = 'Install FFmpeg and FFprobe separately, then refresh connections. If needed, choose their folder under Generation preferences → Video tools folder.';
