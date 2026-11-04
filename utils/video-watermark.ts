import { NativeModules, Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import NativeVideoWatermark from 'native-video-watermark';

let FFmpegKit: any = null;
let ReturnCode: any = null;
let FFprobeKit: any = null;
let ffmpegLoadAttempted = false;

function loadFFmpeg(): boolean {
  if (FFmpegKit && ReturnCode) return true;
  if (ffmpegLoadAttempted) return false;
  ffmpegLoadAttempted = true;

  const nativeModule = NativeModules.FFmpegKitReactNativeModule as
    | Record<string, unknown>
    | undefined;
  if (!nativeModule || typeof nativeModule.ffmpegSession !== 'function') return false;

  try {
    const module = require('ffmpeg-kit-react-native');
    FFmpegKit = module?.FFmpegKit;
    ReturnCode = module?.ReturnCode;
    FFprobeKit = module?.FFprobeKit;
    return !!FFmpegKit && !!ReturnCode;
  } catch (error) {
    console.warn('[Watermark] FFmpeg fallback is unavailable in this build:', error);
    return false;
  }
}

let localWatermark: number | null = null;
try {
  localWatermark = require('../assets/images/second.png');
} catch (error) {
  console.error('[Watermark] Failed to load app icon asset:', error);
}

export interface WatermarkOptions {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number;
  scale?: number;
  /** Retained for call-site compatibility; native processing does not upload the source. */
  sourceUrl?: string;
  strict?: boolean;
  /** If true, return the original URI when native processing is unavailable. */
  allowFallback?: boolean;
}

export type WatermarkResult = {
  uri: string;
  applied: true;
  outputType: 'mp4' | 'mov';
  mimeType: 'video/mp4' | 'video/quicktime';
  source: 'native' | 'ffmpeg';
};

export class VideoWatermarkError extends Error {
  constructor(public readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VideoWatermarkError';
  }
}

export class VideoWatermarkService {
  private static instance: VideoWatermarkService;
  private watermarkUri: string | null = null;
  private backgroundWatermarkJobs = new Map<string, Promise<string>>();

  static getInstance(): VideoWatermarkService {
    if (!VideoWatermarkService.instance) {
      VideoWatermarkService.instance = new VideoWatermarkService();
    }
    return VideoWatermarkService.instance;
  }

  private sanitizeCacheKey(cacheKey: string): string {
    return cacheKey.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }

  private getCachedWatermarkUri(cacheKey: string, outputType: 'mp4' | 'mov' = 'mp4'): string {
    return `${FileSystem.cacheDirectory}wm_cached_${this.sanitizeCacheKey(cacheKey)}.${outputType}`;
  }

  private async ensureLocalFile(inputUri: string, filePrefix: string): Promise<string> {
    if (inputUri.startsWith('file://')) {
      const info = await FileSystem.getInfoAsync(inputUri);
      if (!info.exists || (typeof info.size === 'number' && info.size === 0)) {
        throw new Error('Source video file is missing or empty');
      }
      return inputUri;
    }

    const outputUri = `${FileSystem.cacheDirectory}${filePrefix}_${Date.now()}.mp4`;
    if (
      inputUri.startsWith('content://') ||
      inputUri.startsWith('ph://') ||
      inputUri.startsWith('assets-library://')
    ) {
      await FileSystem.copyAsync({ from: inputUri, to: outputUri });
      return outputUri;
    }

    const result = await FileSystem.downloadAsync(inputUri, outputUri);
    if (result.status !== 200) {
      throw new Error(`Failed to download source video (${result.status})`);
    }
    return result.uri;
  }

  private overlayExpression(position: NonNullable<WatermarkOptions['position']>): string {
    switch (position) {
      case 'top-left': return '20:20';
      case 'top-right': return 'main_w-overlay_w-20:20';
      case 'bottom-left': return '20:main_h-overlay_h-20';
      case 'center': return '(main_w-overlay_w)/2:(main_h-overlay_h)/2';
      default: return 'main_w-overlay_w-20:main_h-overlay_h-20';
    }
  }

  private async isValidOutput(uri: string): Promise<boolean> {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      return info.exists && (typeof info.size !== 'number' || info.size > 1024);
    } catch {
      return false;
    }
  }

  private filePath(uri: string): string {
    const rawPath = uri.replace(/^file:\/\//, '');
    try {
      return decodeURIComponent(rawPath);
    } catch {
      return rawPath;
    }
  }

  private async addWatermarkWithFFmpeg(
    localVideoUri: string,
    options: Required<Pick<WatermarkOptions, 'position' | 'opacity' | 'scale'>>
  ): Promise<string | null> {
    if (!loadFFmpeg() || !this.watermarkUri) return null;

    const localLogoUri = await this.ensureLocalFile(this.watermarkUri, 'wm_logo');
    const inputPath = this.filePath(localVideoUri);
    const logoPath = this.filePath(localLogoUri);
    const probe = await FFprobeKit.getMediaInformation(inputPath);
    const duration = Number(probe.getMediaInformation()?.getDuration());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video duration');
    const logoStart = Math.max(0, duration - 1);
    const logoWidth = Math.max(80, Math.min(320, Math.round(1080 * options.scale)));
    const filter = [
      `[1:v]scale=${logoWidth}:-2,format=rgba,colorchannelmixer=aa=${options.opacity}[wm]`,
      `[0:v:0][wm]overlay=${this.overlayExpression(options.position)}:format=auto:enable='gte(t,${logoStart})'[v]`,
    ].join(';');

    // Device FFmpeg builds expose different encoders. Try the preferred H.264
    // encoders first, then MPEG-4 as the broadly available final fallback.
    const encoders: Array<{ name: string; args: string[] }> = [
      { name: 'libx264', args: ['-preset', 'veryfast', '-crf', '23'] },
      { name: 'h264', args: ['-crf', '23'] },
      { name: 'mpeg4', args: ['-q:v', '4'] },
    ];
    let lastLogs = '';

    for (const encoder of encoders) {
      const outputUri = `${FileSystem.cacheDirectory}wm_ffmpeg_${Date.now()}_${encoder.name}.mp4`;
      const outputPath = this.filePath(outputUri);
      await FileSystem.deleteAsync(outputUri, { idempotent: true }).catch(() => {});

      const session = await FFmpegKit.executeWithArguments([
        '-y', '-i', inputPath, '-i', logoPath,
        '-filter_complex', filter,
        '-map', '[v]', '-map', '0:a:0?',
        '-c:v', encoder.name, ...encoder.args,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath,
      ]);
      const code = await session.getReturnCode();
      if (ReturnCode.isSuccess(code) && await this.isValidOutput(outputUri)) {
        return outputUri;
      }
      lastLogs = (await session.getAllLogsAsString()) || '';
      await FileSystem.deleteAsync(outputUri, { idempotent: true }).catch(() => {});
    }

    console.warn('[Watermark] FFmpeg fallback failed:', lastLogs.slice(-1000));
    return null;
  }

  async initializeWatermark(): Promise<void> {
    if (!localWatermark) throw new Error('Watermark app icon asset was not found');
    const asset = Asset.fromModule(localWatermark);
    await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    if (!uri) throw new Error('Watermark app icon could not be materialized locally');
    this.watermarkUri = uri;
  }

  async preloadWatermark(): Promise<void> {
    if (!this.watermarkUri) await this.initializeWatermark();
  }

  getWatermarkUri(): string | null {
    return this.watermarkUri;
  }

  async getCachedWatermarkedVideo(cacheKey: string): Promise<string | null> {
    for (const outputType of ['mp4', 'mov'] as const) {
      const targetUri = this.getCachedWatermarkUri(cacheKey, outputType);
      try {
        const info = await FileSystem.getInfoAsync(targetUri);
        if (info.exists && (typeof info.size !== 'number' || info.size > 1024)) {
          return targetUri;
        }
        await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {});
      } catch {
        // Try the other supported container.
      }
    }
    return null;
  }

  async cacheWatermarkedVideo(cacheKey: string, sourceUri: string, outputType?: 'mp4' | 'mov'): Promise<string> {
    const resolvedType = outputType ?? (sourceUri.split('?')[0].toLowerCase().endsWith('.mov') ? 'mov' : 'mp4');
    const targetUri = this.getCachedWatermarkUri(cacheKey, resolvedType);
    if (sourceUri === targetUri) return targetUri;
    await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {});
    await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
    return targetUri;
  }

  async startBackgroundWatermark(
    videoUri: string,
    cacheKey: string,
    options: WatermarkOptions = {}
  ): Promise<void> {
    if (Platform.OS === 'web' || !videoUri) return;
    if (await this.getCachedWatermarkedVideo(cacheKey)) return;
    if (this.backgroundWatermarkJobs.has(cacheKey)) return;

    const job = this.addWatermarkToVideo(videoUri, {
      ...options,
      strict: false,
      allowFallback: true,
    })
      .then(async result => {
        return this.cacheWatermarkedVideo(cacheKey, result.uri, result.outputType);
      })
      .catch(error => {
        console.warn('[Watermark] Background native watermark failed:', error);
        return videoUri;
      })
      .finally(() => {
        this.backgroundWatermarkJobs.delete(cacheKey);
      });

    this.backgroundWatermarkJobs.set(cacheKey, job);
    void job;
  }

  async addWatermarkToVideo(videoUri: string, options: WatermarkOptions = {}): Promise<WatermarkResult> {
    if (Platform.OS === 'web') {
      throw new VideoWatermarkError('NATIVE_WATERMARK_MODULE_UNAVAILABLE', 'Native watermarking is unavailable on web');
    }

    const strict = options.strict ?? false;
    const allowFallback = options.allowFallback ?? false;
    try {
      await this.preloadWatermark();
      if (!this.watermarkUri) throw new Error('Watermark app icon is unavailable');

      const localVideoUri = await this.ensureLocalFile(videoUri, 'wm_native_source');
      const normalizedOptions: Required<Pick<WatermarkOptions, 'position' | 'opacity' | 'scale'>> = {
        position: options.position ?? 'bottom-right',
        opacity: Math.max(0.15, Math.min(1, options.opacity ?? 0.8)),
        scale: Math.max(0.04, Math.min(0.12, options.scale ?? 0.1)),
      };

      try {
        if (!NativeVideoWatermark) {
          throw new VideoWatermarkError(
            'NATIVE_WATERMARK_MODULE_UNAVAILABLE',
            'The native watermark module is not included in this app binary'
          );
        }
        const result = await NativeVideoWatermark.addWatermark(
          localVideoUri,
          this.watermarkUri,
          normalizedOptions.position,
          normalizedOptions.opacity,
          normalizedOptions.scale
        );
        if (result && result !== localVideoUri && await this.isValidOutput(result)) {
          console.log(`[Watermark] Applied locally with ${Platform.OS === 'ios' ? 'AVFoundation' : 'Media3 Transformer'}`);
          const outputType = result.split('?')[0].toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
          return { uri: result, applied: true, outputType, mimeType: outputType === 'mov' ? 'video/quicktime' : 'video/mp4', source: 'native' };
        }
        throw new Error('Native watermark export did not produce a valid video');
      } catch (nativeError) {
        console.warn('[Watermark] Primary native exporter failed; trying FFmpeg:', nativeError);
      }

      const ffmpegResult = await this.addWatermarkWithFFmpeg(localVideoUri, normalizedOptions);
      if (ffmpegResult) {
        console.log('[Watermark] Applied locally with FFmpeg fallback');
        return { uri: ffmpegResult, applied: true, outputType: 'mp4', mimeType: 'video/mp4', source: 'ffmpeg' };
      }
      throw new Error('Both native and FFmpeg watermark exporters failed');
    } catch (error) {
      console.error('[Watermark] Native watermark failed:', error);
      const wrapped = error instanceof VideoWatermarkError
        ? error
        : new VideoWatermarkError('WATERMARK_EXPORT_FAILED', `Watermark failed on ${Platform.OS}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      // Kept only for source compatibility. A failed export is never represented as
      // a successful result containing the original URI.
      if (!strict && allowFallback) throw wrapped;
      throw wrapped;
    }
  }
}

export const videoWatermarkService = VideoWatermarkService.getInstance();
