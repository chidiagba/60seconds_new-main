// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Keep the local Expo module resolvable even before npm/yarn has created its
// node_modules symlink. Expo Router evaluates every route while bundling, so a
// missing link here prevents both Android and iOS from getting past launch.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'native-video-watermark': path.resolve(__dirname, 'modules/native-video-watermark'),
};

module.exports = config;
