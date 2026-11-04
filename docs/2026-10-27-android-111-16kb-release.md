# Android 111.0.0 (111): 16 KB page-size fix

The signed APK and AAB are available in `build/releases/` as
`60seconds-111.0.0-111-release.apk` and `60seconds-111.0.0-111-release.aab`.
Use the AAB for Google Play upload.

Build 110 bundled an old FFmpeg HTTPS AAR with 4 KB ELF LOAD alignment in
nine libraries on each 64-bit architecture: avcodec, avdevice, avfilter,
avformat, avutil, ffmpegkit, ffmpegkit_abidetect, swresample and swscale.
Its APK ZIP alignment already passed; the native binaries needed replacement.

The Android wrapper now uses the pinned Maven dependency
`io.github.jamaismagic.ffmpeg:ffmpeg-kit-main-tls-16kb:6.1.4` in place of the
bundled AAR/JAR collection. `scripts/patch-ffmpeg-android.js` applies this change
during npm postinstall. HTTPS, video editing/compression and all four existing
architectures are retained. The downloaded AAR matches Maven Central SHA-1
`f71fd9febab342f4c4475234aa7349e1fb61a5d6`.

Android version code/name are now **111 / 111.0.0** in app.json and native
Gradle configuration; Expo's app version is also 111.0.0. Native iOS build 110
and the uploaded iOS archive were not rebuilt as part of this Android release.

Validation completed:

- Gradle `:app:assembleRelease :app:bundleRelease`: successful, including release lint.
- 80 existing JavaScript regression tests passed.
- Both artifacts: all 74 ARM64/x86-64 native libraries pass ELF LOAD alignment
  and the check for RELRO protection overlapping writable data on 16 KB pages.
- APK: Android SDK `zipalign -v -c -P 16 4` passed.
- AAB: bundle configuration requests `PAGE_ALIGNMENT_16K`.
- APK and AAB manifests confirm package `app.sixtyseconds.nightlife`, code 111,
  name 111.0.0; arm64-v8a, armeabi-v7a, x86 and x86_64 are included.
- APK v2 signature and AAB JAR signature verified. Both use the existing
  production certificate SHA-256
  `2d1b0b44a262d366bac914f71acc658ddadf4f86a9e3db92e18a8a0003c4bc21`.

Per-artifact audit JSON, signing output, bundle configuration, SHA-256 checksums
and release metadata are saved alongside the release files. Repeat the native
audit with `python3 scripts/check-android-page-alignment.py <apk-or-aab>`.

A 16 KB device runtime test was not performed; no Android device was connected
during validation. Google Play upload and server-side acceptance remain to be
confirmed after uploading the new AAB.

References: [Android 16 KB requirements](https://developer.android.com/guide/practices/page-sizes),
[FFmpeg TLS variant](https://github.com/JamaisMagic/ffmpeg-kit-16KB).
