// Bundled separately for the packaged shell; development never starts the updater.
module.exports = ({ metadata } = {}) => {
  if (process.platform !== 'darwin') return require('electron-updater').autoUpdater;
  const path = require('node:path');
  const addon = path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/electron-sparkle-updater/native/build/Release/sparkle_bridge.node');
  const bridge = require(addon);
  return require('./sparkle-updater.mjs').createSparkleUpdater(bridge, metadata.frokSparkle);
};
