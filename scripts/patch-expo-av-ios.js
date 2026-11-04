const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', 'expo-av', 'ios', 'EXAV', 'EXAVPlayerData.m');
if (!fs.existsSync(file)) {
  console.log('[patch-expo-av-ios] expo-av not installed; skipping');
  process.exit(0);
}
const original = fs.readFileSync(file, 'utf8');
// AVAsset's asynchronous KVC key is "playable"; isPlayable is its getter.
// Recent iOS versions explicitly reject loading the getter name as a key.
const patched = original.replaceAll('@"isPlayable"', '@"playable"');
if (patched !== original) {
  fs.writeFileSync(file, patched);
  console.log('[patch-expo-av-ios] corrected AVAsset playable loading key');
}
