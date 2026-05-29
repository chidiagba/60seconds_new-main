import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { APP_WEBSITE_URL } from '@/constants/app-links';

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

function getCloudinaryGravity(position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'): string {
  switch (position) {
    case 'top-left':
      return 'north_west';
    case 'top-right':
      return 'north_east';
    case 'bottom-left':
      return 'south_west';
    case 'center':
      return 'center';
    default:
      return 'south_east';
  }
}

export class VideoWatermarkService {
  private static instance: VideoWatermarkService;
  private watermarkUri: string | null = null;
  private resolvedApiBaseUrl: string | null = null;
  private lastApiCheckAt = 0;
  private backgroundWatermarkJobs = new Map<string, Promise<string>>();

  private getApiCandidates(videoUri?: string): string[] {
    const urls: string[] = [];

    const explicit = process.env.EXPO_PUBLIC_RORK_API_BASE_URL?.trim();
    if (explicit) {
      urls.push(explicit.replace(/\/+$/, ''));
    }

    const productionApi = process.env.EXPO_PUBLIC_PRODUCTION_API_BASE_URL?.trim();
    if (productionApi) {
      urls.push(productionApi.replace(/\/+$/, ''));
    }

    const websiteBase = APP_WEBSITE_URL.replace(/\/+$/, '');
    urls.push(websiteBase);
    urls.push('https://api.60secondsapp.io');

    if (videoUri?.startsWith('http')) {
      try {
        const sourceOrigin = new URL(videoUri).origin;
        urls.push(sourceOrigin);
      } catch {
        // Ignore malformed URI
      }
    }

    const hostUri =
      Constants.expoConfig?.hostUri ||
      (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost ||
      (Constants as any)?.manifest?.debuggerHost ||
      '';
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      urls.push(`http://${host}:3001`);
    }

    urls.push('http://localhost:3001');
    urls.push('http://127.0.0.1:3001');

    if (Platform.OS === 'android') {
      urls.push('http://10.0.2.2:3001');
    }

    return Array.from(new Set(urls));
  }

  private async canReachApi(baseUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`${baseUrl}/`, { signal: controller.signal });
      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async resolveApiBaseUrl(): Promise<string | null> {
    const now = Date.now();
    if (this.resolvedApiBaseUrl && now - this.lastApiCheckAt < 60_000) {
      return this.resolvedApiBaseUrl;
    }

    const candidates = this.getApiCandidates();
    for (const candidate of candidates) {
      if (await this.canReachApi(candidate)) {
        this.resolvedApiBaseUrl = candidate;
        this.lastApiCheckAt = now;
        return candidate;
      }
    }

    this.resolvedApiBaseUrl = null;
    this.lastApiCheckAt = now;
    return null;
  }

  private async ensureLocalFile(inputUri: string, filePrefix: string): Promise<string> {
    if (inputUri.startsWith('file://')) {
      return inputUri;
    }

    const cleaned = inputUri.split('?')[0];
    const extension = cleaned.split('.').pop()?.toLowerCase() || 'mp4';
    const outputUri = `${FileSystem.cacheDirectory}${filePrefix}_${Date.now()}.${extension}`;
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
    const sourceUrl = options.sourceUrl?.trim() || null;
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

    // Strategy 1: Existing watermark API
    try {
      const serverResult = await this.addWatermarkViaServer(videoUri, opts);
      if (serverResult) {
        console.log('[Watermark] Successfully applied watermark via API');
        return serverResult;
      }
    } catch (error) {
      console.error('[Watermark] Server watermark threw error:', error);
      if (strict && !allowFallback) throw error;
    }

    // Strategy 2: Cloudinary transformation API fallback
    try {
      const cloudinaryInput = sourceUrl && sourceUrl.startsWith('http') ? sourceUrl : videoUri;
      const cloudinaryResult = await this.addWatermarkViaCloudinary(cloudinaryInput, opts);
      if (cloudinaryResult) {
        console.log('[Watermark] Successfully applied watermark via Cloudinary API');
        return cloudinaryResult;
      }
    } catch (error) {
      console.error('[Watermark] Cloudinary watermark threw error:', error);
      if (strict && !allowFallback) throw error;
    }

    // API watermark strategy failed
    const msg =
      'Watermark failed: all watermark API providers are unreachable or processing failed.';
    console.warn('[Watermark]', msg, 'Returning original video');
    
    if (strict && !allowFallback) {
      throw new Error(msg + ' Set EXPO_PUBLIC_PRODUCTION_API_BASE_URL to your deployed backend URL.');
    }
    
    return videoUri;
  }

  // Watermark API strategy ----------------------------------------------------

  private async addWatermarkViaCloudinary(
    videoUri: string,
    options: {
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
      opacity: number;
      scale: number;
    }
  ): Promise<string | null> {
    const cloudName = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
    const logoPublicId = process.env.EXPO_PUBLIC_CLOUDINARY_WATERMARK_LOGO_PUBLIC_ID?.trim();

    if (!cloudName || !logoPublicId) {
      return null;
    }

    if (!videoUri.startsWith('http')) {
      return null;
    }

    try {
      const gravity = 'south_east';
      const opacity = Math.round(options.opacity * 100);
      const encodedLogoId = encodeURIComponent(logoPublicId).replace(/%2F/g, ':');
      const encodedSource = encodeURIComponent(videoUri);
      const watermarkSize = Math.max(90, Math.min(180, Math.round(720 * options.scale)));
      const layerTransform = [
        `l_${encodedLogoId}`,
        'e_make_transparent',
        'c_fit',
        `w_${watermarkSize}`,
        `h_${watermarkSize}`,
        `o_${opacity}`,
        `g_${gravity}`,
        'x_20',
        'y_20',
        'fl_layer_apply',
      ].join(',');
      const transformedUrl = `https://res.cloudinary.com/${cloudName}/video/fetch/${layerTransform}/${encodedSource}`;

      return await this.ensureLocalFile(transformedUrl, 'wm_cloudinary');
    } catch (error) {
      console.warn('[Watermark] Cloudinary strategy failed:', error);
      return null;
    }
  }

  private async addWatermarkViaServer(
    videoUri: string,
    options: {
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
      opacity: number;
      scale: number;
    }
  ): Promise<string | null> {
    let apiBaseUrl = await this.resolveApiBaseUrl();
    if (!apiBaseUrl) {
      for (const candidate of this.getApiCandidates(videoUri)) {
        if (await this.canReachApi(candidate)) {
          apiBaseUrl = candidate;
          break;
        }
      }
    }
    if (!apiBaseUrl) return null;

    try {
      let watermarkedUrl: string | null = null;

      if (videoUri.startsWith('file://')) {
        const formData = new FormData();
        formData.append('video', {
          uri: videoUri,
          name: `video_${Date.now()}.mp4`,
          type: 'video/mp4',
        } as any);
        formData.append('position', options.position);
        formData.append('opacity', String(options.opacity));
        formData.append('scale', String(options.scale));
        const response = await fetch(`${apiBaseUrl}/api/video/watermark-upload`, { method: 'POST', body: formData });
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
        watermarkedUrl = (await response.json())?.watermarkedUrl ?? null;
      } else {
        const response = await fetch(`${apiBaseUrl}/api/video/watermark`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: videoUri, ...options }),
        });
        if (!response.ok) throw new Error(`URL request failed (${response.status})`);
        watermarkedUrl = (await response.json())?.watermarkedUrl ?? null;
      }

      if (!watermarkedUrl) throw new Error('Server did not return watermarkedUrl');
      return await this.ensureLocalFile(watermarkedUrl, 'wm_server');
    } catch (error) {
      console.warn('[Watermark] Server strategy failed:', error);
      return null;
    }
  }
}

export const videoWatermarkService =
  VideoWatermarkService.getInstance();
