const fs = require('fs');
const path = require('path');

const gradlePath = path.join(__dirname, '../node_modules/ffmpeg-kit-react-native/android/build.gradle');
const original = fs.readFileSync(gradlePath, 'utf8');
const dependency = "implementation 'io.github.jamaismagic.ffmpeg:ffmpeg-kit-main-tls-16kb:6.1.4'";
const bundledLibraries = "implementation fileTree(include: ['*.jar', '*.aar'], dir: 'libs')";

if (original.includes(dependency)) {
  console.log('[patch-ffmpeg-android] already patched');
} else {
  if (!original.includes(bundledLibraries)) {
    throw new Error('FFmpeg Android dependency changed; review 16 KB compatibility before building.');
  }
  // The bundled 6.0-2 AAR has 4 KB ELF segments. Replace it and its local
  // support JARs with the compatible Maven dependency and its transitive JARs.
  fs.writeFileSync(gradlePath, original.replace(bundledLibraries, dependency));
  console.log('[patch-ffmpeg-android] using 16 KB compatible native libraries');
}
