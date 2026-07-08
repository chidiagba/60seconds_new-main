const fs = require('fs');
const path = require('path');

const podspecPath = path.join(
  process.cwd(),
  'node_modules',
  'ffmpeg-kit-react-native',
  'ffmpeg-kit-react-native.podspec'
);

if (!fs.existsSync(podspecPath)) {
  console.log('[patch-ffmpeg-podspec] podspec not found, skipping');
  process.exit(0);
}

const original = fs.readFileSync(podspecPath, 'utf8');
let updated = original;
let changed = false;

const prepareCommandPattern = /\n\s*s\.prepare_command\s*=\s*<<-CMD[\s\S]*?^\s*CMD\s*\n/m;
if (prepareCommandPattern.test(updated)) {
  updated = updated.replace(prepareCommandPattern, '\n');
  changed = true;
}

// Keep upstream iOS dependency declarations intact.
// Commenting these out breaks FFmpeg header availability during iOS compilation.
if (updated.includes("#ss.dependency 'ffmpeg-kit-ios-https', \"6.0\"")) {
  updated = updated.replace(
    "#ss.dependency 'ffmpeg-kit-ios-https', \"6.0\"",
    "ss.dependency 'shaquillehinds-ffmpeg-kit-ios', \"6.0.2\""
  );
  changed = true;
}

if (updated.includes("ss.dependency 'ffmpeg-kit-ios-https', \"6.0\"")) {
  updated = updated.replace(
    "ss.dependency 'ffmpeg-kit-ios-https', \"6.0\"",
    "ss.dependency 'shaquillehinds-ffmpeg-kit-ios', \"6.0.2\""
  );
  changed = true;
}

if (updated.includes('ss.vendored_frameworks = "ffmpeg-kit/prebuilt/bundle-apple-xcframework-ios/*.{xcframework}"')) {
  updated = updated.replace(
    'ss.vendored_frameworks = "ffmpeg-kit/prebuilt/bundle-apple-xcframework-ios/*.{xcframework}"',
    '#ss.vendored_frameworks = "ffmpeg-kit/prebuilt/bundle-apple-xcframework-ios/*.{xcframework}"'
  );
  changed = true;
}

if (updated.includes('ss.vendored_frameworks = "ffmpreg-kit/prebuilt/bundle-apple-xcframework-ios/*.{xcframework}"')) {
  updated = updated.replace(
    'ss.vendored_frameworks = "ffmpreg-kit/prebuilt/bundle-apple-xcframework-ios/*.{xcframework}"',
    '#ss.vendored_frameworks = "ffmpreg-kit/prebuilt/bundle-apple-xcframework-ios/*.{xcframework}"'
  );
  changed = true;
}

if (!changed) {
  console.log('[patch-ffmpeg-podspec] already patched');
  process.exit(0);
}

fs.writeFileSync(podspecPath, updated, 'utf8');
console.log('[patch-ffmpeg-podspec] patched ffmpeg podspec to use shaquillehinds prebuilt iOS dependency and skip local source builds');
