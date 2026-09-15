import { product } from '../desktop/product.mjs';
import { signingConfiguration } from './desktop-signing.mjs';

export function releaseConfiguration(base, env = process.env, platform = process.platform) {
  const config = signingConfiguration(base, env, platform);
  const repository = env.GITHUB_REPOSITORY || new URL(product.githubUrl).pathname.slice(1);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('Use a GitHub owner/repository for desktop releases.');
  const [owner, repo] = repository.split('/');
  config.publish = [{ provider: 'github', owner, repo, releaseType: 'release' }];
  config.electronUpdaterCompatibility = '>=2.16';
  // Unsigned macOS builds cannot receive verified Squirrel updates.
  config.extraMetadata = { ...config.extraMetadata, frokUpdates: platform !== 'darwin' || env.FROK_SIGN_RELEASE === '1' };
  return config;
}
