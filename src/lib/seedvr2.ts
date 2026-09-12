import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { dataDir, ffmpeg, ffprobe, mediaDir, jobTimeoutMs } from './config';
import { download } from './download';
import { runProcess } from './process';
import { hdDimensions } from './validation';
import { seedvr2Args, seedvr2Fingerprint, seedvr2Models, seedvr2Progress, seedvr2Revision } from './seedvr2-profile';
import { privateJobDirectory } from './vpipe';
import type { Media } from './types';

export const seedvr2Dir = path.join(dataDir, 'runtimes', 'seedvr2');
const source = path.join(seedvr2Dir, 'source');
const modelDir = path.join(seedvr2Dir, 'models');
const python = path.join(seedvr2Dir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const cli = path.join(source, 'inference_cli.py');
const receiptFile = path.join(seedvr2Dir, 'ready.json');
const uvVersion = '0.12.10';
export function seedvr2Supported() {
  return process.platform === 'darwin' && process.arch === 'arm64' || ['linux', 'win32'].includes(process.platform) && process.arch === 'x64';
}
function environment() {
  return { ...process.env, PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1',
    UV_CACHE_DIR: path.join(seedvr2Dir, 'cache', 'uv'), UV_PYTHON_INSTALL_DIR: path.join(seedvr2Dir, 'python'),
    UV_PYTHON_BIN_DIR: path.join(seedvr2Dir, 'bin'), UV_TOOL_DIR: path.join(seedvr2Dir, 'tools'),
    HF_HOME: path.join(seedvr2Dir, 'cache', 'huggingface'), TORCH_HOME: path.join(seedvr2Dir, 'cache', 'torch'),
    XDG_CACHE_HOME: path.join(seedvr2Dir, 'cache'), MPLCONFIGDIR: path.join(seedvr2Dir, 'cache', 'matplotlib'),
    PIP_CACHE_DIR: path.join(seedvr2Dir, 'cache', 'pip'), UV_LINK_MODE: 'copy', UV_NO_MODIFY_PATH: '1',
    PYTORCH_ENABLE_MPS_FALLBACK: '1', PATH: [path.dirname(ffmpeg()), path.dirname(ffprobe()), process.env.PATH].filter(Boolean).join(path.delimiter) };
}
function inferenceEnvironment(directory: string): NodeJS.ProcessEnv {
  const cache = path.join(directory, 'cache'), home = path.join(directory, 'home'), temp = path.join(directory, 'tmp');
  const env: NodeJS.ProcessEnv = {...environment(), HOME: home, USERPROFILE: home,
    TMPDIR: temp, TMP: temp, TEMP: temp, XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_STATE_HOME: path.join(home, 'state'),
    PYTHONPATH: source, PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: path.join(cache, 'python'),
    HF_HOME: path.join(cache, 'huggingface'), HF_HUB_CACHE: path.join(cache, 'huggingface', 'hub'),
    HUGGINGFACE_HUB_CACHE: path.join(cache, 'huggingface', 'hub'), HF_ASSETS_CACHE: path.join(cache, 'huggingface', 'assets'), HF_XET_CACHE: path.join(cache, 'huggingface', 'xet'),
    TRANSFORMERS_CACHE: path.join(cache, 'transformers'), TORCH_HOME: path.join(cache, 'torch'),
    TORCH_EXTENSIONS_DIR: path.join(cache, 'torch-extensions'), TORCHINDUCTOR_CACHE_DIR: path.join(cache, 'torchinductor'),
    TORCH_COMPILE_DEBUG_DIR: path.join(cache, 'torch-debug'),
    TRITON_CACHE_DIR: path.join(cache, 'triton'), CUDA_CACHE_PATH: path.join(cache, 'cuda'), NUMBA_CACHE_DIR: path.join(cache, 'numba'),
    MPLCONFIGDIR: path.join(cache, 'matplotlib'), PIP_CACHE_DIR: path.join(cache, 'pip'), UV_CACHE_DIR: path.join(cache, 'uv')};
  // Do not let inherited Python configuration or FFmpeg report paths write
  // user inputs/diagnostics into the shared installation or another home.
  delete env.PYTHONHOME; delete env.FFREPORT; delete env.TORCH_TRACE;
  delete env.HF_TOKEN; delete env.HUGGING_FACE_HUB_TOKEN;
  return env;
}
async function stamp(file: string) { const s = await fs.stat(file); return { size: s.size, mtimeMs: s.mtimeMs }; }
const required = () => [python, cli, path.join(source, 'pos_emb.pt'), path.join(source, 'neg_emb.pt'), ...seedvr2Models.map(m => path.join(modelDir, m.name))];
type Receipt = { fingerprint: string; device: string; files: Record<string, {size: number; mtimeMs: number}> };
export async function seedvr2Ready() {
  try {
    const record: Receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    if (record.fingerprint !== seedvr2Fingerprint || !['mps', 'cuda'].includes(record.device)) return false;
    for (const file of required()) {
      const current = await stamp(file), saved = record.files[path.relative(seedvr2Dir, file)];
      if (!saved || current.size !== saved.size || current.mtimeMs !== saved.mtimeMs) return false;
    }
    return true;
  } catch { return false; }
}
async function sha256(file: string, signal: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, {signal})) hash.update(chunk);
  return hash.digest('hex');
}
async function unpack(archive: string, destination: string, signal: AbortSignal, log: (s: string) => void) {
  await fs.mkdir(destination, {recursive: true});
  if (archive.endsWith('.tar.gz')) await runProcess('tar', ['-xzf', archive, '-C', destination, '--strip-components=1'], {signal, onLog: log});
  else if (process.platform === 'win32') await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:FROK_ARCHIVE -DestinationPath $env:FROK_UNPACK -Force'], {signal, onLog: log, env: {...environment(), FROK_ARCHIVE: archive, FROK_UNPACK: destination}});
  else await runProcess('unzip', ['-q', '-o', archive, '-d', destination], {signal, onLog: log});
}
export async function installSeedvr2(signal: AbortSignal, log: (s: string) => void) {
  if (await seedvr2Ready()) { log('SeedVR2 is installed and verified.\n'); return; }
  if (!seedvr2Supported()) throw new Error('SeedVR2 setup supports Apple Silicon Macs and Windows/Linux x64 with a compatible GPU.');
  await fs.mkdir(seedvr2Dir, {recursive: true});
  const disk = await fs.statfs(seedvr2Dir);
  if (disk.bavail * disk.bsize < 8 * 1024 ** 3) throw new Error('Allow at least 8 GB free for SeedVR2, Python and model downloads.');
  await fs.rm(receiptFile, {force: true});
  const triple = process.platform === 'darwin' ? 'aarch64-apple-darwin' : process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu';
  const uvDir = path.join(seedvr2Dir, 'uv'), uv = path.join(uvDir, process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (!await fs.stat(uv).catch(() => null)) {
    const asset = `uv-${triple}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`, archive = path.join(seedvr2Dir, asset);
    const url = `https://github.com/astral-sh/uv/releases/download/${uvVersion}/${asset}`;
    log('Installing portable Python tools inside this project…\n');
    await download(url, archive, signal, log);
    const response = await fetch(url + '.sha256', {signal});
    if (!response.ok) throw new Error('Could not verify the Python installer checksum.');
    const expected = (await response.text()).trim().split(/\s+/)[0];
    if (await sha256(archive, signal) !== expected) throw new Error('Python installer checksum does not match.');
    await unpack(archive, uvDir, signal, log);
  }
  if (!await fs.stat(cli).catch(() => null)) {
    log('Downloading the pinned SeedVR2 standalone runtime…\n');
    const archive = path.join(seedvr2Dir, 'source.zip'), staging = path.join(seedvr2Dir, 'unpack-source');
    await download(`https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler/archive/${seedvr2Revision}.zip`, archive, signal, log);
    await unpack(archive, staging, signal, log);
    const [folder] = await fs.readdir(staging);
    await fs.cp(path.join(staging, folder), source, {recursive: true});
    await fs.rm(staging, {recursive: true, force: true});
  }
  const env = environment();
  if (!await fs.stat(python).catch(() => null)) await runProcess(uv, ['venv', '--python', '3.12', '--managed-python', path.join(seedvr2Dir, '.venv')], {signal, env, onLog: log});
  log('Installing SeedVR2 dependencies into its own Python environment…\n');
  await runProcess(uv, ['pip', 'install', '--python', python, 'torch==2.9.1', 'torchvision==0.24.1', '-r', path.join(source, 'requirements.txt')], {signal, env, onLog: log});
  // Import/CLI checks only; setup never runs inference or touches the user's media.
  await runProcess(python, [cli, '--help'], {cwd: source, signal, env, timeout: 120000});
  const device = (await runProcess(python, ['-c', 'import torch; print("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")'], {signal, env, timeout: 30000})).trim();
  if (!['mps', 'cuda'].includes(device)) throw new Error('SeedVR2 needs a working Apple Metal or CUDA GPU. Its Python environment was kept; check your GPU setup, then retry.');
  for (const model of seedvr2Models) {
    const file = path.join(modelDir, model.name);
    log(`Downloading ${model.name}…\n`);
    await download(`https://huggingface.co/${model.repo}/resolve/main/${model.name}`, file, signal, log);
    if ((await fs.stat(file)).size !== model.size || await sha256(file, signal) !== model.sha256) {
      await fs.rm(file, {force: true}); throw new Error(`${model.name} failed integrity verification. Retry its setup download.`);
    }
  }
  const record: Receipt = {fingerprint: seedvr2Fingerprint, device, files: {}};
  for (const file of required()) record.files[path.relative(seedvr2Dir, file)] = await stamp(file);
  await fs.writeFile(receiptFile, JSON.stringify(record));
  log(`SeedVR2 3B Q4 and its VAE are ready on ${device === 'mps' ? 'Apple Metal' : 'CUDA'}.\n`);
}
export async function upscaleSeedvr2(media: Media, output: string, directory: string, signal: AbortSignal, log: (s: string) => void, onProgress: (done: number, total: number, message?: string) => void, seed = media.seed) {
  signal.throwIfAborted();
  directory = await privateJobDirectory(directory);
  const ownedMedia = await fs.realpath(/* turbopackIgnore: true */ mediaDir());
  const input = await fs.realpath(/* turbopackIgnore: true */ path.join(ownedMedia, media.filename));
  const relative = path.relative(ownedMedia, input);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('SeedVR2 input must belong to the local library.');
  const outputParent = await fs.realpath(/* turbopackIgnore: true */ path.dirname(output));
  if (outputParent !== ownedMedia && outputParent !== directory) throw new Error('SeedVR2 output must belong to the local library.');
  const existingOutput = await fs.lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
  if (existingOutput && !existingOutput.isFile()) throw new Error('Invalid SeedVR2 output file.');
  if (!await seedvr2Ready()) throw new Error('Download SeedVR2 in Settings → HD enhancement before upscaling.');
  const target = hdDimensions(media.width, media.height);
  const report = seedvr2Progress((percent, message) => onProgress(percent, 100, message));
  const workspace = await fs.mkdtemp(path.join(directory, 'seedvr2-')), raw = path.join(workspace, 'seedvr2.mp4');
  const env = inferenceEnvironment(workspace);
  try {
    for (const name of ['cache', 'home', 'tmp']) await fs.mkdir(path.join(/* turbopackIgnore: true */ workspace, name), {mode: 0o700});
    // Pinned CLI resolves imports/configs/pos_emb.pt/neg_emb.pt from __file__,
    // and accepts an absolute --model_dir; none require the shared source cwd.
    log('Restoring video with SeedVR2 3B Q4 · temporal batches of 5 · tiled VAE · 720p.\n');
    onProgress(0, 100, 'SeedVR2 · Loading restoration models…');
    await runProcess(python, [cli, ...seedvr2Args(input, raw, modelDir, seed)], {cwd: workspace, signal, env, timeout: jobTimeoutMs(), onLog: text => {log(text); report(text);}});
    report('\n'); signal.throwIfAborted();
    // The CLI can return success after an internal error: require its actual output.
    if (!(await fs.stat(raw).catch(() => null))?.size) throw new Error('SeedVR2 did not produce a video. Inspect the runner log.');
    const metadata = JSON.parse(await runProcess(ffprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', raw], {cwd: workspace, env, signal}));
    const video = metadata.streams?.find((s: {codec_type: string}) => s.codec_type === 'video');
    if (!video || video.width < target.width - 2 || video.height < target.height - 2) throw new Error('SeedVR2 output did not reach the requested resolution.');
    if (!media.duration || Math.abs(Number(metadata.format?.duration) - media.duration) > .15) throw new Error('SeedVR2 output duration does not match the source.');
    onProgress(95, 100, 'SeedVR2 · Restoring original audio and saving…');
    await runProcess(ffmpeg(), ['-hide_banner', '-y', '-i', raw, '-i', input, '-map', '0:v:0', '-map', '1:a?', '-vf', `scale=${target.width}:${target.height}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-t', String(media.duration), '-movflags', '+faststart', output], {cwd: workspace, env, signal, onLog: log});
    onProgress(100, 100, 'SeedVR2 · Video saved');
  } finally { await fs.rm(workspace, {recursive: true, force: true}); }
}
