import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Launchers and the backend share one default, independent of the checkout.
// Explicit overrides keep tests and separately selected workspaces isolated.
export function storagePaths(environment = process.env, { root = process.cwd(), userHome = os.homedir() } = {}) {
  const home = path.resolve(root, environment.FROK_HOME || path.join(userHome, 'frok'));
  if ([path.parse(home).root, path.resolve(userHome)].includes(home)) throw Error('Choose a dedicated Frok workspace folder.');
  return {
    home,
    data: path.resolve(root, environment.FROK_DATA_DIR || path.join(home, 'data')),
    pipelineHome: path.resolve(root, environment.FROK_PIPELINE_HOME || home),
  };
}

// Electron supplies appData directly; browser development uses the same OS default.
// A separate workspace gets separate machine state, without carrying secrets in it.
export function applicationPaths(environment = process.env, { root = process.cwd(), userHome = os.homedir(), platform = process.platform, appData } = {}) {
  const base = appData || (platform === 'darwin' ? path.join(userHome, 'Library/Application Support')
    : platform === 'win32' ? environment.APPDATA || path.join(userHome, 'AppData/Roaming')
      : environment.XDG_CONFIG_HOME || path.join(userHome, '.config'));
  const profile = path.resolve(base, 'Frok');
  const { home } = storagePaths(environment, { root, userHome });
  const state = home === path.join(userHome, 'frok') ? profile
    : path.join(profile, 'workspaces', createHash('sha256').update(home).digest('hex').slice(0, 16));
  return { profile, state, logs: path.resolve(root, environment.FROK_LOG_DIR || path.join(state, 'logs')) };
}
