// Bundled separately for the packaged shell; development never starts the updater.
module.exports = () => require('electron-updater').autoUpdater;
