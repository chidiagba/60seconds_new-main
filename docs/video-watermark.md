# Video watermark exports

Native video shares (WhatsApp, Instagram, TikTok, Facebook, X and the system sheet) and **Save video** use `VideoWatermarkService.prepareExport`. The original source is never handed to these destinations if watermarking fails. Link/page sharing remains a link.

The existing `assets/images/second.png` logo is drawn beside white **60Seconds** branding and the creator's **@username** into a transparent PNG using UIKit on iOS and Canvas on Android. The whole graphic is burned into every frame at 72% opacity. It moves clockwise between corners every four seconds, with a smooth half-second transition. Sizing uses the shorter video dimension, with a minimum readable width for small videos. The in-app preview follows playback time, including seeking and looping; it is independent of the permanent export.

- iOS: Core Image / AVFoundation, transformed source dimensions and source frame cadence. Exports reject missing video/audio tracks and changed dimensions.
- Android: Media3 Transformer with a time-dependent bitmap overlay. Encoder resolution fallback is disabled; no crop, resize or audio effects are applied. Requested video bitrate is at least the source bitrate.
- FFmpeg fallback: the same branded PNG and timeline; H.264 CRF 18, original frame dimensions and copied audio. An unavailable encoder produces an error, never an original-file fallback.

Burning changes pixels and requires video encoding; it cannot be bit-for-bit identical to the original video. Destination apps can apply their own compression after receiving the file. Source resolution/aspect ratio and audio are retained by the export paths; physical-device and destination-app verification is still required before release.

`branded_v2` export caches include the source identity and creator handle. Legacy final-second/logo-only caches are not reused. Missing creator usernames and app binaries lacking the new native API fail explicitly. Background uploaded derivatives use `wm_branded_v2_` filenames; the original upload remains available for future branded exports.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint`.
- Android: `cd android && ./gradlew :native-video-watermark:compileDebugKotlin`.
- iOS: build the `60Seconds` workspace/scheme with the updated native module. A JavaScript-only update cannot install these native changes.
- Export a branded PNG from `createWatermarkImage`, then run `node scripts/verify-watermark-export.cjs /path/to/brand.png /tmp/watermark-check`. This checks actual FFmpeg output for visible pixels in all four corners, portrait/landscape/square/short clips, original dimensions/frame rate, and identical AAC audio packets.
- On both platforms, save a video and share it to WhatsApp, Instagram and TikTok. Play the resulting attachment outside 60Seconds. Check the first frame, each corner transition and the last frame; verify the correct handle, sound, orientation, dimensions and full duration. Include a rotated camera clip, a silent clip, a short clip, and a high-resolution clip. Cancel/deny Photos permission and force an export error to confirm that no raw source is saved or shared.

## Local validation completed

- **156 automated tests passed**, TypeScript passed, lint passed, and the changed files pass `git diff --check`.
- The final Android native module compiles successfully against the installed SDK and Media3 dependencies. Android runtime export and real destination-app tests were not run.
- The production iOS Swift source compiled and ran in the iOS 18.6 simulator using a minimal Expo bridge test shim. Its actual UIKit image creation and AVFoundation video export produced portrait, 90-degree camera-rotation, and half-second outputs. Decoded frames show the watermark in the expected corners; display dimensions, frame rate, full duration and audible audio were checked. The full application Xcode build was stopped during its lengthy dependency rebuild; a complete app build is still required for release.
- Actual FFmpeg exports using the PNG produced by the iOS renderer passed portrait/landscape/square/short-clip checks, including all corner positions, original background pixels, dimensions, frame rate, duration and identical AAC packets.

Artifacts are in ignored `local-private/watermark-validation/`. `ios-native-portrait.mp4`, `ios-native-camera-rotated.mp4` and `ios-native-short.mp4` are native simulator exports; `*-watermarked.mp4` files exercise the FFmpeg path. None were posted to external services. Physical-device exports, real WhatsApp/Instagram/TikTok handoff, and native app release remain to be verified.
