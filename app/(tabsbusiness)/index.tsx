


import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, Dimensions, ActivityIndicator, Text, TouchableOpacity, Alert, Platform, AppState, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVideoStore } from '@/store/video-store';
import { useContentModerationStore } from '@/store/content-moderation-store';
import VideoPlayer from '@/components/VideoPlayer';
import VideoInfo from '@/components/VideoInfo';
import VideoActions from '@/components/VideoActions';
import CartButton from '@/components/CartButton';
import EULADialog from '@/components/EULADialog';
import Colors from '@/constants/colors';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { MapPin, RefreshCw } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { videoService } from '@/lib/database';
import { useAuth } from '@/lib/auth';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const TAB_BAR_HEIGHT = 80;
const FEED_VIEWPORT_HEIGHT = Math.max(1, SCREEN_HEIGHT - TAB_BAR_HEIGHT);
const EULA_ACCEPTED_KEY = 'eula_accepted_v1';
const SIGNIN_PROMPT_INTERVAL = 3;

export default function HomeScreen() {
  const router = useRouter();
  const { user: authUser } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const params = useLocalSearchParams<{ selectedVideoId?: string }>();
  const selectedVideoIdFromParams = typeof params.selectedVideoId === 'string' ? params.selectedVideoId : '';
  const insets = useSafeAreaInsets();
  const { videos, loadCachedVideos, fetchVideos, fetchMoreVideos, currentVideoIndex, setCurrentVideoIndex, isLoading, isFetchingMore, filterVideosByLocation, refreshVideoEngagement } = useVideoStore();
  const { loadHiddenVideos, loadBlockedUsers, isVideoHidden, isUserBlocked } = useContentModerationStore();
  const [showEULA, setShowEULA] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const [visibleVideoIndex, setVisibleVideoIndex] = useState(0);
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [hasCheckedLocationPermission, setHasCheckedLocationPermission] = useState(Platform.OS === 'web');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAllVideos, setShowAllVideos] = useState(false);
  const [isHomeFocused, setIsHomeFocused] = useState(true);
  const [manuallyPausedIndex, setManuallyPausedIndex] = useState<number | null>(null);
  const [pendingSelectedVideoId, setPendingSelectedVideoId] = useState<string | null>(null);
  const [unavailableVideoIds, setUnavailableVideoIds] = useState<Set<string>>(new Set());
  const [isPreloadingVideo, setIsPreloadingVideo] = useState(false);
  const [videoMessage, setVideoMessage] = useState<{ title: string; message: string; icon: string } | null>(null);
  const hasCheckedMissingVideoRef = useRef<Set<string>>(new Set());
  const lastVisibleIndexRef = useRef(-1);
  const lastEngagedVideoIdRef = useRef<string | null>(null);
  const nextSigninPromptAtRef = useRef(SIGNIN_PROMPT_INTERVAL);
  const isSigninPromptActiveRef = useRef(false);
  const feedViewportHeight = useMemo(() => Math.max(1, SCREEN_HEIGHT - Math.max(tabBarHeight, TAB_BAR_HEIGHT)), [tabBarHeight]);
  
  useEffect(() => {
    (async () => {
      try {
        const accepted = await AsyncStorage.getItem(EULA_ACCEPTED_KEY);
        setShowEULA(accepted !== 'true');
      } catch {
        setShowEULA(true);
      }
    })();
  }, []);

  useEffect(() => {
    loadHiddenVideos();
    loadBlockedUsers();
  }, [loadHiddenVideos, loadBlockedUsers]);

  const handleAcceptEULA = async () => {
    try {
      await AsyncStorage.setItem(EULA_ACCEPTED_KEY, 'true');
      setShowEULA(false);
    } catch {
      setShowEULA(false);
    }
  };

  const refreshLocationPermission = useCallback(async () => {
    if (Platform.OS === 'web') {
      setLocationPermission(true);
      setHasCheckedLocationPermission(true);
      return true;
    }

    const currentPermission = await Location.getForegroundPermissionsAsync();
    const granted = currentPermission.status === 'granted';
    setLocationPermission(granted);
    setHasCheckedLocationPermission(true);
    return granted;
  }, []);

  // initial fetch without asking for permissions; location will be requested only on demand
  useEffect(() => {
    (async () => {
      try {
        await refreshLocationPermission();

        await loadCachedVideos();
        await fetchVideos();
      } catch (error) {
        console.error('Error fetching videos on mount:', error);
      }
    })();
  }, [fetchVideos, loadCachedVideos, refreshLocationPermission]);

  useFocusEffect(
    React.useCallback(() => {
      refreshLocationPermission().catch((error) => {
        console.warn('Error checking location permission on focus:', error);
      });
    }, [refreshLocationPermission])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshLocationPermission().catch((error) => {
          console.warn('Error checking location permission on app active:', error);
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshLocationPermission]);

  // Refresh videos when screen comes into focus (e.g., after creating an event)
  // TEMPORARILY DISABLED TO DEBUG SHOW ALL VIDEOS ISSUE
  /*
  useFocusEffect(
    React.useCallback(() => {
      
      const refreshVideos = async () => {
        try {
          if (userLocation && Platform.OS !== 'web' && !showAllVideos) {
            // If we have location and user hasn't chosen to show all videos, filter by location
            await filterVideosByLocation(userLocation.coords.latitude, userLocation.coords.longitude, 30);
          } else {
            // Otherwise, fetch all videos with force refresh
            await fetchVideos();
          }
        } catch (error) {
          console.error('Error refreshing videos on focus:', error);
        }
      };

      // Only refresh if we already have some videos loaded (to avoid double loading on initial mount)
      if (videos.length > 0) {
        refreshVideos();
      }
    }, [userLocation, videos.length, showAllVideos])
  );
  */

  useFocusEffect(
    React.useCallback(() => {
      setIsHomeFocused(true);
      isSigninPromptActiveRef.current = false;
      return () => {
        setIsHomeFocused(false);
      };
    }, [])
  );

  useEffect(() => {
    if (authUser) {
      nextSigninPromptAtRef.current = SIGNIN_PROMPT_INTERVAL;
      isSigninPromptActiveRef.current = false;
    }
  }, [authUser]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedVideoIdFromParams) {
      return;
    }

    (async () => {
      setPendingSelectedVideoId(selectedVideoIdFromParams);
      setIsPreloadingVideo(true);
      setShowAllVideos(true);
      try {
        await fetchVideos();
        const { fetchVideoById } = useVideoStore.getState();
        const video = await fetchVideoById(selectedVideoIdFromParams);
        if (!video && !cancelled) {
          setIsPreloadingVideo(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error preloading selected profile video:', error);
          setIsPreloadingVideo(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedVideoIdFromParams, fetchVideos]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const firstViewable = viewableItems.find((item: any) => item?.isViewable && typeof item?.index === 'number');
    const nextIndex = firstViewable?.index;
    if (typeof nextIndex !== 'number' || nextIndex === lastVisibleIndexRef.current) {
      return;
    }

    lastVisibleIndexRef.current = nextIndex;
    setVisibleVideoIndex(nextIndex);
    setCurrentVideoIndex(nextIndex);
    setManuallyPausedIndex(null);
  }).current;

  const handleVideoPress = (index: number) => {
    setManuallyPausedIndex((previousIndex) => (previousIndex === index ? null : index));
  };

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 70,
    minimumViewTime: 100,
  }).current;

  const handleEndReached = useCallback(() => {
    fetchMoreVideos().catch((error) => {
      console.warn('fetchMoreVideos error:', error);
    });
  }, [fetchMoreVideos]);

  const handleCartPress = () => {
    router.push('/cart');
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (userLocation && Platform.OS !== 'web' && !showAllVideos) {
        await filterVideosByLocation(userLocation.coords.latitude, userLocation.coords.longitude, 30);
      } else {
        await fetchVideos(); // Force refresh to get latest data
      }
    } catch (error) {
      console.error('Error refreshing videos:', error);
      Alert.alert('Error', 'Failed to refresh videos. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const markVideoUnavailable = useCallback((videoId: string) => {
    setUnavailableVideoIds((currentIds) => {
      if (currentIds.has(videoId)) {
        return currentIds;
      }

      const nextIds = new Set(currentIds);
      nextIds.add(videoId);
      return nextIds;
    });

    setPendingSelectedVideoId((currentId) => (currentId === videoId ? null : currentId));
  }, []);

  const handleRequestLocation = async () => {
    try {
      if (Platform.OS === 'web') {
        // On web, just fetch all videos
        setShowAllVideos(false);
        await fetchVideos();
        return;
      }
      
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocationPermission(true);
        setHasCheckedLocationPermission(true);
        setShowAllVideos(false); // Reset to location-based filtering
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        });
        setUserLocation(location);
        setLocationError(null);
        await filterVideosByLocation(location.coords.latitude, location.coords.longitude, 30);
      } else {
        setLocationPermission(false);
        setHasCheckedLocationPermission(true);
        setLocationError("Location permission denied. Please enable location services to see nearby events.");
        await fetchVideos();
      }
    } catch (error) {
      console.error('Error requesting location:', error);
      setHasCheckedLocationPermission(true);
      setLocationError("Failed to get your location. Please try again.");
      await fetchVideos();
    }
  };

  const visibleVideos = videos.filter((video) => {
    const hasPlayableUrl = typeof video.url === 'string' && /^https?:\/\//i.test(video.url);
    return hasPlayableUrl && !unavailableVideoIds.has(video.id) && !isVideoHidden(video.id) && !isUserBlocked(video.userId);
  });
  const videosForFeed = useMemo(() => {
    if (!pendingSelectedVideoId || visibleVideos.length <= 1) {
      return visibleVideos;
    }

    const selectedIndex = visibleVideos.findIndex((video) => video.id === pendingSelectedVideoId);
    if (selectedIndex <= 0) {
      return visibleVideos;
    }

    const selectedVideo = visibleVideos[selectedIndex];
    return [
      selectedVideo,
      ...visibleVideos.slice(0, selectedIndex),
      ...visibleVideos.slice(selectedIndex + 1),
    ];
  }, [pendingSelectedVideoId, visibleVideos]);

  useEffect(() => {
    if (visibleVideoIndex < videosForFeed.length) {
      return;
    }

    const nextIndex = Math.max(0, videosForFeed.length - 1);
    setVisibleVideoIndex(nextIndex);
    setCurrentVideoIndex(nextIndex);
    setManuallyPausedIndex(null);

    if (videosForFeed.length > 0) {
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToIndex({ index: nextIndex, animated: false });
      });
    }
  }, [setCurrentVideoIndex, videosForFeed.length, visibleVideoIndex]);

  useEffect(() => {
    const visibleVideo = videosForFeed[visibleVideoIndex];
    if (!visibleVideo?.id) {
      return;
    }

    if (lastEngagedVideoIdRef.current === visibleVideo.id) {
      return;
    }

    lastEngagedVideoIdRef.current = visibleVideo.id;

    refreshVideoEngagement(visibleVideo.id);
  }, [visibleVideoIndex, videosForFeed, refreshVideoEngagement]);

  useEffect(() => {
    if (authUser || !isHomeFocused || videosForFeed.length === 0) {
      return;
    }

    const watchedCount = visibleVideoIndex + 1;
    if (watchedCount < nextSigninPromptAtRef.current || isSigninPromptActiveRef.current) {
      return;
    }

    isSigninPromptActiveRef.current = true;
    nextSigninPromptAtRef.current += SIGNIN_PROMPT_INTERVAL;
    router.push({ pathname: '/signin', params: { prompt: '1', allowSkip: '1' } });
  }, [authUser, isHomeFocused, router, videosForFeed.length, visibleVideoIndex]);

  useEffect(() => {
    let cancelled = false;

    const focusSelectedVideo = async () => {
      if (!pendingSelectedVideoId) {
        setIsPreloadingVideo(false);
        return;
      }

      const selectedIndex = videosForFeed.findIndex((video) => video.id === pendingSelectedVideoId);
      if (selectedIndex >= 0) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToIndex({ index: selectedIndex, animated: false });
        });
        setVisibleVideoIndex(selectedIndex);
        setCurrentVideoIndex(selectedIndex);
        setManuallyPausedIndex(null);
        setPendingSelectedVideoId(null);
        setIsPreloadingVideo(false);
        return;
      }

      if (hasCheckedMissingVideoRef.current.has(pendingSelectedVideoId)) {
        setPendingSelectedVideoId(null);
        setIsPreloadingVideo(false);
        return;
      }

      hasCheckedMissingVideoRef.current.add(pendingSelectedVideoId);

      try {
        await videoService.getVideo(pendingSelectedVideoId);
        if (!cancelled) {
          await fetchVideos();
        }
      } catch (error: any) {
        if (!cancelled) {
          const errorCode = error?.code;
          const errorMessage = String(error?.message || '').toLowerCase();
          const isDeletedVideo =
            errorCode === 'PGRST116' ||
            errorMessage.includes('no rows') ||
            errorMessage.includes('not found');

          if (isDeletedVideo) {
            markVideoUnavailable(pendingSelectedVideoId);
            setVideoMessage({
              icon: '🗑️',
              title: 'Video Removed',
              message: 'This video has been deleted by the owner and is no longer available.',
            });
          }
          setPendingSelectedVideoId(null);
          setIsPreloadingVideo(false);
        }
      }
    };

    focusSelectedVideo();

    return () => {
      cancelled = true;
    };
  }, [markVideoUnavailable, pendingSelectedVideoId, videosForFeed, fetchVideos, setCurrentVideoIndex]);

  const renderItem = useCallback(({ item, index }: { item: any, index: number }) => {
    return (
      <View style={[styles.videoContainer, { height: feedViewportHeight }]}>
        <VideoPlayer
          uri={item.url}
          paused={index !== visibleVideoIndex || !isHomeFocused || manuallyPausedIndex === index}
          autoplay={true}
          autoplayWithSound={true}
          onPress={() => handleVideoPress(index)}
          taggedUsers={item.taggedUsers}
          showWatermark={true}
          onLoadError={() => markVideoUnavailable(item.id)}
        />
        <VideoInfo video={item} />
        <VideoActions video={item} showCartButton />
      </View>
    );
  }, [feedViewportHeight, isHomeFocused, manuallyPausedIndex, markVideoUnavailable, visibleVideoIndex]);

  if (showEULA) {
    return <EULADialog visible={showEULA} onAccept={handleAcceptEULA} />;
  }

  if (isLoading && videos.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
        <Text style={styles.loadingText}>Finding nearby events...</Text>
        <CartButton onPress={handleCartPress} />
      </View>
    );
  }

  if (locationError && videos.length === 0 && Platform.OS !== 'web') {
    return (
      <View style={styles.errorContainer}>
        <MapPin size={50} color={Colors.dark.primary} />
        <Text style={styles.errorTitle}>Location Access Needed</Text>
        <Text style={styles.errorText}>{locationError}</Text>
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={handleRequestLocation}
        >
          {Platform.OS === 'ios' || Platform.OS === 'android' ? (
            <LinearGradient
              colors={Colors.dark.gradients.primary as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientButton}
            >
              <Text style={styles.actionButtonText}>Enable Location</Text>
            </LinearGradient>
          ) : (
            <View style={[styles.gradientButton, { backgroundColor: Colors.dark.primary }]}>
              <Text style={styles.actionButtonText}>Enable Location</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={async () => {
          setShowAllVideos(true);
          try {
            await fetchVideos();
          } catch (error) {
            // Even if fetchVideos fails, we've set showAllVideos to true
            // The useFocusEffect is disabled, so it shouldn't interfere
          }
        }}>
          <Text style={styles.skipButtonText}>Skip (Show All Videos)</Text>
        </TouchableOpacity>
        <CartButton onPress={handleCartPress} />
      </View>
    );
  }

  if (!isLoading && videos.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <MapPin size={50} color={Colors.dark.primary} />
        <Text style={styles.emptyTitle}>No Events Nearby</Text>
        <Text style={styles.emptyText}>We couldn't find any events within 30km of your location.</Text>
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={handleRefresh}
        >
          {Platform.OS === 'ios' || Platform.OS === 'android' ? (
            <LinearGradient
              colors={Colors.dark.gradients.primary as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientButton}
            >
              <RefreshCw size={20} color={Colors.dark.text} />
              <Text style={styles.actionButtonText}>Refresh</Text>
            </LinearGradient>
          ) : (
            <View style={[styles.gradientButton, { backgroundColor: Colors.dark.primary }]}>
              <RefreshCw size={20} color={Colors.dark.text} />
              <Text style={styles.actionButtonText}>Refresh</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={async () => {
          setShowAllVideos(true);
          try {
            await fetchVideos();
          } catch (error) {
            // Even if fetchVideos fails, we've set showAllVideos to true
            // The useFocusEffect is disabled, so it shouldn't interfere
          }
        }}>
          <Text style={styles.skipButtonText}>Show All Videos</Text>
        </TouchableOpacity>
        <CartButton onPress={handleCartPress} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {Platform.OS !== 'web' && hasCheckedLocationPermission && locationPermission === false && (
        <View style={[styles.locationBanner, { paddingTop: Math.max(insets.top, 12) }]}>
          <Text style={styles.locationBannerText}>Enable location to see nearby events</Text>
          <TouchableOpacity onPress={handleRequestLocation} style={styles.locationBannerButton}>
            <Text style={styles.locationBannerButtonText}>Enable</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={videosForFeed}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        getItemLayout={(_, index) => ({ length: feedViewportHeight, offset: feedViewportHeight * index, index })}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={feedViewportHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        removeClippedSubviews
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        updateCellsBatchingPeriod={16}
        onEndReached={handleEndReached}
        onEndReachedThreshold={2}
        ListFooterComponent={isFetchingMore ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={Colors.dark.primary} />
          </View>
        ) : null}
        onRefresh={handleRefresh}
        refreshing={isRefreshing}
        contentContainerStyle={styles.flatListContent}
      />
      {isPreloadingVideo && (
        <View style={StyleSheet.absoluteFillObject}>
          <View style={styles.preloadOverlay}>
            <ActivityIndicator size="large" color={Colors.dark.primary} />
            <Text style={styles.preloadText}>Preparing video...</Text>
          </View>
        </View>
      )}

      {/* Beautiful video message modal */}
      <Modal
        visible={!!videoMessage}
        transparent
        animationType="fade"
        onRequestClose={() => setVideoMessage(null)}
      >
        <View style={styles.messageOverlay}>
          <View style={styles.messageCard}>
            <Text style={styles.messageIcon}>{videoMessage?.icon}</Text>
            <Text style={styles.messageTitle}>{videoMessage?.title}</Text>
            <Text style={styles.messageBody}>{videoMessage?.message}</Text>
            <TouchableOpacity style={styles.messageDismissButton} onPress={() => setVideoMessage(null)}>
              <Text style={styles.messageDismissText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  flatListContent: {
    flexGrow: 1,
  },
  preloadOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  preloadText: {
    color: Colors.dark.text,
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
  },
  locationBanner: {
    backgroundColor: Colors.dark.card,
    paddingBottom: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationBannerText: {
    color: Colors.dark.text,
    flex: 1,
    marginRight: 8,
  },
  locationBannerButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.dark.primary,
  },
  locationBannerButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
  videoContainer: {
    width: SCREEN_WIDTH,
    position: 'relative',
    flex:1
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
    padding: 20,
  },
  loadingText: {
    color: Colors.dark.text,
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
    padding: 20,
  },
  errorTitle: {
    color: Colors.dark.text,
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 12,
  },
  errorText: {
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginBottom: 32,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: '80%',
  },
  actionButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    elevation: 4,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  actionButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
  },
  skipButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  skipButtonText: {
    color: Colors.dark.subtext,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
    padding: 20,
  },
  emptyTitle: {
    color: Colors.dark.text,
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 12,
  },
  emptyText: {
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginBottom: 32,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: '80%',
  },
  messageOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  messageCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  messageIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  messageTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  messageBody: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  messageDismissButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 36,
  },
  messageDismissText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});
















// import React, { useEffect, useState, useRef } from 'react';
// import { View, StyleSheet, FlatList, Dimensions, ActivityIndicator, Text, TouchableOpacity, Alert, Platform } from 'react-native';
// import { useVideoStore } from '@/store/video-store';
// import VideoPlayer from '@/components/VideoPlayer';
// import VideoInfo from '@/components/VideoInfo';
// import VideoActions from '@/components/VideoActions';
// import CartButton from '@/components/CartButton';
// import Colors from '@/constants/colors';
// import { useRouter } from 'expo-router';
// import * as Location from 'expo-location';
// import { MapPin, RefreshCw, FileText } from 'lucide-react-native';
// import { LinearGradient } from 'expo-linear-gradient';

// const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// export default function HomeScreen() {
//   const router = useRouter();
//   const { videos, fetchVideos, setCurrentVideoIndex, isLoading, filterVideosByLocation, getEventsWithVideos } = useVideoStore();
//   const flatListRef = useRef<FlatList>(null);
//   const [visibleVideoIndex, setVisibleVideoIndex] = useState(0);
//   const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
//   const [locationError, setLocationError] = useState<string | null>(null);
//   const [isRefreshing, setIsRefreshing] = useState(false);
//   const [showAllVideos, setShowAllVideos] = useState(false);
//   const [eventsWithVideos, setEventsWithVideos] = useState<any[]>([]); // State to hold events with videos

//   // Request location permission and get user location
//   useEffect(() => {
//     (async () => {
//       try {
//         if (Platform.OS === 'web') {
//           await fetchVideos();
//           return;
//         }

//         const { status } = await Location.requestForegroundPermissionsAsync();

//         if (status === 'granted') {
//           const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
//           setUserLocation(location);
//           await filterVideosByLocation(location.coords.latitude, location.coords.longitude, 30);
//         } else {
//           setLocationError(
//             "Location access is optional. If enabled, we show nearby events. You can also continue without it."
//           );
//           await fetchVideos();
//         }
//       } catch (error) {
//         console.error('Error getting location:', error);
//         setLocationError("We couldn't access your location. You can continue without it or try again.");
//         await fetchVideos();
//       }
//     })();
//   }, []);

//   // Check for events with videos from Supabase
//   useEffect(() => {
//     const fetchEventsWithVideos = async () => {
//       try {
//         const events = await getEventsWithVideos(); // Fetch events with videos from Supabase
//         setEventsWithVideos(events); // Set the state with the events that contain videos
//       } catch (error) {
//         console.error('Error fetching events:', error);
//       }
//     };

//     fetchEventsWithVideos();
//   }, []);

//   const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
//     if (viewableItems.length > 0) {
//       setVisibleVideoIndex(viewableItems[0].index);
//       setCurrentVideoIndex(viewableItems[0].index);
//     }
//   }).current;

//   const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

//   const handleCartPress = () => router.push('/cart');

//   const handleRefresh = async () => {
//     setIsRefreshing(true);
//     try {
//       if (userLocation && Platform.OS !== 'web' && !showAllVideos) {
//         await filterVideosByLocation(userLocation.coords.latitude, userLocation.coords.longitude, 30);
//       } else {
//         await fetchVideos();
//       }
//     } catch (error) {
//       console.error('Error refreshing videos:', error);
//       Alert.alert('Error', 'Failed to refresh videos. Please try again.');
//     } finally {
//       setIsRefreshing(false);
//     }
//   };

//   const handleRequestLocation = async () => {
//     try {
//       if (Platform.OS === 'web') {
//         setShowAllVideos(false);
//         await fetchVideos();
//         return;
//       }

//       const { status } = await Location.requestForegroundPermissionsAsync();
//       if (status === 'granted') {
//         setShowAllVideos(false);
//         const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
//         setUserLocation(location);
//         setLocationError(null);
//         await filterVideosByLocation(location.coords.latitude, location.coords.longitude, 30);
//       } else {
//         setLocationError("Location permission denied. You can still browse events without location.");
//         await fetchVideos();
//       }
//     } catch (error) {
//       console.error('Error requesting location:', error);
//       setLocationError("Failed to request location. Please try again.");
//       await fetchVideos();
//     }
//   };

//   const renderItem = ({ item, index }: { item: any; index: number }) => (
//     <View style={styles.videoContainer}>
//       <VideoPlayer uri={item.url} paused={index !== visibleVideoIndex} autoplay={true} taggedUsers={item.taggedUsers} />
//       <VideoInfo video={item} />
//       <VideoActions video={item} />
//     </View>
//   );

//   // If there are no events with videos, show the empty state
//   if (isLoading && videos.length === 0 && eventsWithVideos.length === 0) {
//     return (
//       <View style={styles.loadingContainer}>
//         <ActivityIndicator size="large" color={Colors.dark.primary} />
//         <Text style={styles.loadingText}>Finding nearby events...</Text>
//         <CartButton onPress={handleCartPress} />
//       </View>
//     );
//   }

//   if (!isLoading && eventsWithVideos.length === 0) {
//     return (
//       <View style={styles.emptyContainer}>
//         <MapPin size={50} color={Colors.dark.primary} />
//         <Text style={styles.emptyTitle}>No Events Found</Text>
//         <Text style={styles.emptyText}>Try refreshing or show all videos.</Text>

//         <TouchableOpacity style={styles.actionButton} onPress={handleRefresh}>
//           <LinearGradient
//             colors={Colors.dark.gradients.primary as [string, string]}
//             start={{ x: 0, y: 0 }}
//             end={{ x: 1, y: 1 }}
//             style={styles.gradientButton}
//           >
//             <RefreshCw size={20} color={Colors.dark.text} />
//             <Text style={styles.actionButtonText}>Refresh</Text>
//           </LinearGradient>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={styles.skipButton}
//           onPress={async () => {
//             setShowAllVideos(true);
//             await fetchVideos();
//           }}
//         >
//           <Text style={styles.skipButtonText}>Show All Videos</Text>
//         </TouchableOpacity>

//         <CartButton onPress={handleCartPress} />
//       </View>
//     );
//   }

//   return (
//     <View style={styles.container}>
//       <FlatList
//         ref={flatListRef}
//         data={videos}
//         renderItem={renderItem}
//         keyExtractor={(item) => item.id}
//         pagingEnabled
//         showsVerticalScrollIndicator={false}
//         snapToInterval={SCREEN_HEIGHT}
//         snapToAlignment="start"
//         decelerationRate="fast"
//         onViewableItemsChanged={onViewableItemsChanged}
//         viewabilityConfig={viewabilityConfig}
//         initialNumToRender={2}
//         maxToRenderPerBatch={3}
//         windowSize={5}
//         onRefresh={handleRefresh}
//         refreshing={isRefreshing}
//         contentContainerStyle={styles.flatListContent}
//       />
//       <CartButton onPress={handleCartPress} />
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   flatListContent: { flexGrow: 1 },
//   videoContainer: { height: SCREEN_HEIGHT, width: SCREEN_WIDTH, position: 'relative', flex: 1 },

//   loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background, padding: 20 },
//   loadingText: { color: Colors.dark.text, marginTop: 16, fontSize: 16, fontWeight: '500' },

//   errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background, padding: 20 },
//   errorTitle: { color: Colors.dark.text, fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 12 },
//   errorText: { color: Colors.dark.subtext, textAlign: 'center', marginBottom: 18, fontSize: 16, lineHeight: 24, maxWidth: '85%' },

//   actionButton: { borderRadius: 12, overflow: 'hidden', marginBottom: 12, elevation: 4, shadowColor: Colors.dark.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
//   gradientButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 24, gap: 10 },
//   actionButtonText: { color: Colors.dark.text, fontWeight: '600', fontSize: 16 },

//   secondaryButton: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.dark.divider, backgroundColor: Colors.dark.card, marginBottom: 10 },
//   secondaryButtonText: { color: Colors.dark.text, fontSize: 14, fontWeight: "600" },

//   skipButton: { paddingVertical: 12, paddingHorizontal: 16 },
//   skipButtonText: { color: Colors.dark.subtext, fontSize: 16 },

//   emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background, padding: 20 },
//   emptyTitle: { color: Colors.dark.text, fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 12 },
//   emptyText: { color: Colors.dark.subtext, textAlign: 'center', marginBottom: 18, fontSize: 16, lineHeight: 24, maxWidth: '80%' },
// });



















// // app/(tabs)/index.tsx (or wherever your Home index.tsx is)

// import React, { useEffect, useState, useRef } from 'react';
// import { View, StyleSheet, FlatList, Dimensions, ActivityIndicator, Text, TouchableOpacity, Alert, Platform } from 'react-native';
// import { useVideoStore } from '@/store/video-store';
// import VideoPlayer from '@/components/VideoPlayer';
// import VideoInfo from '@/components/VideoInfo';
// import VideoActions from '@/components/VideoActions';
// import CartButton from '@/components/CartButton';
// import Colors from '@/constants/colors';
// import { useRouter } from 'expo-router';
// import * as Location from 'expo-location';
// import { MapPin, RefreshCw, FileText } from 'lucide-react-native';
// import { LinearGradient } from 'expo-linear-gradient';

// const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// export default function HomeScreen() {
//   const router = useRouter();
//   const { videos, fetchVideos, setCurrentVideoIndex, isLoading, filterVideosByLocation } = useVideoStore();
//   const flatListRef = useRef<FlatList>(null);
//   const [visibleVideoIndex, setVisibleVideoIndex] = useState(0);
//   const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
//   const [locationError, setLocationError] = useState<string | null>(null);
//   const [isRefreshing, setIsRefreshing] = useState(false);
//   const [showAllVideos, setShowAllVideos] = useState(false);

//   // Request location permission and get user location
//   useEffect(() => {
//     (async () => {
//       try {
//         if (Platform.OS === 'web') {
//           await fetchVideos();
//           return;
//         }

//         // We only request foreground permission here; UI explains why.
//         const { status } = await Location.requestForegroundPermissionsAsync();

//         if (status === 'granted') {
//           const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
//           setUserLocation(location);
//           await filterVideosByLocation(location.coords.latitude, location.coords.longitude, 30);
//         } else {
//           setLocationError(
//             "Location access is optional. If enabled, we show nearby events. You can also continue without it."
//           );
//           await fetchVideos();
//         }
//       } catch (error) {
//         console.error('Error getting location:', error);
//         setLocationError("We couldn't access your location. You can continue without it or try again.");
//         await fetchVideos();
//       }
//     })();
//   }, []);

//   const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
//     if (viewableItems.length > 0) {
//       setVisibleVideoIndex(viewableItems[0].index);
//       setCurrentVideoIndex(viewableItems[0].index);
//     }
//   }).current;

//   const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

//   const handleCartPress = () => router.push('/cart');

//   const handleRefresh = async () => {
//     setIsRefreshing(true);
//     try {
//       if (userLocation && Platform.OS !== 'web' && !showAllVideos) {
//         await filterVideosByLocation(userLocation.coords.latitude, userLocation.coords.longitude, 30);
//       } else {
//         await fetchVideos();
//       }
//     } catch (error) {
//       console.error('Error refreshing videos:', error);
//       Alert.alert('Error', 'Failed to refresh videos. Please try again.');
//     } finally {
//       setIsRefreshing(false);
//     }
//   };

//   const handleRequestLocation = async () => {
//     try {
//       if (Platform.OS === 'web') {
//         setShowAllVideos(false);
//         await fetchVideos();
//         return;
//       }

//       const { status } = await Location.requestForegroundPermissionsAsync();
//       if (status === 'granted') {
//         setShowAllVideos(false);
//         const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
//         setUserLocation(location);
//         setLocationError(null);
//         await filterVideosByLocation(location.coords.latitude, location.coords.longitude, 30);
//       } else {
//         setLocationError("Location permission denied. You can still browse events without location.");
//         await fetchVideos();
//       }
//     } catch (error) {
//       console.error('Error requesting location:', error);
//       setLocationError("Failed to request location. Please try again.");
//       await fetchVideos();
//     }
//   };

//   const renderItem = ({ item, index }: { item: any; index: number }) => (
//     <View style={styles.videoContainer}>
//       <VideoPlayer uri={item.url} paused={index !== visibleVideoIndex} autoplay={true} taggedUsers={item.taggedUsers} />
//       <VideoInfo video={item} />
//       <VideoActions video={item} />
//     </View>
//   );

//   if (isLoading && videos.length === 0) {
//     return (
//       <View style={styles.loadingContainer}>
//         <ActivityIndicator size="large" color={Colors.dark.primary} />
//         <Text style={styles.loadingText}>Finding nearby events...</Text>
//         <CartButton onPress={handleCartPress} />
//       </View>
//     );
//   }

//   // ✅ Address Request (Location permission) screen for App Review screenshots
//   if (locationError && videos.length === 0 && Platform.OS !== 'web') {
//     return (
//       <View style={styles.errorContainer}>
//         <MapPin size={50} color={Colors.dark.primary} />
//         <Text style={styles.errorTitle}>Enable Location (Optional)</Text>
//         <Text style={styles.errorText}>
//           We use your location to show nearby nightlife events and improve discovery. You can skip this and still browse content.
//         </Text>

//         <TouchableOpacity style={styles.actionButton} onPress={handleRequestLocation}>
//           <LinearGradient
//             colors={Colors.dark.gradients.primary as [string, string]}
//             start={{ x: 0, y: 0 }}
//             end={{ x: 1, y: 1 }}
//             style={styles.gradientButton}
//           >
//             <Text style={styles.actionButtonText}>Enable Location</Text>
//           </LinearGradient>
//         </TouchableOpacity>

//         <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/legal/privacy')}>
//           <FileText size={18} color={Colors.dark.primary} />
//           <Text style={styles.secondaryButtonText}>Why we ask (Privacy)</Text>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={styles.skipButton}
//           onPress={async () => {
//             setShowAllVideos(true);
//             await fetchVideos();
//           }}
//         >
//           <Text style={styles.skipButtonText}>Skip (Show All Videos)</Text>
//         </TouchableOpacity>

//         <CartButton onPress={handleCartPress} />
//       </View>
//     );
//   }

//   if (!isLoading && videos.length === 0) {
//     return (
//       <View style={styles.emptyContainer}>
//         <MapPin size={50} color={Colors.dark.primary} />
//         <Text style={styles.emptyTitle}>No Events Found</Text>
//         <Text style={styles.emptyText}>Try refreshing or show all videos.</Text>

//         <TouchableOpacity style={styles.actionButton} onPress={handleRefresh}>
//           <LinearGradient
//             colors={Colors.dark.gradients.primary as [string, string]}
//             start={{ x: 0, y: 0 }}
//             end={{ x: 1, y: 1 }}
//             style={styles.gradientButton}
//           >
//             <RefreshCw size={20} color={Colors.dark.text} />
//             <Text style={styles.actionButtonText}>Refresh</Text>
//           </LinearGradient>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={styles.skipButton}
//           onPress={async () => {
//             setShowAllVideos(true);
//             await fetchVideos();
//           }}
//         >
//           <Text style={styles.skipButtonText}>Show All Videos</Text>
//         </TouchableOpacity>

//         <CartButton onPress={handleCartPress} />
//       </View>
//     );
//   }

//   return (
//     <View style={styles.container}>
//       <FlatList
//         ref={flatListRef}
//         data={videos}
//         renderItem={renderItem}
//         keyExtractor={(item) => item.id}
//         pagingEnabled
//         showsVerticalScrollIndicator={false}
//         snapToInterval={SCREEN_HEIGHT}
//         snapToAlignment="start"
//         decelerationRate="fast"
//         onViewableItemsChanged={onViewableItemsChanged}
//         viewabilityConfig={viewabilityConfig}
//         initialNumToRender={2}
//         maxToRenderPerBatch={3}
//         windowSize={5}
//         onRefresh={handleRefresh}
//         refreshing={isRefreshing}
//         contentContainerStyle={styles.flatListContent}
//       />
//       <CartButton onPress={handleCartPress} />
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },
//   flatListContent: { flexGrow: 1 },
//   videoContainer: { height: SCREEN_HEIGHT, width: SCREEN_WIDTH, position: 'relative', flex: 1 },

//   loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background, padding: 20 },
//   loadingText: { color: Colors.dark.text, marginTop: 16, fontSize: 16, fontWeight: '500' },

//   errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background, padding: 20 },
//   errorTitle: { color: Colors.dark.text, fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 12 },
//   errorText: { color: Colors.dark.subtext, textAlign: 'center', marginBottom: 18, fontSize: 16, lineHeight: 24, maxWidth: '85%' },

//   actionButton: { borderRadius: 12, overflow: 'hidden', marginBottom: 12, elevation: 4, shadowColor: Colors.dark.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
//   gradientButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 24, gap: 10 },
//   actionButtonText: { color: Colors.dark.text, fontWeight: '600', fontSize: 16 },

//   secondaryButton: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.dark.divider, backgroundColor: Colors.dark.card, marginBottom: 10 },
//   secondaryButtonText: { color: Colors.dark.text, fontSize: 14, fontWeight: "600" },

//   skipButton: { paddingVertical: 12, paddingHorizontal: 16 },
//   skipButtonText: { color: Colors.dark.subtext, fontSize: 16 },

//   emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background, padding: 20 },
//   emptyTitle: { color: Colors.dark.text, fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 12 },
//   emptyText: { color: Colors.dark.subtext, textAlign: 'center', marginBottom: 18, fontSize: 16, lineHeight: 24, maxWidth: '80%' },
// });












// import React, { useEffect, useState, useRef } from 'react';
// import { View, StyleSheet, FlatList, Dimensions, ActivityIndicator, Text, TouchableOpacity, Alert, Platform } from 'react-native';
// import { useVideoStore } from '@/store/video-store';
// import VideoPlayer from '@/components/VideoPlayer';
// import VideoInfo from '@/components/VideoInfo';
// import VideoActions from '@/components/VideoActions';
// import CartButton from '@/components/CartButton';
// import Colors from '@/constants/colors';
// import { useRouter, useFocusEffect } from 'expo-router';
// import * as Location from 'expo-location';
// import { MapPin, RefreshCw } from 'lucide-react-native';
// import { LinearGradient } from 'expo-linear-gradient';

// const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// export default function HomeScreen() {
//   const router = useRouter();
//   const { videos, fetchVideos, currentVideoIndex, setCurrentVideoIndex, isLoading, filterVideosByLocation } = useVideoStore();
//   const flatListRef = useRef<FlatList>(null);
//   const [visibleVideoIndex, setVisibleVideoIndex] = useState(0);
//   const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
//   const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
//   const [locationError, setLocationError] = useState<string | null>(null);
//   const [isRefreshing, setIsRefreshing] = useState(false);
//   const [showAllVideos, setShowAllVideos] = useState(false);
  
//   // Request location permission and get user location
//   useEffect(() => {
//     (async () => {
//       try {
//         if (Platform.OS === 'web') {
//           // On web, just fetch all videos without location filtering
//           await fetchVideos();
//           return;
//         }
        
//         const { status } = await Location.requestForegroundPermissionsAsync();
//         setLocationPermission(status === 'granted');
        
//         if (status === 'granted') {
//           const location = await Location.getCurrentPositionAsync({
//             accuracy: Location.Accuracy.Balanced
//           });
//           setUserLocation(location);
          
//           // Filter videos by location
//           await filterVideosByLocation(location.coords.latitude, location.coords.longitude, 30);
//         } else {
//           setLocationError("Location permission denied. Please enable location services to see nearby events.");
//           // Fetch all videos if location permission is denied
//           await fetchVideos();
//         }
//       } catch (error) {
//         console.error('Error getting location:', error);
//         setLocationError("Failed to get your location. Please try again.");
//         // Fetch all videos if there's an error
//         await fetchVideos();
//       }
//     })();
//   }, []);

//   // Refresh videos when screen comes into focus (e.g., after creating an event)
//   // TEMPORARILY DISABLED TO DEBUG SHOW ALL VIDEOS ISSUE
//   /*
//   useFocusEffect(
//     React.useCallback(() => {
      
//       const refreshVideos = async () => {
//         try {
//           if (userLocation && Platform.OS !== 'web' && !showAllVideos) {
//             // If we have location and user hasn't chosen to show all videos, filter by location
//             await filterVideosByLocation(userLocation.coords.latitude, userLocation.coords.longitude, 30);
//           } else {
//             // Otherwise, fetch all videos with force refresh
//             await fetchVideos();
//           }
//         } catch (error) {
//           console.error('Error refreshing videos on focus:', error);
//         }
//       };

//       // Only refresh if we already have some videos loaded (to avoid double loading on initial mount)
//       if (videos.length > 0) {
//         refreshVideos();
//       }
//     }, [userLocation, videos.length, showAllVideos])
//   );
//   */

//   const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
//     if (viewableItems.length > 0) {
//       setVisibleVideoIndex(viewableItems[0].index);
//       setCurrentVideoIndex(viewableItems[0].index);
//     }
//   }).current;

//   const viewabilityConfig = useRef({
//     itemVisiblePercentThreshold: 50
//   }).current;

//   const handleCartPress = () => {
//     router.push('/cart');
//   };

//   const handleRefresh = async () => {
//     setIsRefreshing(true);
//     try {
//       if (userLocation && Platform.OS !== 'web' && !showAllVideos) {
//         await filterVideosByLocation(userLocation.coords.latitude, userLocation.coords.longitude, 30);
//       } else {
//         await fetchVideos(); // Force refresh to get latest data
//       }
//     } catch (error) {
//       console.error('Error refreshing videos:', error);
//       Alert.alert('Error', 'Failed to refresh videos. Please try again.');
//     } finally {
//       setIsRefreshing(false);
//     }
//   };

//   const handleRequestLocation = async () => {
//     try {
//       if (Platform.OS === 'web') {
//         // On web, just fetch all videos
//         setShowAllVideos(false);
//         await fetchVideos();
//         return;
//       }
      
//       const { status } = await Location.requestForegroundPermissionsAsync();
//       if (status === 'granted') {
//         setLocationPermission(true);
//         setShowAllVideos(false); // Reset to location-based filtering
//         const location = await Location.getCurrentPositionAsync({
//           accuracy: Location.Accuracy.Balanced
//         });
//         setUserLocation(location);
//         setLocationError(null);
//         await filterVideosByLocation(location.coords.latitude, location.coords.longitude, 30);
//       } else {
//         setLocationPermission(false);
//         setLocationError("Location permission denied. Please enable location services to see nearby events.");
//         await fetchVideos();
//       }
//     } catch (error) {
//       console.error('Error requesting location:', error);
//       setLocationError("Failed to get your location. Please try again.");
//       await fetchVideos();
//     }
//   };

//   const renderItem = ({ item, index }: { item: any, index: number }) => {
//     return (
//       <View style={styles.videoContainer}>
//         <VideoPlayer 
//           uri={item.url} 
//           paused={index !== visibleVideoIndex}
//           autoplay={true}
//           taggedUsers={item.taggedUsers}
//         />
//         <VideoInfo video={item} />
//         <VideoActions video={item} />
//       </View>
//     );
//   };

//   if (isLoading && videos.length === 0) {
//     return (
//       <View style={styles.loadingContainer}>
//         <ActivityIndicator size="large" color={Colors.dark.primary} />
//         <Text style={styles.loadingText}>Finding nearby events...</Text>
//         <CartButton onPress={handleCartPress} />
//       </View>
//     );
//   }

//   if (locationError && videos.length === 0 && Platform.OS !== 'web') {
//     return (
//       <View style={styles.errorContainer}>
//         <MapPin size={50} color={Colors.dark.primary} />
//         <Text style={styles.errorTitle}>Location Access Needed</Text>
//         <Text style={styles.errorText}>{locationError}</Text>
//         <TouchableOpacity 
//           style={styles.actionButton} 
//           onPress={handleRequestLocation}
//         >
//           {Platform.OS === 'ios' || Platform.OS === 'android' ? (
//             <LinearGradient
//               colors={Colors.dark.gradients.primary as [string, string]}
//               start={{ x: 0, y: 0 }}
//               end={{ x: 1, y: 1 }}
//               style={styles.gradientButton}
//             >
//               <Text style={styles.actionButtonText}>Enable Location</Text>
//             </LinearGradient>
//           ) : (
//             <View style={[styles.gradientButton, { backgroundColor: Colors.dark.primary }]}>
//               <Text style={styles.actionButtonText}>Enable Location</Text>
//             </View>
//           )}
//         </TouchableOpacity>
//         <TouchableOpacity style={styles.skipButton} onPress={async () => {
//           setShowAllVideos(true);
//           try {
//             await fetchVideos();
//           } catch (error) {
//             // Even if fetchVideos fails, we've set showAllVideos to true
//             // The useFocusEffect is disabled, so it shouldn't interfere
//           }
//         }}>
//           <Text style={styles.skipButtonText}>Skip (Show All Videos)</Text>
//         </TouchableOpacity>
//         <CartButton onPress={handleCartPress} />
//       </View>
//     );
//   }

//   if (!isLoading && videos.length === 0) {
//     return (
//       <View style={styles.emptyContainer}>
//         <MapPin size={50} color={Colors.dark.primary} />
//         <Text style={styles.emptyTitle}>No Events Nearby</Text>
//         <Text style={styles.emptyText}>We couldn't find any events within 30km of your location.</Text>
//         <TouchableOpacity 
//           style={styles.actionButton} 
//           onPress={handleRefresh}
//         >
//           {Platform.OS === 'ios' || Platform.OS === 'android' ? (
//             <LinearGradient
//               colors={Colors.dark.gradients.primary as [string, string]}
//               start={{ x: 0, y: 0 }}
//               end={{ x: 1, y: 1 }}
//               style={styles.gradientButton}
//             >
//               <RefreshCw size={20} color={Colors.dark.text} />
//               <Text style={styles.actionButtonText}>Refresh</Text>
//             </LinearGradient>
//           ) : (
//             <View style={[styles.gradientButton, { backgroundColor: Colors.dark.primary }]}>
//               <RefreshCw size={20} color={Colors.dark.text} />
//               <Text style={styles.actionButtonText}>Refresh</Text>
//             </View>
//           )}
//         </TouchableOpacity>
//         <TouchableOpacity style={styles.skipButton} onPress={async () => {
//           setShowAllVideos(true);
//           try {
//             await fetchVideos();
//           } catch (error) {
//             // Even if fetchVideos fails, we've set showAllVideos to true
//             // The useFocusEffect is disabled, so it shouldn't interfere
//           }
//         }}>
//           <Text style={styles.skipButtonText}>Show All Videos</Text>
//         </TouchableOpacity>
//         <CartButton onPress={handleCartPress} />
//       </View>
//     );
//   }

//   return (
//     <View style={styles.container}>
//       <FlatList
//         ref={flatListRef}
//         data={videos}
//         renderItem={renderItem}
//         keyExtractor={(item) => item.id}
//         pagingEnabled
//         showsVerticalScrollIndicator={false}
//         snapToInterval={SCREEN_HEIGHT}
//         snapToAlignment="start"
//         decelerationRate="fast"
//         onViewableItemsChanged={onViewableItemsChanged}
//         viewabilityConfig={viewabilityConfig}
//         initialNumToRender={2}
//         maxToRenderPerBatch={3}
//         windowSize={5}
//         onRefresh={handleRefresh}
//         refreshing={isRefreshing}
//         contentContainerStyle={styles.flatListContent}
//       />
//       <CartButton onPress={handleCartPress} />
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   flatListContent: {
//     flexGrow: 1,
//   },
//   videoContainer: {
//     height: SCREEN_HEIGHT,
//     width: SCREEN_WIDTH,
//     position: 'relative',
//     flex:1
//   },
//   loadingContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.background,
//     padding: 20,
//   },
//   loadingText: {
//     color: Colors.dark.text,
//     marginTop: 16,
//     fontSize: 16,
//     fontWeight: '500',
//   },
//   errorContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.background,
//     padding: 20,
//   },
//   errorTitle: {
//     color: Colors.dark.text,
//     fontSize: 24,
//     fontWeight: 'bold',
//     marginTop: 20,
//     marginBottom: 12,
//   },
//   errorText: {
//     color: Colors.dark.subtext,
//     textAlign: 'center',
//     marginBottom: 32,
//     fontSize: 16,
//     lineHeight: 24,
//     maxWidth: '80%',
//   },
//   actionButton: {
//     borderRadius: 12,
//     overflow: 'hidden',
//     marginBottom: 16,
//     elevation: 4,
//     shadowColor: Colors.dark.primary,
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//   },
//   gradientButton: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     paddingVertical: 14,
//     paddingHorizontal: 24,
//   },
//   actionButtonText: {
//     color: Colors.dark.text,
//     fontWeight: '600',
//     fontSize: 16,
//     marginLeft: 8,
//   },
//   skipButton: {
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//   },
//   skipButtonText: {
//     color: Colors.dark.subtext,
//     fontSize: 16,
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.background,
//     padding: 20,
//   },
//   emptyTitle: {
//     color: Colors.dark.text,
//     fontSize: 24,
//     fontWeight: 'bold',
//     marginTop: 20,
//     marginBottom: 12,
//   },
//   emptyText: {
//     color: Colors.dark.subtext,
//     textAlign: 'center',
//     marginBottom: 32,
//     fontSize: 16,
//     lineHeight: 24,
//     maxWidth: '80%',
//   },
// });
