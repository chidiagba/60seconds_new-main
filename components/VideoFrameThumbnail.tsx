import React, { useEffect, useState } from 'react';
import { Image, ImageStyle } from 'expo-image';
import * as VideoThumbnails from 'expo-video-thumbnails';

type VideoFrameThumbnailProps = {
  videoUri?: string;
  fallbackUri: string;
  style: ImageStyle | ImageStyle[];
};

const frameCache = new Map<string, string>();

export default function VideoFrameThumbnail({ videoUri, fallbackUri, style }: VideoFrameThumbnailProps) {
  const [frameUri, setFrameUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const generateFrame = async () => {
      if (!videoUri) {
        setFrameUri(null);
        return;
      }

      const cached = frameCache.get(videoUri);
      if (cached) {
        setFrameUri(cached);
        return;
      }

      try {
        const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
          time: 1000,
          quality: 0.6,
        });

        frameCache.set(videoUri, uri);
        if (!cancelled) {
          setFrameUri(uri);
        }
      } catch {
        if (!cancelled) {
          setFrameUri(null);
        }
      }
    };

    generateFrame();

    return () => {
      cancelled = true;
    };
  }, [videoUri]);

  return (
    <Image
      source={{ uri: frameUri || fallbackUri }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={120}
    />
  );
}
