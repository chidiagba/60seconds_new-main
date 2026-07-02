import { NativeModules, Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

let FFmpegKit: any = null;
let ReturnCode: any = null;
let ffmpegModuleLoadAttempted = false;

function hasNativeFFmpegModule() {
  return !!NativeModules.FFmpegKitReactNativeModule;
}

function assignFFmpegPackage(m: any) {
  if (!m?.FFmpegKit || !m?.ReturnCode) {
    return false;
  }

  FFmpegKit = m.FFmpegKit;
  ReturnCode = m.ReturnCode;
  return true;
}

function ensureFFmpegModuleLoaded() {
  if (ffmpegModuleLoadAttempted && FFmpegKit && ReturnCode && hasNativeFFmpegModule()) {
    return true;
  }

  ffmpegModuleLoadAttempted = true;
  FFmpegKit = null;
  ReturnCode = null;

  if (!hasNativeFFmpegModule()) {
    console.warn(
      '[Watermark] FFmpeg native module is not linked in this app binary. Rebuild the native app after installing @fathah_cr/react-native-ffmpeg-kit.'
    );
    return false;
  }

  try {
    const m = require('@fathah_cr/react-native-ffmpeg-kit');
    if (assignFFmpegPackage(m)) {
      return true;
    }
  } catch (error) {
    console.warn('[Watermark] Failed to load @fathah_cr/react-native-ffmpeg-kit:', error);
    // Fall through to alternate package name.
  }

  try {
    const m = require('ffmpeg-kit-react-native');
    if (assignFFmpegPackage(m)) {
      return true;
    }
  } catch (error) {
    console.warn('[Watermark] Failed to load ffmpeg-kit-react-native:', error);
    // Native ffmpeg is not linked in this build.
  }

  FFmpegKit = null;
  ReturnCode = null;
  return false;
}

// Bundled logo used as the watermark overlay
let localWatermark: any = null;
try {
  localWatermark = require('../assets/images/second.png');
  console.log('[Watermark] Loaded logo asset');
} catch (e) {
  console.error('[Watermark] Failed to load logo asset:', e);
}

export interface WatermarkOptions {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number;
  scale?: number;
  sourceUrl?: string;
  strict?: boolean;
  /** If true, still return video URI on failure instead of throwing */
  allowFallback?: boolean;
}

export class VideoWatermarkService {
  private static instance: VideoWatermarkService;
  private watermarkUri: string | null = null;
  private backgroundWatermarkJobs = new Map<string, Promise<string>>();

  private resolveFileExtension(inputUri: string, fallback: string): string {
    const normalizedFallback = fallback.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const lowerUri = inputUri.toLowerCase();

    if (lowerUri.startsWith('data:image/')) {
      const mimeExt = lowerUri.split(';')[0].split('/')[1];
      return (mimeExt || normalizedFallback).replace(/[^a-z0-9]/gi, '').toLowerCase();
    }

    const candidates: string[] = [inputUri];

    try {
      const parsed = new URL(inputUri);
      candidates.push(parsed.pathname);
      const queryCandidates = [
        parsed.searchParams.get('unstable_path'),
        parsed.searchParams.get('filename'),
        parsed.searchParams.get('file'),
        parsed.searchParams.get('name'),
      ];
      for (const queryValue of queryCandidates) {
        if (queryValue) {
          candidates.push(queryValue);
        }
      }
    } catch {
      // Not a standard URL; keep raw input candidate only.
    }

    for (const candidate of candidates) {
      const withoutQuery = candidate.split('?')[0].split('#')[0];
      const match = withoutQuery.match(/\.([a-z0-9]{2,5})$/i);
      if (!match) {
        continue;
      }

      const ext = match[1].toLowerCase();
      if (ext) {
        return ext;
      }
    }

    return normalizedFallback;
  }

  private async ensureLocalFile(inputUri: string, filePrefix: string): Promise<string> {
    if (inputUri.startsWith('file://')) {
      return inputUri;
    }

    const fallbackExtension = filePrefix.includes('logo') ? 'png' : 'mp4';
    const extension = this.resolveFileExtension(inputUri, fallbackExtension);
    const outputUri = `${FileSystem.cacheDirectory}${filePrefix}_${Date.now()}.${extension}`;

    if (
      inputUri.startsWith('content://') ||
      inputUri.startsWith('ph://') ||
      inputUri.startsWith('assets-library://')
    ) {
      await FileSystem.copyAsync({ from: inputUri, to: outputUri });
      return outputUri;
    }

    const { uri, status } = await FileSystem.downloadAsync(inputUri, outputUri);
    if (status !== 200) {
      throw new Error(`Failed to download remote file (${status})`);
    }
    return uri;
  }

  private sanitizeCacheKey(cacheKey: string): string {
    return cacheKey.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }

  private getCachedWatermarkUri(cacheKey: string): string {
    const safeKey = this.sanitizeCacheKey(cacheKey);
    return `${FileSystem.cacheDirectory}wm_cached_${safeKey}.mp4`;
  }

  async getCachedWatermarkedVideo(cacheKey: string): Promise<string | null> {
    const targetUri = this.getCachedWatermarkUri(cacheKey);
    try {
      const info = await FileSystem.getInfoAsync(targetUri);
      return info.exists ? targetUri : null;
    } catch {
      return null;
    }
  }

  async cacheWatermarkedVideo(cacheKey: string, sourceUri: string): Promise<string> {
    const targetUri = this.getCachedWatermarkUri(cacheKey);

    if (sourceUri === targetUri) {
      return targetUri;
    }

    try {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
    } catch {
      // Ignore replacement cleanup failures.
    }

    await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
    return targetUri;
  }

  async startBackgroundWatermark(
    videoUri: string,
    cacheKey: string,
    options: WatermarkOptions = {}
  ): Promise<void> {
    if (Platform.OS === 'web' || !videoUri) {
      return;
    }

    const cachedUri = await this.getCachedWatermarkedVideo(cacheKey);
    if (cachedUri) {
      return;
    }

    if (this.backgroundWatermarkJobs.has(cacheKey)) {
      return;
    }

    const job = (async () => {
      try {
        const resultUri = await this.addWatermarkToVideo(videoUri, {
          ...options,
          strict: false,
          allowFallback: true,
        });

        if (!resultUri || resultUri === videoUri) {
          return resultUri;
        }

        const targetUri = this.getCachedWatermarkUri(cacheKey);
        if (resultUri === targetUri) {
          return targetUri;
        }

        try {
          await FileSystem.deleteAsync(targetUri, { idempotent: true });
        } catch {
          // Ignore cache replacement cleanup failures.
        }

        await FileSystem.copyAsync({ from: resultUri, to: targetUri });
        return targetUri;
      } catch (error) {
        console.warn('[Watermark] Background watermark job failed:', error);
        return videoUri;
      } finally {
        this.backgroundWatermarkJobs.delete(cacheKey);
      }
    })();

    this.backgroundWatermarkJobs.set(cacheKey, job);
    void job;
  }

  static getInstance(): VideoWatermarkService {
    if (!VideoWatermarkService.instance) {
      VideoWatermarkService.instance = new VideoWatermarkService();
    }
    return VideoWatermarkService.instance;
  }

  async initializeWatermark(): Promise<void> {
    if (!localWatermark) {
      console.warn('[Watermark] Logo module not available, trying late load...');
      try {
        localWatermark = require('../assets/images/second.png');
      } catch (e) {
        console.error('[Watermark] Failed to late-load logo asset:', e);
        throw new Error('Watermark logo asset not found');
      }
    }

    try {
      const asset = Asset.fromModule(localWatermark);
      await asset.downloadAsync();
      this.watermarkUri = asset.localUri || asset.uri;
      console.log('[Watermark] Logo loaded:', this.watermarkUri);
      return;
    } catch (e) {
      console.warn('[Watermark] Asset async download failed, using sync load:', e);
    }

    try {
      const asset = Asset.fromModule(localWatermark);
      this.watermarkUri = asset.localUri || asset.uri;
      console.log('[Watermark] Logo loaded (sync):', this.watermarkUri);
    } catch (e) {
      console.error('[Watermark] Both async and sync asset loading failed:', e);
      throw new Error('Could not load watermark logo asset');
    }
  }

  getWatermarkUri(): string | null {
    return this.watermarkUri;
  }

  async preloadWatermark(): Promise<void> {
    if (!this.watermarkUri) {
      await this.initializeWatermark();
    }
  }

  async addWatermarkToVideo(videoUri: string, options: WatermarkOptions = {}): Promise<string> {
    if (Platform.OS === 'web') {
      return videoUri;
    }

    const position = options.position ?? 'bottom-right';
    const opacity = Math.max(0.15, Math.min(1, options.opacity ?? 0.75));
    const scale = Math.max(0.08, Math.min(0.4, options.scale ?? 0.18));
    const strict = options.strict ?? false;
    const allowFallback = options.allowFallback ?? false;
    const opts = { position, opacity, scale };

    // Ensure the logo asset is ready before processing
    try {
      await this.preloadWatermark();
    } catch (e) {
      console.error('[Watermark] Failed to preload watermark:', e);
      if (strict && !allowFallback) throw new Error('Watermark logo could not be loaded');
      if (allowFallback) return videoUri;
    }

    // On-device FFmpeg watermark embedding (no network dependency)
    try {
      const localResult = await this.addWatermarkLocally(videoUri, opts);
      if (localResult) {
        console.log('[Watermark] Successfully applied watermark locally via FFmpeg');
        return localResult;
      }
    } catch (error) {
      console.error('[Watermark] Local FFmpeg watermark threw error:', error);
    }

    const msg =
      'Watermark failed: local on-device watermarking is unavailable on this build.';
    console.warn('[Watermark]', msg, 'Returning original video');
    
    if (strict && !allowFallback) {
      throw new Error(msg + ' Install and rebuild with ffmpeg-kit-react-native (or @fathah_cr/react-native-ffmpeg-kit).');
    }
    
    return videoUri;
  }

  private getLocalOverlayExpr(
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  ): string {
    switch (position) {
      case 'top-left':
        return '20:20';
      case 'top-right':
        return 'main_w-overlay_w-20:20';
      case 'bottom-left':
        return '20:main_h-overlay_h-20';
      case 'center':
        return '(main_w-overlay_w)/2:(main_h-overlay_h)/2';
      default:
        return 'main_w-overlay_w-20:main_h-overlay_h-20';
    }
  }

  private async addWatermarkLocally(
    videoUri: string,
    options: {
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
      opacity: number;
      scale: number;
    }
  ): Promise<string | null> {
    if (Platform.OS === 'web') {
      return null;
    }

    if (!ensureFFmpegModuleLoaded()) {
      return null;
    }

    if (!this.watermarkUri) {
      await this.preloadWatermark();
    }

    if (!this.watermarkUri) {
      return null;
    }

    const localVideoUri = await this.ensureLocalFile(videoUri, 'wm_local_src');
    const localWatermarkUri = await this.ensureLocalFile(this.watermarkUri, 'wm_logo');

    const inputPath = localVideoUri.replace(/^file:\/\//, '');
    const watermarkPath = localWatermarkUri.replace(/^file:\/\//, '');
    const outputUri = `${FileSystem.cacheDirectory}wm_local_${Date.now()}.mp4`;
    const outputPath = outputUri.replace(/^file:\/\//, '');

    const overlayExpr = this.getLocalOverlayExpr(options.position);
    const logoWidth = Math.max(80, Math.min(240, Math.round(1080 * options.scale)));
    const safeOpacity = Math.max(0.15, Math.min(1, options.opacity));

    const filterComplex = [
      `[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${safeOpacity}[wm]`,
      `[0:v][wm]overlay=${overlayExpr}:format=auto[v]`,
    ].join(';');

    const candidateCommands: string[][] = [
      [
        '-y',
        '-i',
        inputPath,
        '-i',
        watermarkPath,
        '-filter_complex',
        filterComplex,
        '-map',
        '[v]',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      [
        '-y',
        '-i',
        inputPath,
        '-i',
        watermarkPath,
        '-filter_complex',
        filterComplex,
        '-map',
        '[v]',
        '-map',
        '0:a?',
        '-c:v',
        'h264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      [
        '-y',
        '-i',
        inputPath,
        '-i',
        watermarkPath,
        '-filter_complex',
        filterComplex,
        '-map',
        '[v]',
        '-map',
        '0:a?',
        '-c:v',
        'mpeg4',
        '-q:v',
        '4',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ],
    ];

    let lastLogs = '';
    for (const args of candidateCommands) {
      const session = await FFmpegKit.executeWithArguments(args);
      const rc = await session.getReturnCode();
      if (ReturnCode.isSuccess(rc)) {
        return outputUri;
      }
      const logs = await session.getAllLogsAsString();
      lastLogs = logs ?? '';
    }

    console.warn('[Watermark] Local FFmpeg strategy failed logs:', lastLogs.slice(-800));
    return null;
  }
}

export const videoWatermarkService =
  VideoWatermarkService.getInstance();
