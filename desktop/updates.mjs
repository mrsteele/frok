export function updateAvailability({ packaged, releaseEnabled, platform = process.platform, appImage = process.env.APPIMAGE }) {
  if (!packaged) return 'Updates are available in installed releases. Development uses your local source.';
  if (!releaseEnabled) return 'This local build does not receive automatic updates.';
  if (platform === 'linux' && !appImage) return 'Automatic updates are available when running the AppImage.';
  return '';
}

export function createUpdates({ updater, unavailable = '', changed = () => {}, beforeInstall, log = console, every = setInterval, cancel = clearInterval }) {
  let state = { status: unavailable ? 'disabled' : 'idle', message: unavailable || 'Updates download automatically. You choose when to restart.' };
  let checking, installing, timer, disposed = false;
  const listeners = [];
  function set(patch) {
    if (disposed) return;
    const next = { ...state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next; changed({ ...state });
  }
  function failed(error) {
    log.error(error);
    set({ status: 'error', message: state.status === 'installing' ? 'The update could not be installed. Restart Frok and try again.' : 'Could not update Frok. Check your connection and try again.' });
  }
  function on(event, handler) { updater.on(event, handler); listeners.push([event, handler]); }
  if (!unavailable) {
    updater.autoDownload = true;
    // All restarts go through Frok's queue drain and backend shutdown.
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.logger = log;
    on('checking-for-update', () => set({ status: 'checking', message: 'Checking for updates…' }));
    on('update-available', info => set({ status: 'downloading', version: info.version, percent: 0, message: `Downloading Frok ${info.version}…` }));
    on('download-progress', progress => set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.floor(progress.percent || 0))) }));
    on('update-not-available', () => set({ status: 'idle', version: undefined, percent: undefined, message: 'Frok is up to date.' }));
    on('update-downloaded', info => set({ status: 'ready', version: info.version, percent: 100, message: `Frok ${info.version} is ready. Restart to install.` }));
    on('error', failed);
  }
  const api = {
    get state() { return { ...state }; },
    check() {
      if (unavailable || disposed || ['ready', 'waiting', 'installing'].includes(state.status)) return Promise.resolve(api.state);
      if (checking) return checking;
      checking = (async () => {
        try { const result = await updater.checkForUpdates(); await result?.downloadPromise; }
        catch (error) { failed(error); }
        finally { checking = undefined; }
        return api.state;
      })();
      return checking;
    },
    start() {
      if (unavailable || disposed || timer !== undefined) return;
      void api.check();
      timer = every(() => void api.check(), 6 * 60 * 60 * 1000); timer.unref?.();
    },
    defer() { if (state.status === 'ready') set({ status: 'waiting', message: 'The current job will finish before Frok restarts to update.' }); },
    cancelDeferred() { if (state.status === 'waiting') set({ status: 'ready', message: `Frok ${state.version} is ready. Restart to install.` }); },
    install() {
      if (installing) return installing;
      if (!['ready', 'waiting'].includes(state.status) || disposed) return Promise.resolve();
      set({ status: 'installing', message: 'Preparing to restart…' });
      installing = (async () => {
        try {
          await beforeInstall();
          set({ status: 'installing', message: 'Restarting to install the update…' });
          updater.quitAndInstall(false, true);
        } catch (error) {
          log.error(error);
          set({ status: 'ready', message: `Could not restart safely: ${error.message}` });
        } finally { installing = undefined; }
      })();
      return installing;
    },
    dispose() { disposed = true; if (timer !== undefined) cancel(timer); for (const [event, handler] of listeners) updater.removeListener(event, handler); },
  };
  return api;
}
