import { EventEmitter } from 'node:events';

// Adapt Sparkle's silent user driver to the existing queue-aware update controller.
export function createSparkleUpdater(bridge, configuration) {
  const updater = new EventEmitter();
  let pending, complete, ready = false;
  bridge.setEventHandler(event => {
    const type = event.type === 'checking' ? 'checking-for-update' : event.type;
    if (type === 'update-downloaded') ready = true;
    if (type === 'error') ready = false;
    if (['checking-for-update', 'update-available', 'download-progress', 'update-downloaded', 'update-not-available', 'error'].includes(type)) {
      updater.emit(type, type === 'error' ? Error(event.message || 'Sparkle update failed.') : event);
    }
    if (['update-downloaded', 'update-not-available', 'error'].includes(type)) {
      const resolve = complete; pending = undefined; complete = undefined; resolve?.();
    }
  });
  if (!bridge.init(configuration)) throw Error('Sparkle could not initialize. Check the packaged update feed and public key.');
  // Frok owns check scheduling and restart permission. Never use installUpdateOnQuit.
  bridge.setAutomaticChecks(false);
  updater.checkForUpdates = () => {
    if (ready) return Promise.resolve();
    if (pending) return pending;
    const result = new Promise(resolve => { complete = resolve; });
    pending = result;
    try { bridge.checkForUpdates(); }
    catch (error) { pending = undefined; complete = undefined; throw error; }
    return result;
  };
  updater.quitAndInstall = () => {
    if (!ready) throw Error('The update has not finished downloading.');
    bridge.installUpdateNow();
  };
  return updater;
}
