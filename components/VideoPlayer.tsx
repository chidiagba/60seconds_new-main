import React, { useRef, useState, useEffect } from 'react';
import { View, StyleSheet, Dimensions, ActivityIndicator, TouchableWithoutFeedback, Platform, TouchableOpacity, Text, AppState, AppStateStatus } from 'react-native';
import { Video as ExpoVideo, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { TaggedUser } from '@/types';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import VideoWatermark from '@/components/VideoWatermark';

interface VideoPlayerProps {
  uri: string;
  paused: boolean;
  autoplay?: boolean;
  autoplayWithSound?: boolean;
  onPress?: () => void;
  taggedUsers?: TaggedUser[];
  showWatermark?: boolean;
  onLoadError?: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const isBackgroundAudioFocusError = (error: unknown) => {
  const message = String((error as any)?.message || error || '');
  return /AudioFocusNotAcquiredException|currently in the background|audio focus could not be acquired/i.test(message);
};

const hasEmbeddedWatermark = (uri: string) => {
  let normalizedUri = uri.toLowerCase();

  try {
    normalizedUri = decodeURIComponent(normalizedUri);
  } catch {
    // Keep the original URI when it contains malformed escape sequences.
  }

  return normalizedUri.includes('_wm_')
    || normalizedUri.includes('/wm_')
    || normalizedUri.includes('watermarked');
};

export default function VideoPlayer({ uri, paused, autoplay = false, autoplayWithSound = true, onPress, taggedUsers, showWatermark = true, onLoadError }: VideoPlayerProps) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const videoRef = useRef<ExpoVideo>(null);
  const lastProgressSecondRef = useRef(-1);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(!paused);
  const [showPlayButton, setShowPlayButton] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showTaggedUsers, setShowTaggedUsers] = useState(true);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [hasError, setHasError] = useState(false);
  const [videoInstanceKey, setVideoInstanceKey] = useState(0);
  const [androidImplementation, setAndroidImplementation] = useState<'MediaPlayer' | 'ExoPlayer'>('MediaPlayer');
  const hasRetriedDecoderFallbackRef = useRef(false);
  const canPlay = !paused && appState === 'active' && isFocused;
  const canPlayWithSound = autoplayWithSound && canPlay;
  const androidVideoProps = Platform.OS === 'android' ? ({ androidImplementation } as any) : {};
  // Uploaded videos whose storage name contains `wm_` already have the logo
  // burned into their frames. Drawing the UI watermark as well would show two
  // logos after the feed refreshes (for example, when the share count updates).
  const shouldShowOverlayWatermark = showWatermark && !hasEmbeddedWatermark(uri);

  const tryAndroidCodecFallback = (errorMessage: string, source: 'status' | 'onError') => {
    if (Platform.OS !== 'android') {
      return false;
    }

    const isDecoderInitFailure = /Decoder init failed|DecoderInitializationException|video\/mp4v-es|c2\.android\.mpeg4\.decoder/i.test(errorMessage);
    if (!isDecoderInitFailure || hasRetriedDecoderFallbackRef.current) {
      return false;
    }

    const nextImplementation = androidImplementation === 'MediaPlayer' ? 'ExoPlayer' : 'MediaPlayer';
    console.warn(`🎬 VideoPlayer: ${source} decoder failure, retrying with ${nextImplementation}:`, errorMessage);
    hasRetriedDecoderFallbackRef.current = true;
    setAndroidImplementation(nextImplementation);
    setVideoInstanceKey((prev) => prev + 1);
    setHasError(false);
    setIsLoading(true);
    return true;
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
    });

    if (!uri || uri === '') {
      console.error('🎬 VideoPlayer: Invalid video URI provided');
    }

    // Cleanup function to unload video when component unmounts
    return () => {
      subscription.remove();
      if (videoRef.current && Platform.OS !== 'web') {
        videoRef.current.unloadAsync().catch((error) => {
          console.error('🎬 VideoPlayer: Error unloading video:', error);
        });
      }
    };
  }, [uri]);

  useEffect(() => {
    setVideoInstanceKey((prev) => prev + 1);
    setHasError(false);
    setIsLoading(true);
    setAndroidImplementation('MediaPlayer');
    hasRetriedDecoderFallbackRef.current = false;
  }, [uri]);

  useEffect(() => {
    const appIsActive = appState === 'active';
    setIsPlaying(!paused && appIsActive);
  }, [paused, appState]);

  useEffect(() => {
    if (Platform.OS === 'web' || !autoplay || !canPlayWithSound || !videoRef.current) {
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const applyAutoplaySound = async (attempt = 0) => {
      if (
        cancelled ||
        AppState.currentState !== 'active' ||
        appState !== 'active' ||
        paused ||
        !isFocused ||
        !videoRef.current
      ) {
        return;
      }

      // Foreground transitions can briefly report active before native audio focus is ready.
      try {
        await videoRef.current.setIsMutedAsync(false);
        await videoRef.current.setVolumeAsync(1.0);
      } catch (error) {
        if (isBackgroundAudioFocusError(error) && attempt < 4) {
          retryTimer = setTimeout(() => {
            applyAutoplaySound(attempt + 1);
          }, 350);
          return;
        }

        if (!isBackgroundAudioFocusError(error)) {
          console.warn('🎬 VideoPlayer: Failed to prepare autoplay audio:', error);
        }
      }
    };

    const timer = setTimeout(() => {
      applyAutoplaySound();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [autoplay, canPlayWithSound, paused, appState, isFocused, uri]);

  const handlePlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setIsLoading(false);
      if (status.positionMillis !== undefined && taggedUsers && taggedUsers.length > 0) {
        const nextSecond = Math.floor(status.positionMillis / 1000);
        if (nextSecond !== lastProgressSecondRef.current) {
          lastProgressSecondRef.current = nextSecond;
          setCurrentTime(nextSecond);
        }
      }
    } else if (status.error) {
      const errorMessage = String(status.error || '');
      if (tryAndroidCodecFallback(errorMessage, 'status')) {
        return;
      }

      console.error('🎬 VideoPlayer: Playback error:', status.error);
      setIsLoading(false);
      setHasError(true);
      onLoadError?.();
    }
  };

  const togglePlayPause = () => {
    const appIsActive = appState === 'active';

    if (!autoplay) {
      if (videoRef.current && Platform.OS !== 'web') {
        try {
          if (isPlaying) {
            setIsPlaying(false);
            setShowPlayButton(true);
          } else {
            if (!appIsActive) {
              return;
            }
            setIsPlaying(true);
            setTimeout(() => setShowPlayButton(false), 1500);
          }
        } catch (error) {
          console.error('🎬 VideoPlayer: Error toggling play/pause:', error);
        }
      } else {
        // For web, just toggle the state
        setIsPlaying(!isPlaying);
        setShowPlayButton(!isPlaying);
        if (isPlaying) {
          setShowPlayButton(true);
        } else {
          setTimeout(() => setShowPlayButton(false), 1500);
        }
      }
    }

    if (onPress) {
      onPress();
    }
  };

  const handleTagPress = (userId: string) => {
    router.push({
      pathname: '/ProfileUserScreen' as any,
      params: { userId }
    });
  };

  // Filter tagged users based on current video time
  const visibleTaggedUsers = taggedUsers?.filter(user => {
    // If no timestamp is provided, always show the tag
    if (user.timestamp === undefined) return true;

    // Show tags that are within 3 seconds of their timestamp
    const timeDiff = Math.abs(currentTime - user.timestamp);
    return timeDiff <= 3;
  });

  return (
    <TouchableWithoutFeedback onPress={togglePlayPause}>
      <View style={styles.container}>
        {hasError ? (
          <View style={styles.errorFallbackContainer}>
            <Ionicons name="videocam-off" size={40} color={Colors.dark.subtext} />
            <Text style={styles.errorFallbackText}>Video unavailable</Text>
          </View>
        ) : (
          // Always mount ExpoVideo so Android/iOS can preload/buffer adjacent videos.
          // We only control playback via shouldPlay — the component stays mounted even when paused.
          <ExpoVideo
            key={videoInstanceKey}
            ref={videoRef}
            source={{ uri }}
            style={styles.video}
            resizeMode={ResizeMode.COVER}
            {...androidVideoProps}
            shouldPlay={Platform.OS === 'web' ? isPlaying : canPlay}
            isMuted={!canPlayWithSound}
            volume={1.0}
            isLooping
            onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
            useNativeControls={Platform.OS === 'web'}
            onError={(error) => {
              const errorMessage = String(error || '');
              if (tryAndroidCodecFallback(errorMessage, 'onError')) {
                return;
              }

              console.error('🎬 VideoPlayer: Video loading error:', error);
              setIsLoading(false);
              setHasError(true);
              onLoadError?.();
            }}
          />
        )}


        {isLoading && !paused && (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={Colors.dark.primary} />
          </View>
        )}

        {showPlayButton && Platform.OS !== 'web' && !autoplay && (
          <View style={styles.playButtonContainer}>
            <View style={styles.playButtonBackground}>
              <Ionicons name="play" size={50} color={Colors.dark.text} />
            </View>
          </View>
        )}

        {/* Video Overlay Gradient */}
        <LinearGradient
          colors={['transparent', 'rgba(10, 10, 15, 0.4)', 'rgba(10, 10, 15, 0.8)']}
          style={styles.overlay}
          pointerEvents="none"
        />

        {/* Watermark */}
        <VideoWatermark
          visible={shouldShowOverlayWatermark}
          position="bottom-right"
          opacity={0.8}
          size={{ width: 160, height: 80 }}
        />

        {/* Tagged Users */}
        {showTaggedUsers && visibleTaggedUsers && visibleTaggedUsers.length > 0 && (
          <View style={styles.tagsContainer}>
            {visibleTaggedUsers.map((taggedUser) => {
              // Default position if none provided
              const position = taggedUser.position || { x: 0.5, y: 0.5 };

              return (
                <TouchableOpacity
                  key={taggedUser.userId}
                  style={[
                    styles.tagBubble,
                    {
                      left: `${position.x * 100}%`,
                      top: `${position.y * 100}%`,
                    }
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleTagPress(taggedUser.userId);
                  }}
                >
                  <Image
                    source={{ uri: taggedUser.user.avatar }}
                    style={styles.tagAvatar}
                    contentFit="cover"
                  />
                  <Text style={styles.tagUsername}>@{taggedUser.user.username}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: Colors.dark.background,
    height: '100%',
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  loaderContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 15, 0.7)',
  },
  playButtonContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonBackground: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(99, 102, 241, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.dark.primary,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  tagsContainer: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'box-none',
  },
  tagBubble: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 15, 0.7)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    transform: [{ translateX: -50 }, { translateY: -50 }],
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  tagAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 6,
  },
  tagUsername: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '600',
  },
  errorFallbackContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 30, 40, 0.9)',
  },
  errorFallbackText: {
    color: Colors.dark.subtext,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
});
