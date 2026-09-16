import { product } from '../desktop/product.mjs';
import { signingConfiguration } from './desktop-signing.mjs';
import { readFileSync } from 'node:fs';

export function releaseConfiguration(base, env = process.env, platform = process.platform) {
  const config = signingConfiguration(base, env, platform);
  const repository = env.GITHUB_REPOSITORY || new URL(product.githubUrl).pathname.slice(1);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('Use a GitHub owner/repository for desktop releases.');
  const [owner, repo] = repository.split('/');
  config.publish = [{ provider: 'github', owner, repo, releaseType: 'release' }];
  config.electronUpdaterCompatibility = '>=2.16';
  config.extraMetadata = { ...config.extraMetadata, frokUpdates: true };
  if (platform === 'darwin') {
    const { publicEdKey } = JSON.parse(readFileSync(new URL('../desktop/sparkle-key.json', import.meta.url), 'utf8'));
    if (!/^[A-Za-z0-9+/]{43}=$/.test(publicEdKey) || Buffer.from(publicEdKey, 'base64').length !== 32) throw Error('Configure the Sparkle public update key before packaging macOS.');
    const arch = process.arch;
    if (!['arm64', 'x64'].includes(arch)) throw Error('Sparkle releases require arm64 or x64.');
    const appcastUrl = `https://github.com/${repository}/releases/latest/download/appcast-${arch}.xml`;
    config.extraMetadata.frokSparkle = { appcastUrl, publicEdKey };
    config.mac = { ...config.mac, extendInfo: { ...config.mac?.extendInfo,
      SUFeedURL: appcastUrl, SUPublicEDKey: publicEdKey, SUEnableAutomaticChecks: false,
      SUAutomaticallyUpdate: false, SUSendProfileInfo: false, SUEnableInstallerLauncherService: false,
      SUVerifyUpdateBeforeExtraction: true, SUDeltaChainHistory: 0,
    } };
    config.extraFiles = [...(config.extraFiles || []), { from: 'node_modules/electron-sparkle-updater/native/vendor/Sparkle.framework', to: 'Frameworks/Sparkle.framework' }];
    config.extraResources = [...(config.extraResources || []), { from: 'node_modules/electron-sparkle-updater/native/build/Release/sparkle_bridge.node', to: 'app.asar.unpacked/node_modules/electron-sparkle-updater/native/build/Release/sparkle_bridge.node' }];
    config.afterPack = 'scripts/sparkle-after-pack.cjs';
    config.dmg = { ...config.dmg, writeUpdateInfo: false };
  }
  return config;
}
