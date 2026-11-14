import { WATERMARK_VERSION, WATERMARK_OPACITY, WATERMARK_SCALE, watermarkUsername, watermarkFFmpegFilter, watermarkWidth } from './watermark-layout';
import { logger } from '@/lib/logger';
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
    logger.warn('[Watermark] FFmpeg fallback is unavailable in this build:', error);
    return false;
  }
}

let localWatermark: number | null = null;
try {
  localWatermark = require('../assets/images/second.png');
} catch (error) {
  logger.error('[Watermark] Failed to load app icon asset:', error);
}

export interface WatermarkOptions {
  username?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number;
  scale?: number;
  /** Retained for call-site compatibility; native processing does not upload the source. */
  sourceUrl?: string;
  strict?: boolean;
  /** Legacy option; exports always fail rather than returning an unwatermarked source. */
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
    return `${FileSystem.cacheDirectory}wm_${WATERMARK_VERSION}_cached_${this.sanitizeCacheKey(cacheKey)}.${outputType}`;
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
    options: Required<Pick<WatermarkOptions, 'position' | 'opacity' | 'scale'>>,
    brandedImageUri: string
  ): Promise<string | null> {
    if (!loadFFmpeg() || !this.watermarkUri) return null;

    const localLogoUri = brandedImageUri;
    const inputPath = this.filePath(localVideoUri);
    const logoPath = this.filePath(localLogoUri);
    const probe = await FFprobeKit.getMediaInformation(inputPath);
    const duration = Number(probe.getMediaInformation()?.getDuration());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video duration');
    const streams = probe.getMediaInformation()?.getStreams() || [];
    const videoStream = streams.find((stream: any) => stream.getType() === 'video');
    const shortSide = Math.min(Number(videoStream?.getWidth()), Number(videoStream?.getHeight()));
    if (!Number.isFinite(shortSide) || shortSide <= 0) throw new Error('Invalid source dimensions');
    const filter = watermarkFFmpegFilter(watermarkWidth(shortSide, options.scale), options.opacity);
    const encoders = [{ name: 'libx264', args: ['-preset', 'slow', '-crf', '18'] }];
    let lastLogs = '';

    for (const encoder of encoders) {
      const outputUri = `${FileSystem.cacheDirectory}wm_ffmpeg_${Date.now()}_${encoder.name}.mp4`;
      const outputPath = this.filePath(outputUri);
      await FileSystem.deleteAsync(outputUri, { idempotent: true }).catch(() => {});

      const session = await FFmpegKit.executeWithArguments([
        '-y', '-i', inputPath, '-i', logoPath,
        '-filter_complex', filter,
        '-map', '[v]', '-map', '0:a?',
        '-c:v', encoder.name, ...encoder.args,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
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

    logger.warn('[Watermark] FFmpeg fallback failed:', lastLogs.slice(-1000));
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
    const targetUri = this.getCachedWatermarkUri(cacheKey, 'mp4');
    try {
      const info = await FileSystem.getInfoAsync(targetUri);
      if (info.exists && (typeof info.size !== 'number' || info.size > 1024)) return targetUri;
      await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {});
    } catch {
      // The export will be regenerated if the MP4 cache cannot be read.
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

  private exportJobs = new Map<string, Promise<WatermarkResult>>();

  async prepareExport(videoUri: string, username: string, videoId: string): Promise<WatermarkResult> {
    const handle = watermarkUsername(username);
    const identity = `${WATERMARK_VERSION}|${videoId}|${videoUri}|${handle}`;
    // Two independent hashes keep long signed URLs out of filenames.
    let a = 2166136261, b = 5381;
    for (const char of identity) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0); }
    const key = `${(a >>> 0).toString(16)}_${(b >>> 0).toString(16)}`;
    const existing = this.exportJobs.get(key);
    if (existing) return existing;
    const job = (async (): Promise<WatermarkResult> => {
      const cached = await this.getCachedWatermarkedVideo(key);
      if (cached) {
        const outputType = cached.endsWith('.mov') ? 'mov' : 'mp4';
        return { uri: cached, applied: true, outputType, mimeType: outputType === 'mov' ? 'video/quicktime' : 'video/mp4', source: 'native' };
      }
      const result = await this.addWatermarkToVideo(videoUri, { username: handle, strict: true, allowFallback: false });
      try {
        const uri = await this.cacheWatermarkedVideo(key, result.uri, result.outputType);
        return { ...result, uri };
      } finally {
        if (result.uri !== videoUri) {
          await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
        }
      }
    })().finally(() => this.exportJobs.delete(key));
    this.exportJobs.set(key, job);
    return job;
  }

  async addWatermarkToVideo(videoUri: string, options: WatermarkOptions = {}): Promise<WatermarkResult> {
    if (Platform.OS === 'web') {
      throw new VideoWatermarkError('NATIVE_WATERMARK_MODULE_UNAVAILABLE', 'Native watermarking is unavailable on web');
    }

    let brandedImageUri: string | null = null;
    let localVideoUri: string | null = null;
    try {
      await this.preloadWatermark();
      if (!this.watermarkUri) throw new Error('Watermark app icon is unavailable');

      const username = watermarkUsername(options.username || '');
      if (!NativeVideoWatermark?.createWatermarkImage || !NativeVideoWatermark?.exportBrandedVideo) {
        throw new Error('This app binary must be updated to support branded video exports');
      }
      brandedImageUri = await NativeVideoWatermark.createWatermarkImage(this.watermarkUri, username);
      if (!await this.isValidOutput(brandedImageUri)) throw new Error('Branded watermark image could not be created');
      localVideoUri = await this.ensureLocalFile(videoUri, 'wm_native_source');
      const normalizedOptions: Required<Pick<WatermarkOptions, 'position' | 'opacity' | 'scale'>> = {
        position: options.position ?? 'bottom-right',
        opacity: Math.max(0.5, Math.min(1, options.opacity ?? WATERMARK_OPACITY)),
        scale: Math.max(0.18, Math.min(0.36, options.scale ?? WATERMARK_SCALE)),
      };

      let nativeExportError: unknown;
      try {
        if (!NativeVideoWatermark) {
          throw new VideoWatermarkError(
            'NATIVE_WATERMARK_MODULE_UNAVAILABLE',
            'The native watermark module is not included in this app binary'
          );
        }
        const result = await NativeVideoWatermark.exportBrandedVideo(
          localVideoUri,
          brandedImageUri,
          normalizedOptions.position,
          normalizedOptions.opacity,
          normalizedOptions.scale
        );
        const resultExtension = result?.split('?')[0].toLowerCase().split('.').pop();
        if (result && result !== localVideoUri && resultExtension === 'mp4' && await this.isValidOutput(result)) {
          logger.debug(`[Watermark] Applied locally with ${Platform.OS === 'ios' ? 'AVFoundation' : 'Media3 Transformer'}`);
          return { uri: result, applied: true, outputType: 'mp4', mimeType: 'video/mp4', source: 'native' };
        }
        if (result && result !== localVideoUri) {
          await FileSystem.deleteAsync(result, { idempotent: true }).catch(() => {});
        }
        throw new Error('Native watermark export did not produce a valid video');
      } catch (nativeError) {
        nativeExportError = nativeError;
        logger.warn('[Watermark] Primary native exporter failed; trying FFmpeg:', nativeError);
      }

      const ffmpegResult = await this.addWatermarkWithFFmpeg(localVideoUri, normalizedOptions, brandedImageUri);
      if (ffmpegResult) {
        logger.debug('[Watermark] Applied locally with FFmpeg fallback');
        return { uri: ffmpegResult, applied: true, outputType: 'mp4', mimeType: 'video/mp4', source: 'ffmpeg' };
      }
      const nativeReason = nativeExportError instanceof Error ? nativeExportError.message : String(nativeExportError || 'unknown native export error');
      throw new Error(`${Platform.OS} video export failed (${nativeReason}); the MP4 fallback exporter is unavailable or failed`);
    } catch (error) {
      logger.error('[Watermark] Native watermark failed:', error);
      const wrapped = error instanceof VideoWatermarkError
        ? error
        : new VideoWatermarkError('WATERMARK_EXPORT_FAILED', `Watermark failed on ${Platform.OS}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      // Kept only for source compatibility. A failed export is never represented as
      // a successful result containing the original URI.
      throw wrapped;
    } finally {
      if (brandedImageUri) await FileSystem.deleteAsync(brandedImageUri, { idempotent: true }).catch(() => {});
      if (localVideoUri && localVideoUri !== videoUri) {
        await FileSystem.deleteAsync(localVideoUri, { idempotent: true }).catch(() => {});
      }
    }
  }
}

export const videoWatermarkService = VideoWatermarkService.getInstance();
