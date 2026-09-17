import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Register immediately after spawn, including when startup itself fails.
export function trackSmokeChild(child) {
  const closed = new Promise(resolve => {
    child.once('error', () => {}); // spawn errors are reported through the result below
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return async () => {
    async function wait(ms) {
      let timer;
      try {
        return await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]);
      } finally { clearTimeout(timer); }
    }
    // Let app.quit() flush the profile before resorting to termination.
    if (await wait(5000)) return;
    child.kill('SIGTERM');
    if (await wait(5000)) return;
    child.kill('SIGKILL');
    if (!await wait(5000)) throw Error('Smoke app did not exit; retaining its temporary files.');
  };
}

// Sparkle relaunches the new app independently of the original child handle.
export async function waitForSmokeProcess(pid, timeoutMs = 10000) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('Invalid smoke app PID.');
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    if (Date.now() >= deadline) throw Error('Relaunched smoke app did not exit; retaining its temporary files.');
    await delay(100);
  }
}

export async function removeSmokeDirectory(directory) {
  // Chromium helpers may finish profile writes just after the main process exits.
  // Only transient filesystem errors are retried; persistent cleanup failures fail CI.
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
