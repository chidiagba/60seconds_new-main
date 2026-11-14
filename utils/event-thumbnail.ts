import { logger } from '@/lib/logger';
import * as VideoThumbnails from 'expo-video-thumbnails';

export const LEGACY_EVENT_THUMBNAIL_URL =
  'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80';

export const generateEventThumbnail = async (videoUri: string): Promise<string | null> => {
  try {
    const result = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: 1000,
      quality: 0.8,
    });
    return result.uri;
  } catch (error) {
    logger.warn('Unable to generate event thumbnail:', error);
    return null;
  }
};

export const isLegacyEventThumbnail = (uri?: string | null) =>
  !uri || uri === LEGACY_EVENT_THUMBNAIL_URL;
