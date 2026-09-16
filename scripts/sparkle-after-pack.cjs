module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  // Free ad-hoc signing seals the final bundle. The Ed25519 archive signature
  // authenticates releases; this is not an Apple Developer ID signature.
  if (process.env.FROK_SIGN_RELEASE !== '1') {
    const { adHocSignAfterPack } = await import('electron-sparkle-updater/builder');
    await adHocSignAfterPack(context);
  }
};
