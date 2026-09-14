import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Compiling route modules must never open the user's live library.
const temporary = await mkdtemp(path.join(os.tmpdir(), 'frok-build-'));
try {
  const env = { ...process.env, FROK_DATA_DIR: temporary, FROK_ENV_FILE: path.join(temporary, 'absent.env'), FROK_PIPELINE_HOME: temporary, NEXT_TELEMETRY_DISABLED: '1' };
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { stdio: 'inherit', env });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally { await rm(temporary, { recursive: true, force: true }); }
