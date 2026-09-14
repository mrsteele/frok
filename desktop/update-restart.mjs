export async function prepareUpdateRestart({ drain, supervisor, send, stopping, timeoutMs = 20_000 }) {
  const state = await drain();
  if (state.running) throw Error('A job is still running. Finish it before updating.');
  stopping(true);
  try {
    if (supervisor && supervisor.exitCode === null && !supervisor.signalCode) await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timeout); resolve(); };
      const timeout = setTimeout(() => { supervisor.removeListener('exit', done); reject(Error('The local service did not stop. Check the logs before retrying.')); }, timeoutMs);
      supervisor.once('exit', done); send('stop');
    });
  } catch (error) { stopping(false); send('resume'); throw error; }
}
