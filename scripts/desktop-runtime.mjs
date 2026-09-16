import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// npm can replace node_modules while a development window is still open.
// Electron launches helpers lazily (including audio on video playback), and
// aborts in AppendExtraCommandLineSwitches if their executable path disappears.
// Give each launch its own distribution, including frameworks and helpers.
export async function stageDesktopRuntime(executable, {
  directory = path.resolve('.data/desktop-runtime'),
  platform = process.platform,
} = {}) {
  const distribution = platform === 'darwin'
    ? path.resolve(path.dirname(executable), '../../..')
    : path.dirname(executable);
  await fs.mkdir(directory, { recursive: true });
  const snapshot = await fs.mkdtemp(path.join(await fs.realpath(directory), 'run-'));
  const dispose = () => fs.rm(snapshot, { recursive: true, force: true });
  try {
    await fs.cp(distribution, snapshot, {
      recursive: true,
      // Framework links must stay within the copy, not point into node_modules.
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    const stagedExecutable = path.join(snapshot, path.relative(distribution, executable));
    await fs.access(stagedExecutable, constants.X_OK);
    return { executable: stagedExecutable, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export async function runDesktop(executable, args, { env = process.env, ...options } = {}) {
  const runtime = await stageDesktopRuntime(executable, options);
  let child;
  const stop = () => child?.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    return await new Promise((resolve, reject) => {
      child = spawn(runtime.executable, args, { stdio: 'inherit', env });
      child.once('error', reject);
      // A native crash reports a signal and a null code, never success.
      child.once('close', code => resolve(code ?? 1));
    });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await runtime.dispose();
  }
}
