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

// react-async-hook 3.6.1 advertises an ESM entry at the package root,
// although the published file is in dist/. Resolve the existing file on web.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // The location screen already renders its browser fallback.
  if (platform === 'web' && moduleName === 'react-native-maps') return { type: 'empty' };
  if (platform === 'web' && moduleName === '@stripe/stripe-react-native') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'lib/stripe-native.web.tsx') };
  }
  if (moduleName === 'react-async-hook') {
    return context.resolveRequest(context, require.resolve('react-async-hook'), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
