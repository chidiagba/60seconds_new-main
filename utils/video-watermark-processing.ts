import { logger } from '@/lib/logger';
import { storageService, videoService } from '@/lib/database';
import { readUriAsArrayBuffer } from '@/utils/media-upload';
import { videoWatermarkService } from '@/utils/video-watermark';

const VIDEO_EXTENSIONS = ['mp4', 'mov'] as const;
const jobs = new Map<string, Promise<void>>();

export type WatermarkProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';

export function processVideoWatermarkAfterUpload(input: {
  videoId: string;
  userId: string;
  username: string;
  localSourceUri: string;
}): Promise<void> {
  const running = jobs.get(input.videoId);
  if (running) return running;

  const job = (async () => {
    try {
      await videoService.updateVideo(input.videoId, { watermark_status: 'processing' } as any).catch(() => {});
      if (__DEV__) logger.debug('[VideoWatermark] Background processing starting');
      const result = await videoWatermarkService.addWatermarkToVideo(input.localSourceUri, {
        username: input.username, strict: true, allowFallback: false,
      });
      const { arrayBuffer } = await readUriAsArrayBuffer(result.uri, {
        allowedExtensions: VIDEO_EXTENSIONS,
        fallbackExtension: result.outputType,
      });
      const fileName = `${input.userId}/wm_branded_v2_${input.videoId}_${Date.now()}.${result.outputType}`;
      const uploaded = await storageService.uploadVideo(arrayBuffer, fileName, result.mimeType);
      const remoteUrl = await storageService.getVideoUrl(uploaded.path);
      await videoService.updateVideo(input.videoId, {
        watermarked_video_url: remoteUrl,
        watermark_status: 'ready',
      } as any);
    } catch (error) {
      logger.warn('[VideoWatermark] Background processing failed; post remains valid:', error);
      await videoService.updateVideo(input.videoId, { watermark_status: 'failed' } as any).catch(() => {});
    } finally {
      jobs.delete(input.videoId);
    }
  })();

  jobs.set(input.videoId, job);
  return job;
}

export function startVideoWatermarkAfterUpload(input: {
  videoId: string;
  userId: string;
  username: string;
  localSourceUri: string;
}): void {
  void processVideoWatermarkAfterUpload(input);
}
