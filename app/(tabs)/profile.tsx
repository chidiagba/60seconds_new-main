// app/(tabs)/profile.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator, Alert, Linking } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { uploadImageToSupabase } from '@/utils/image-upload';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  Settings,
  Grid,
  Bookmark,
  Edit,
  Tag,
  Users,
  BarChart,
  UserCheck,
  FileText,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuthStore } from '@/store/auth-store';
import { useAuth } from '@/lib/auth';
import { EventQueries } from '@/lib/event-queries';
import { followService, FollowProfile, videoService, interactionService } from '@/lib/database';
import { LinearGradient } from 'expo-linear-gradient';
import OrderPDFList from '@/components/OrderPDFList';
import { useVideoStore } from '@/store/video-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActionSheet } from '@expo/react-native-action-sheet';
import VideoFrameThumbnail from '@/components/VideoFrameThumbnail';
import { formatRelativeUploadTime } from '@/utils/time';
import { resolveAvatarUrl } from '@/utils/avatar';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { userId } = params as { userId?: string };
  const requestedTab = typeof params.tab === 'string' ? params.tab : undefined;

  const {
    user: currentUser,
    followedUsers,
    followVersion,
    isFollowing,
    followUser,
    unfollowUser,
    refreshFollowedUsers,
  } = useAuthStore();

  const { user: authUser, profile: authProfile, loading: authLoading, updateProfile } = useAuth();

  // ── ALL STATE DECLARED UNCONDITIONALLY ─────────────────────────────────
  const [activeTab, setActiveTab] = useState<'videos' | 'saved' | 'following' | 'orders'>('videos');
  const [profileUser, setProfileUser] = useState(currentUser);
  const [isCurrentUserProfile, setIsCurrentUserProfile] = useState(true);
  const [followedUsersData, setFollowedUsersData] = useState<FollowProfile[]>([]);
  const [followersUsersData, setFollowersUsersData] = useState<FollowProfile[]>([]);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [userUploadedVideos, setUserUploadedVideos] = useState<any[]>([]);
  const [likedVideosData, setLikedVideosData] = useState<any[]>([]);
  const [userVideosLoading, setUserVideosLoading] = useState(false);
  const [likedVideosLoading, setLikedVideosLoading] = useState(false);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarGender, setAvatarGender] = useState<'male' | 'female' | null>(null);
  const [createdEventsCount, setCreatedEventsCount] = useState(0);
  const { showActionSheetWithOptions } = useActionSheet();

  useEffect(() => {
    if (requestedTab === 'orders' && !userId) {
      setActiveTab('orders');
    }
  }, [requestedTab, userId]);

  const { videos: allVideos, userLikedVideos, deletedVideoIds, fetchVideos, loadUserLikes, removeVideo } = useVideoStore();
  const resolvedProfileAvatar = resolveAvatarUrl({
    avatarUrl: authProfile?.avatar_url || currentUser?.avatar,
    avatarGender: (authProfile as any)?.avatar_gender ?? avatarGender,
    fallbackUrl: 'https://via.placeholder.com/150',
  });

  const getCachedUserVideos = useCallback((targetUserId?: string) => {
    if (!targetUserId) return [];
    return (allVideos || []).filter((video: any) => {
      if (!video?.id) return false;
      const ownerId = video.user_id || video.userId || video.user?.id;
      return ownerId === targetUserId;
    });
  }, [allVideos]);

  // ── ALL EFFECTS DECLARED UNCONDITIONALLY (before any conditional return) ─
  useEffect(() => {
    if (userId && userId !== authUser?.id) {
      router.replace({ pathname: '/ProfileUserScreen' as any, params: { userId } });
    } else {
      if (authUser && authProfile) {
        const realProfileUser = {
          id: authUser.id,
          name: authProfile.full_name,
          displayName: authProfile.full_name,
          username: authProfile.username,
          avatar: resolvedProfileAvatar,
          bio: authProfile.bio,
          location: authProfile.location_city,
          isBusinessAccount: authProfile.user_type === 'business',
          businessType: authProfile.business_type,
          followers: authProfile.followers_count,
          following: authProfile.following_count,
        };
        setProfileUser(realProfileUser as any);
        const profileAvatarGender = (authProfile as any).avatar_gender;
        setAvatarGender((previousGender) => {
          if (profileAvatarGender === 'male' || profileAvatarGender === 'female') {
            return profileAvatarGender;
          }

          if (authProfile.avatar_url) {
            return null;
          }

          return previousGender;
        });
        setIsCurrentUserProfile(true);
      }
    }
  }, [userId, authUser, authProfile, resolvedProfileAvatar, router]);

  // Load user's uploaded videos — runs on mount and whenever the screen is focused
  const loadUserVideos = useCallback(async () => {
    if (!authUser?.id) return;
    const cachedVideos = getCachedUserVideos(authUser.id);
    if (cachedVideos.length > 0) {
      const visibleCachedVideos = cachedVideos.filter((video: any) => video?.id && !deletedVideoIds.has(video.id));
      setUserUploadedVideos((currentVideos) => (currentVideos.length > 0 ? currentVideos : visibleCachedVideos));
    }

    setUserVideosLoading(cachedVideos.length === 0);
    try {
      const rawVideos = await videoService.getUserVideos(authUser.id);
      const visibleVideos = (rawVideos || []).filter((video: any) => video?.id && !deletedVideoIds.has(video.id));
      setUserUploadedVideos(visibleVideos);
    } catch (error) {
      console.error('Error loading user videos:', error);
    } finally {
      setUserVideosLoading(false);
    }
  }, [authUser?.id, deletedVideoIds, getCachedUserVideos]);

  useEffect(() => {
    if (!authUser?.id) return;
    const cachedVideos = getCachedUserVideos(authUser.id);
    if (cachedVideos.length > 0) {
      const visibleCachedVideos = cachedVideos.filter((video: any) => video?.id && !deletedVideoIds.has(video.id));
      setUserUploadedVideos((currentVideos) => (currentVideos.length > 0 ? currentVideos : visibleCachedVideos));
    }
  }, [authUser?.id, deletedVideoIds, getCachedUserVideos]);

  // Trigger load when auth finishes and user ID becomes available
  // (handles race where useFocusEffect fires before auth has loaded)
  useEffect(() => {
    loadUserVideos();
  }, [authUser?.id]);

  const pickAndUploadAvatar = useCallback(async () => {
    if (!authUser) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission Required',
        'Please allow photo library access to upload your profile picture.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled) return;
    try {
      setIsUploadingAvatar(true);
      const publicUrl = await uploadImageToSupabase(result.assets[0].uri, authUser.id, 'avatars');
      await updateProfile({ avatar_url: publicUrl, avatar_gender: null } as any);
      setAvatarGender(null); // uploaded photo takes priority; clear gender avatar
      
      // Sync avatar update to video feed
      const { syncUserProfile } = useVideoStore.getState();
      syncUserProfile(authUser.id, {
        avatar: publicUrl,
      });
    } catch (err) {
      Alert.alert('Upload Failed', 'Could not upload profile photo. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [authUser, updateProfile]);

  const handleGenderAvatarSelect = useCallback(async (gender: 'male' | 'female') => {
    if (!authUser) return;
    const newGender = avatarGender === gender ? null : gender; // toggle off if same
    setAvatarGender(newGender);
    try {
      // Choosing a gender avatar should replace any uploaded profile image.
      const payload = newGender
        ? ({ avatar_gender: newGender, avatar_url: null } as any)
        : ({ avatar_gender: null } as any);
      await updateProfile(payload);
      
      // Sync avatar update to video feed
      const { syncUserProfile } = useVideoStore.getState();
      syncUserProfile(authUser.id, {
        avatar: resolveAvatarUrl({
          avatarUrl: null,
          avatarGender: newGender,
          fallbackUrl: currentUser?.avatar || '',
        }),
      });
    } catch (err) {
      console.error('Error saving avatar gender:', err);
    }
  }, [authUser, avatarGender, updateProfile, currentUser?.avatar]);

  const loadLikedVideos = useCallback(async () => {
    if (!authUser?.id) {
      setLikedVideosData([]);
      return;
    }

    setLikedVideosLoading(true);
    try {
      const likedVideoIds = await interactionService.getUserLikedVideoIds(authUser.id);
      if (likedVideoIds.length === 0) {
        setLikedVideosData([]);
        return;
      }

      const videos = await videoService.getVideos();
      const likedSet = new Set(likedVideoIds);
      const liked = (videos || []).filter((video: any) => likedSet.has(video.id) && !deletedVideoIds.has(video.id));
      setLikedVideosData(liked);
    } catch (error) {
      console.warn('Unable to load liked videos:', error);
      setLikedVideosData([]);
    } finally {
      setLikedVideosLoading(false);
    }
  }, [authUser?.id, deletedVideoIds]);

  // Also reload every time the profile tab is focused (picks up newly uploaded videos)
  useFocusEffect(
    useCallback(() => {
      loadUserVideos();
      if (authUser?.id) {
        loadUserLikes(authUser.id);
        fetchVideos();
        loadLikedVideos();
      }
    }, [authUser?.id]) // intentionally omitting other functions to prevent infinite loops
  );

  // Load liked video IDs from AsyncStorage and all videos (for the saved tab)
  useEffect(() => {
    if (authUser?.id) {
      loadUserLikes(authUser.id);
      loadLikedVideos();
      fetchVideos();
    }
  }, [authUser?.id, fetchVideos, loadLikedVideos, loadUserLikes]);

  // Follow data
  useEffect(() => {
    const loadFollowData = async () => {
      if (!authUser?.id) return;
      try {
        const [following, followers, counts] = await Promise.all([
          followService.getFollowing(authUser.id),
          followService.getFollowers(authUser.id),
          followService.getFollowCounts(authUser.id),
          refreshFollowedUsers(),
        ]);
        setFollowedUsersData(following);
        setFollowersUsersData(followers);
        setFollowCounts({
          followers: counts.followersCount,
          following: counts.followingCount,
        });
      } catch (error) {
        console.error('Error loading follow data:', error);
      }
    };
    loadFollowData();
  }, [authUser?.id, followedUsers.length, followVersion]);

  useEffect(() => {
    let mounted = true;

    const loadCreatedEvents = async () => {
      if (!authUser?.id) {
        if (mounted) setCreatedEventsCount(0);
        return;
      }

      const result = await EventQueries.getUserEvents(authUser.id);
      if (!mounted) return;

      setCreatedEventsCount(result.events?.length || 0);
    };

    loadCreatedEvents();

    return () => {
      mounted = false;
    };
  }, [authUser?.id]);

  // ── DERIVED VALUES (safe after hooks) ──────────────────────────────────
  const likedVideos = (likedVideosData.length > 0
    ? likedVideosData
    : allVideos.filter(v => v?.id && userLikedVideos.has(v.id)))
    .filter(video => video?.id);
  const safeUploadedVideos = userUploadedVideos.filter(video => video?.id);
  const safeFollowers = followersUsersData.filter(user => user?.id);
  const safeFollowing = followedUsersData.filter(user => user?.id);
  const followedProfileId = profileUser?.id;
  const isFollowingProfile = !!followedProfileId && isFollowing(followedProfileId);

  const removeDeletedVideoFromLocalState = useCallback((videoId: string) => {
    setUserUploadedVideos((currentVideos) => currentVideos.filter((video) => video?.id !== videoId));
    setLikedVideosData((currentVideos) => currentVideos.filter((video) => video?.id !== videoId));
  }, []);

  const handleDeleteVideo = useCallback((videoId: string) => {
    Alert.alert('Delete video', 'This will permanently delete the video.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeletingVideoId(videoId);
            removeDeletedVideoFromLocalState(videoId);
            await removeVideo(videoId);
            await Promise.all([loadUserVideos(), loadLikedVideos(), fetchVideos()]);
          } catch (error: any) {
            await Promise.all([loadUserVideos(), loadLikedVideos(), fetchVideos()]);
            Alert.alert('Unable to delete video', error?.message || 'Please try again.');
          } finally {
            setDeletingVideoId(null);
          }
        },
      },
    ]);
  }, [fetchVideos, loadLikedVideos, loadUserVideos, removeDeletedVideoFromLocalState, removeVideo]);

  const handleOwnVideoPress = useCallback((video: any) => {
    showActionSheetWithOptions(
      {
        options: ['View', 'Edit', 'Delete', 'Cancel'],
        cancelButtonIndex: 3,
        destructiveButtonIndex: 2,
      },
      (selectedIndex?: number) => {
        if (selectedIndex === 0) {
          router.push({
            pathname: '/(tabs)',
            params: { selectedVideoId: String(video.id) },
          });
          return;
        }

        if (selectedIndex === 1) {
          router.push({
            pathname: '/upload',
            params: { editVideoId: video.id },
          });
          return;
        }

        if (selectedIndex === 2) {
          handleDeleteVideo(video.id);
        }
      }
    );
  }, [handleDeleteVideo, router, showActionSheetWithOptions]);

  // ── CONDITIONAL EARLY RETURNS (after all hooks) ────────────────────────
  if (authLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (!authUser) {
    return (
      <View style={styles.container}>
        <View style={styles.notAuthenticatedContainer}>
          <Text style={styles.notAuthenticatedTitle}>Not Signed In</Text>
          <Text style={styles.notAuthenticatedText}>Please sign in to view your profile</Text>
          <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/signin')}>
            {Platform.OS !== 'web' ? (
              <LinearGradient
                colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientButton}
              >
                <Text style={styles.actionButtonText}>Sign In</Text>
              </LinearGradient>
            ) : (
              <View style={[styles.gradientButton, { backgroundColor: Colors.dark.primary }]}>
                <Text style={styles.actionButtonText}>Sign In</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!authProfile) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading profile...</Text>
          <Text style={styles.loadingSubtext}>If this takes too long, please try refreshing the app</Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => {
              router.replace('/');
              setTimeout(() => router.push('/profile'), 100);
            }}
          >
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── HANDLERS ────────────────────────────────────────────────────────────
  const handleEditProfile = () => router.push('/edit-profile');
  const handleSettingsPress = () => router.push('/settings');
  const handleManageVouchers = () => router.push('/vouchers');
  const handleViewAnalytics = () => router.push('/business/analytics');
  const handleManageGuestLists = () => router.push('/guest-list-management');
  const handleMyEventsPress = () => router.push('/my-events');
  const handleFollowingPress = () => setActiveTab('following');
  const handleFollowersPress = () => {
    if (!authUser?.id) return;
    router.push({ pathname: '/followers', params: { userId: authUser.id } });
  };
  const handleVideosPress = () => setActiveTab('videos');
  const handleSavedPress = () => setActiveTab('saved');

  const handleUserPress = (id: string) => {
    if (id === currentUser?.id) {
      router.push('/profile');
      return;
    }
    router.push({ pathname: '/ProfileUserScreen' as any, params: { userId: id } });
  };

  const handleFollowToggle = async () => {
    if (!authUser || !profileUser?.id || isCurrentUserProfile) return;
    if (isFollowing(profileUser.id)) await unfollowUser(profileUser.id);
    else await followUser(profileUser.id);
  };

  const handleMessageUser = () => {
    if (!authUser || !profileUser?.id || isCurrentUserProfile) return;
    router.push({ pathname: '/chat/[chatId]', params: { chatId: profileUser.id } });
  };

  // ── MAIN RENDER ─────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 110, 130) }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        {isCurrentUserProfile && (
          <TouchableOpacity style={styles.settingsButton} onPress={handleSettingsPress}>
            <Settings size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.profileSection}>
        <View style={styles.avatarContainer}>
          {resolvedProfileAvatar ? (
            <Image
              source={{ uri: resolvedProfileAvatar }}
              style={styles.profileImage}
              contentFit="cover"
              transition={300}
            />
          ) : (
            <View style={styles.profileImageEmpty} />
          )}
          {authProfile.user_type === 'business' && (
            <View style={styles.businessIndicator}>
              <Text style={styles.businessIndicatorText}>PRO</Text>
            </View>
          )}
        </View>
        <View style={styles.avatarGenderPicker}>
          <Text style={styles.avatarGenderLabel}>Choose Avatar</Text>
          <View style={styles.avatarGenderButtons}>
            <TouchableOpacity
              style={[styles.avatarGenderBtn, avatarGender === 'male' && styles.avatarGenderBtnActive]}
              onPress={() => handleGenderAvatarSelect('male')}
            >
              <Text style={{ fontSize: 22 }}>👨</Text>
              <Text style={[styles.avatarGenderBtnText, avatarGender === 'male' && styles.avatarGenderBtnTextActive]}>Male</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.avatarGenderBtn, avatarGender === 'female' && styles.avatarGenderBtnActive]}
              onPress={() => handleGenderAvatarSelect('female')}
            >
              <Text style={{ fontSize: 22 }}>👩</Text>
              <Text style={[styles.avatarGenderBtnText, avatarGender === 'female' && styles.avatarGenderBtnTextActive]}>Female</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.uploadAvatarBtn}
            onPress={pickAndUploadAvatar}
            disabled={isUploadingAvatar}
          >
            {isUploadingAvatar ? (
              <ActivityIndicator size="small" color={Colors.dark.text} />
            ) : (
              <Text style={styles.uploadAvatarBtnText}>📷 Upload Profile Photo</Text>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.displayName}>{authProfile.full_name}</Text>
        <Text style={styles.username}>@{authProfile.username}</Text>

        {authProfile.location_city ? <Text style={styles.location}>📍 {authProfile.location_city}</Text> : null}
        {authProfile.bio ? <Text style={styles.bio}>{authProfile.bio}</Text> : null}

        <View style={styles.statsContainer}>
          <TouchableOpacity style={styles.statItem} onPress={handleVideosPress}>
            {userVideosLoading && safeUploadedVideos.length === 0
              ? <ActivityIndicator size="small" color={Colors.dark.primary} />
              : <Text style={styles.statValue}>{safeUploadedVideos.length}</Text>
            }
            <Text style={styles.statLabel}>Videos</Text>
          </TouchableOpacity>

          <View style={styles.statDivider} />

          <TouchableOpacity style={styles.statItem} onPress={handleFollowingPress}>
            <Text style={styles.statValue}>{followCounts.following}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </TouchableOpacity>

          <View style={styles.statDivider} />

          <TouchableOpacity style={styles.statItem} onPress={handleFollowersPress}>
            <Text style={styles.statValue}>{followCounts.followers}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonContainer}>
          {isCurrentUserProfile ? (
            <>
              <TouchableOpacity style={styles.editProfileButton} onPress={handleEditProfile}>
                <Edit size={16} color={Colors.dark.text} />
                <Text style={styles.editProfileText}>Edit Profile</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/legal')}>
                {Platform.OS !== 'web' ? (
                  <LinearGradient
                    colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.gradientButton, styles.smallButton]}
                  >
                    <Text style={styles.actionButtonText}>Legal &amp; Info</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: Colors.dark.primary }]}>
                    <Text style={styles.actionButtonText}>Legal &amp; Info</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButton} onPress={handleMyEventsPress}>
                {Platform.OS !== 'web' ? (
                  <LinearGradient
                    colors={['#F97316', '#EA580C']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.gradientButton, styles.smallButton]}
                  >
                    <FileText size={16} color={Colors.dark.text} />
                    <Text style={styles.actionButtonText}>
                      My Events{createdEventsCount > 0 ? ` (${createdEventsCount})` : ''}
                    </Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: '#F97316' }]}>
                    <FileText size={16} color={Colors.dark.text} />
                    <Text style={styles.actionButtonText}>
                      My Events{createdEventsCount > 0 ? ` (${createdEventsCount})` : ''}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              {authProfile.user_type === 'business' && (
                <>
                  <TouchableOpacity style={styles.actionButton} onPress={handleManageVouchers}>
                    {Platform.OS !== 'web' ? (
                      <LinearGradient
                        colors={Colors.dark.gradients.secondary as [string, string, ...string[]]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.gradientButton, styles.smallButton]}
                      >
                        <Tag size={16} color={Colors.dark.text} />
                        <Text style={styles.actionButtonText}>Vouchers</Text>
                      </LinearGradient>
                    ) : (
                      <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: Colors.dark.secondary }]}>
                        <Tag size={16} color={Colors.dark.text} />
                        <Text style={styles.actionButtonText}>Vouchers</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionButton} onPress={handleViewAnalytics}>
                    {Platform.OS !== 'web' ? (
                      <LinearGradient
                        colors={['#3B82F6', '#2563EB']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.gradientButton, styles.smallButton]}
                      >
                        <BarChart size={16} color={Colors.dark.text} />
                        <Text style={styles.actionButtonText}>Analytics</Text>
                      </LinearGradient>
                    ) : (
                      <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: '#3B82F6' }]}>
                        <BarChart size={16} color={Colors.dark.text} />
                        <Text style={styles.actionButtonText}>Analytics</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionButton} onPress={handleManageGuestLists}>
                    {Platform.OS !== 'web' ? (
                      <LinearGradient
                        colors={['#10B981', '#059669']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.gradientButton, styles.smallButton]}
                      >
                        <UserCheck size={16} color={Colors.dark.text} />
                        <Text style={styles.actionButtonText}>Guest Lists</Text>
                      </LinearGradient>
                    ) : (
                      <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: '#10B981' }]}>
                        <UserCheck size={16} color={Colors.dark.text} />
                        <Text style={styles.actionButtonText}>Guest Lists</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.actionButton} onPress={handleFollowToggle}>
                {isFollowingProfile ? (
                  <View style={styles.unfollowButton}>
                    <Text style={styles.unfollowButtonText}>Unfollow</Text>
                  </View>
                ) : Platform.OS !== 'web' ? (
                  <LinearGradient
                    colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.gradientButton, styles.smallButton]}
                  >
                    <Text style={styles.actionButtonText}>Follow</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: Colors.dark.primary }]}>
                    <Text style={styles.actionButtonText}>Follow</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.messageButton} onPress={handleMessageUser}>
                <Text style={styles.messageButtonText}>Message</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {authProfile.user_type === 'business' && (
          <View style={styles.businessBadge}>
            <Text style={styles.businessBadgeText}>{authProfile.business_type || 'Business Account'}</Text>
          </View>
        )}
      </View>

      {/* TABS */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity style={[styles.tab, activeTab === 'videos' && styles.activeTab]} onPress={handleVideosPress}>
          <Grid size={24} color={activeTab === 'videos' ? Colors.dark.primary : Colors.dark.inactive} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tab, activeTab === 'saved' && styles.activeTab]} onPress={handleSavedPress}>
          <Bookmark size={24} color={activeTab === 'saved' ? Colors.dark.primary : Colors.dark.inactive} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'following' && styles.activeTab]}
          onPress={handleFollowingPress}
        >
          <Users size={24} color={activeTab === 'following' ? Colors.dark.primary : Colors.dark.inactive} />
        </TouchableOpacity>

        {isCurrentUserProfile && (
          <TouchableOpacity
            style={[styles.tab, activeTab === 'orders' && styles.activeTab]}
            onPress={() => router.push('/orders')}
          >
            <FileText size={24} color={activeTab === 'orders' ? Colors.dark.primary : Colors.dark.inactive} />
          </TouchableOpacity>
        )}
      </View>

      {/* VIDEOS TAB */}
      {activeTab === 'videos' && (
        <View style={styles.videosGrid}>
          {isCurrentUserProfile && safeUploadedVideos.length > 0 ? (
            <Text style={styles.videosHint}>Tap a video to Edit or Delete</Text>
          ) : null}
          {userVideosLoading && safeUploadedVideos.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <ActivityIndicator size="large" color={Colors.dark.primary} />
              <Text style={[styles.emptyStateSubtext, { marginTop: 12 }]}>Loading videos...</Text>
            </View>
          ) : safeUploadedVideos.length > 0 ? (
            safeUploadedVideos.map((video) => (
              (() => {
                const videoUri =
                  typeof video.video_url === 'string' && video.video_url.length > 0
                    ? video.video_url
                    : typeof video.url === 'string' && video.url.length > 0
                    ? video.url
                    : '';
                return (
              <TouchableOpacity
                key={video.id}
                style={styles.videoThumbnail}
                disabled={deletingVideoId === video.id}
                onPress={() => {
                  if (isCurrentUserProfile) {
                    handleOwnVideoPress(video);
                    return;
                  }

                  router.push({
                    pathname: '/(tabs)',
                    params: { selectedVideoId: String(video.id) },
                  });
                }}
              >
                {videoUri ? (
                  <VideoFrameThumbnail
                    videoUri={videoUri}
                    fallbackUri={
                      video.thumbnail_url ||
                      video.thumbnail ||
                      'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80'
                    }
                    style={styles.thumbnailImage}
                  />
                ) : (
                  <View style={styles.videoPreviewFallback}>
                    <Text style={styles.videoPreviewFallbackText}>No preview</Text>
                  </View>
                )}
                {deletingVideoId === video.id ? (
                  <View style={styles.deletingOverlay}>
                    <ActivityIndicator size="small" color={Colors.dark.text} />
                  </View>
                ) : null}
                <View style={styles.videoStats}>
                  <Text style={styles.videoStatsText}>♥ {video.likes_count ?? video.likes ?? 0}</Text>
                  {formatRelativeUploadTime(video.createdAt || video.created_at) ? (
                    <Text style={styles.videoMetaText}>
                      Uploaded {formatRelativeUploadTime(video.createdAt || video.created_at)}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
                );
              })()
            ))
          ) : (
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateText}>No videos yet</Text>
              <Text style={styles.emptyStateSubtext}>
                {isCurrentUserProfile
                  ? 'Record or upload a video from the + tab to see it here'
                  : `${authProfile.full_name} hasn't uploaded any videos yet`}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* SAVED / LIKED TAB */}
      {activeTab === 'saved' && (
        <View style={styles.videosGrid}>
          {likedVideosLoading ? (
            <View style={styles.emptyStateContainer}>
              <ActivityIndicator size="large" color={Colors.dark.primary} />
              <Text style={[styles.emptyStateSubtext, { marginTop: 12 }]}>Loading liked videos...</Text>
            </View>
          ) : likedVideos.length > 0 ? (
            likedVideos.map((video) => (
              <TouchableOpacity
                key={video.id}
                style={styles.videoThumbnail}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)',
                    params: { selectedVideoId: String(video.id) },
                  })
                }
              >
                {video.video_url || video.url ? (
                  <VideoFrameThumbnail
                    videoUri={video.video_url || video.url || undefined}
                    fallbackUri={
                      video.thumbnail_url ||
                      video.thumbnail ||
                      'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80'
                    }
                    style={styles.thumbnailImage}
                  />
                ) : (
                  <View style={styles.videoPreviewFallback}>
                    <Text style={styles.videoPreviewFallbackText}>No preview</Text>
                  </View>
                )}
                <View style={styles.videoStats}>
                  <Text style={styles.videoStatsText}>♥ {video.likes_count ?? video.likes ?? 0}</Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateText}>No liked videos</Text>
              <Text style={styles.emptyStateSubtext}>
                Tap the heart on any video in the home feed to save it here
              </Text>
            </View>
          )}
        </View>
      )}

      {/* FOLLOWING TAB */}
      {activeTab === 'following' && (
        <View style={styles.followingContainer}>
          {isCurrentUserProfile ? (
            <>
              <Text style={styles.followSectionTitle}>Followers</Text>
              {safeFollowers.length > 0 ? (
                safeFollowers.map((u) => (
                  <TouchableOpacity key={`follower-${u.id}`} style={styles.followedUserItem} onPress={() => handleUserPress(u.id)}>
                    <Image
                      source={{ uri: u.avatar_url || 'https://via.placeholder.com/150' }}
                      style={styles.followedUserAvatar}
                      contentFit="cover"
                      transition={300}
                    />
                    <View style={styles.followedUserInfo}>
                      <Text style={styles.followedUserName}>{u.full_name || 'User'}</Text>
                      <Text style={styles.followedUserUsername}>@{u.username || 'user'}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.followSectionEmpty}>No followers yet</Text>
              )}

              <Text style={[styles.followSectionTitle, { marginTop: 18 }]}>Following</Text>
              {safeFollowing.length > 0 ? (
                safeFollowing.map((u) => (
                  <TouchableOpacity key={`following-${u.id}`} style={styles.followedUserItem} onPress={() => handleUserPress(u.id)}>
                    <Image
                      source={{ uri: u.avatar_url || 'https://via.placeholder.com/150' }}
                      style={styles.followedUserAvatar}
                      contentFit="cover"
                      transition={300}
                    />
                    <View style={styles.followedUserInfo}>
                      <Text style={styles.followedUserName}>{u.full_name || 'User'}</Text>
                      <Text style={styles.followedUserUsername}>@{u.username || 'user'}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.followSectionEmpty}>Not following anyone</Text>
              )}
            </>
          ) : (
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateText}>Following list not available</Text>
              <Text style={styles.emptyStateSubtext}>You can only view your own following list</Text>
            </View>
          )}
        </View>
      )}

      {activeTab === 'orders' && isCurrentUserProfile && <OrderPDFList userId={authUser?.id || ''} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
    marginTop: 40,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: Colors.dark.primary,
  },
  profileImageEmpty: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
  },
  businessIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: Colors.dark.secondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  businessIndicatorText: {
    color: Colors.dark.text,
    fontSize: 10,
    fontWeight: 'bold',
  },
  displayName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  username: {
    fontSize: 16,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },
  location: {
    fontSize: 14,
    color: Colors.dark.primary,
    marginBottom: 16,
    fontWeight: '500',
  },
  bio: {
    fontSize: 15,
    color: Colors.dark.text,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '80%',
    marginBottom: 24,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  statDivider: {
    width: 1,
    height: '60%',
    backgroundColor: Colors.dark.divider,
    alignSelf: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  editProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  editProfileText: {
    color: Colors.dark.text,
    marginLeft: 8,
    fontWeight: '500',
  },
  actionButton: {
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  smallButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  actionButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
    fontSize: 15,
    marginLeft: 8,
  },
  unfollowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    borderRadius: 12,
  },
  unfollowButtonText: {
    color: Colors.dark.primary,
    fontWeight: '600',
    fontSize: 15,
  },
  messageButton: {
    backgroundColor: Colors.dark.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  messageButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
    fontSize: 15,
  },
  businessBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  businessBadgeText: {
    color: Colors.dark.secondary,
    fontWeight: '600',
    fontSize: 13,
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.dark.primary,
  },
  videosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 2,
  },
  videosHint: {
    width: '100%',
    paddingHorizontal: 8,
    paddingVertical: 8,
    color: Colors.dark.subtext,
    fontSize: 12,
    textAlign: 'center',
  },
  videoThumbnail: {
    width: '33.33%',
    aspectRatio: 1,
    padding: 2,
    position: 'relative',
    overflow: 'hidden',
  },
  avatarGenderPicker: {
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarGenderLabel: {
    color: Colors.dark.subtext,
    fontSize: 13,
    marginBottom: 6,
  },
  avatarGenderButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  avatarGenderBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
  },
  avatarGenderBtnActive: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(99,102,241,0.15)',
  },
  avatarGenderBtnText: {
    color: Colors.dark.subtext,
    fontSize: 13,
    fontWeight: '500',
  },
  avatarGenderBtnTextActive: {
    color: Colors.dark.primary,
  },
  uploadAvatarBtn: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(99,102,241,0.12)',
    alignItems: 'center',
    minWidth: 180,
  },
  uploadAvatarBtnText: {
    color: Colors.dark.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  videoPreviewFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: Colors.dark.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPreviewFallbackText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    fontWeight: '500',
  },
  deletingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoStats: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 6,
    alignItems: 'center',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  videoStatsText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: '500',
  },
  videoMetaText: {
    color: Colors.dark.subtext,
    fontSize: 10,
    marginTop: 2,
  },
  emptyStateContainer: {
    width: '100%',
    padding: 40,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 15,
    color: Colors.dark.subtext,
    textAlign: 'center',
    lineHeight: 22,
  },
  followingContainer: {
    padding: 16,
  },
  followedUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  followedUserAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 16,
  },
  followedUserInfo: {
    flex: 1,
  },
  followedUserName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  followedUserUsername: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  followSectionTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  followSectionEmpty: {
    color: Colors.dark.inactive,
    fontSize: 14,
    marginBottom: 8,
  },
  notAuthenticatedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    marginTop: 100,
  },
  notAuthenticatedTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  notAuthenticatedText: {
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    marginTop: 100,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  loadingSubtext: {
    fontSize: 14,
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  refreshButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '600',
  },
});












// import React, { useState, useEffect } from 'react';
// import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
// import { Image } from 'expo-image';
// import { useRouter, useLocalSearchParams } from 'expo-router';
// import { Settings, Grid, Bookmark, Edit, Tag, Users, BarChart, UserCheck, Bell, FileText } from 'lucide-react-native';
// import Colors from '@/constants/colors';
// import { useAuthStore } from '@/store/auth-store';
// import { useAuth } from '@/lib/auth';
// import { mockVideos } from '@/mocks/videos';
// import { mockUsers } from '@/mocks/users';
// import { LinearGradient } from 'expo-linear-gradient';
// import GuestListNotifications from '@/components/GuestListNotifications';
// import OrderPDFList from '@/components/OrderPDFList';

// export default function ProfileScreen() {
//   const router = useRouter();
//   const params = useLocalSearchParams();
//   const { userId } = params;
  
//   const { user: currentUser, followedUsers, isFollowing, followUser, unfollowUser, isAuthenticated } = useAuthStore();
//   const { user: authUser, profile: authProfile, loading: authLoading } = useAuth();
//   const [activeTab, setActiveTab] = useState('videos'); // 'videos', 'saved', 'following', 'orders'
//   const [profileUser, setProfileUser] = useState(currentUser);
//   const [isCurrentUserProfile, setIsCurrentUserProfile] = useState(true);
//   const [showNotifications, setShowNotifications] = useState(false);
  
//   useEffect(() => {
//     if (userId && userId !== authUser?.id) {
//       // If viewing someone else's profile - for now redirect to own profile
//       // TODO: Implement viewing other users' profiles
//       router.replace('/profile');
//     } else {
//       // Viewing own profile - use real Supabase data
//       if (authUser && authProfile) {
//         // Create a profile user object from Supabase data
//         const realProfileUser = {
//           id: authUser.id,
//           name: authProfile.full_name,
//           displayName: authProfile.full_name,
//           username: authProfile.username,
//           avatar: authProfile.avatar_url || "https://via.placeholder.com/150",
//           bio: authProfile.bio,
//           location: authProfile.location_city,
//           isBusinessAccount: authProfile.user_type === 'business',
//           businessType: authProfile.business_type,
//           followers: authProfile.followers_count,
//           following: authProfile.following_count,
//         };
//         setProfileUser(realProfileUser);
//         setIsCurrentUserProfile(true);
//       }
//     }
//   }, [userId, authUser, authProfile]);
  
//   // Show loading state while auth is initializing
//   if (authLoading) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <Text style={styles.loadingText}>Loading...</Text>
//         </View>
//       </View>
//     );
//   }

//   // Show not authenticated if no user after loading is complete
//   if (!authUser) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.notAuthenticatedContainer}>
//           <Text style={styles.notAuthenticatedTitle}>Not Signed In</Text>
//           <Text style={styles.notAuthenticatedText}>
//             Please sign in to view your profile
//           </Text>
//           <TouchableOpacity 
//             style={styles.actionButton}
//             onPress={() => router.push('/signin')}
//           >
//             {Platform.OS !== 'web' ? (
//               <LinearGradient
//                 colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
//                 start={{ x: 0, y: 0 }}
//                 end={{ x: 1, y: 1 }}
//                 style={styles.gradientButton}
//               >
//                 <Text style={styles.actionButtonText}>Sign In</Text>
//               </LinearGradient>
//             ) : (
//               <View style={[styles.gradientButton, { backgroundColor: Colors.dark.primary }]}>
//                 <Text style={styles.actionButtonText}>Sign In</Text>
//               </View>
//             )}
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   }

//   // If user is authenticated but profile is still loading, show a brief loading state
//   // But also provide a fallback with basic user info
//   if (!authProfile) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <Text style={styles.loadingText}>Loading profile...</Text>
//           <Text style={styles.loadingSubtext}>
//             If this takes too long, please try refreshing the app
//           </Text>
//           <TouchableOpacity 
//             style={styles.refreshButton}
//             onPress={() => {
//               // Force refresh by navigating away and back
//               router.replace('/');
//               setTimeout(() => router.push('/profile'), 100);
//             }}
//           >
//             <Text style={styles.refreshButtonText}>Refresh</Text>
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   }
  
//   // Filter videos to show only user's videos
//   const userVideos = mockVideos.filter(video => video.userId === authUser.id);
  
//   // Get followed users' data
//   const followedUsersData = mockUsers
//     .filter(user => followedUsers.includes(user.id))
//     .filter((user, index, self) => 
//       index === self.findIndex((u) => u.id === user.id)
//     );
  
//   const handleEditProfile = () => {
//     // Navigate to edit profile screen
//     router.push('/edit-profile');
//   };
  
//   const handleSettingsPress = () => {
//     // Navigate to settings screen
//     router.push('/settings');
//   };
  
//   const handleManageVouchers = () => {
//     router.push('/vouchers');
//   };
  
//   const handleViewAnalytics = () => {
//     router.push('/business/analytics');
//   };
  
//   const handleManageGuestLists = () => {
//     router.push('/guest-list-management');
//   };
  
//   const handleFollowingPress = () => {
//     setActiveTab('following');
//   };
  
//   const handleVideosPress = () => {
//     setActiveTab('videos');
//   };
  
//   const handleSavedPress = () => {
//     setActiveTab('saved');
//   };
  
//   const handleUserPress = (userId: string) => {
//     if (userId === currentUser?.id) {
//       // If clicking on own profile, just reset to current user view
//       router.push('/profile');
//       return;
//     }
    
//     router.push({
//       pathname: '/profile',
//       params: { userId }
//     });
//   };
  
//   const handleFollowToggle = () => {
//     if (!authUser) return;
    
//     if (isFollowing(authUser.id)) {
//       unfollowUser(authUser.id);
//     } else {
//       followUser(authUser.id);
//     }
//   };
  
//   const handleMessageUser = () => {
//     if (!authUser) return;
    
//     router.push({
//       pathname: '/chat/[chatId]',
//       params: { chatId: authUser.id }
//     });
//   };
  
//   return (
//     <ScrollView style={styles.container}>
//       <View style={styles.header}>
//         {isCurrentUserProfile && (
//           <TouchableOpacity style={styles.settingsButton} onPress={handleSettingsPress}>
//             <Settings size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//         )}
//       </View>
      
//       <View style={styles.profileSection}>
//         <View style={styles.avatarContainer}>
//           <Image
//             source={{ uri: authProfile.avatar_url || "https://via.placeholder.com/150" }}
//             style={styles.profileImage}
//             contentFit="cover"
//             transition={300}
//           />
//           {authProfile.user_type === 'business' && (
//             <View style={styles.businessIndicator}>
//               <Text style={styles.businessIndicatorText}>PRO</Text>
//             </View>
//           )}
//         </View>
        
//         <Text style={styles.displayName}>
//           {authProfile.full_name}
//         </Text>
//         <Text style={styles.username}>
//           @{authProfile.username}
//         </Text>
        
//         {authProfile.location_city && (
//           <Text style={styles.location}>📍 {authProfile.location_city}</Text>
//         )}
        
//         {authProfile.bio && <Text style={styles.bio}>{authProfile.bio}</Text>}
        
//         <View style={styles.statsContainer}>
//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{userVideos.length}</Text>
//             <Text style={styles.statLabel}>Videos</Text>
//           </View>
//           <View style={styles.statDivider} />
//           <TouchableOpacity style={styles.statItem} onPress={handleFollowingPress}>
//             <Text style={styles.statValue}>{authProfile.following_count}</Text>
//             <Text style={styles.statLabel}>Following</Text>
//           </TouchableOpacity>
//           <View style={styles.statDivider} />
//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{authProfile.followers_count}</Text>
//             <Text style={styles.statLabel}>Followers</Text>
//           </View>
//         </View>
        
//         <View style={styles.buttonContainer}>
//           {isCurrentUserProfile ? (
//             <>
//               <TouchableOpacity style={styles.editProfileButton} onPress={handleEditProfile}>
//                 <Edit size={16} color={Colors.dark.text} />
//                 <Text style={styles.editProfileText}>Edit Profile</Text>
//               </TouchableOpacity>
              
//               {authProfile.user_type === 'business' && (
//                 <>
//                   <TouchableOpacity 
//                     style={styles.actionButton}
//                     onPress={handleManageVouchers}
//                   >
//                     {Platform.OS !== 'web' ? (
//                       <LinearGradient
//                         colors={Colors.dark.gradients.secondary as [string, string, ...string[]]}
//                         start={{ x: 0, y: 0 }}
//                         end={{ x: 1, y: 1 }}
//                         style={[styles.gradientButton, styles.smallButton]}
//                       >
//                         <Tag size={16} color={Colors.dark.text} />
//                         <Text style={styles.actionButtonText}>Vouchers</Text>
//                       </LinearGradient>
//                     ) : (
//                       <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: Colors.dark.secondary }]}>
//                         <Tag size={16} color={Colors.dark.text} />
//                         <Text style={styles.actionButtonText}>Vouchers</Text>
//                       </View>
//                     )}
//                   </TouchableOpacity>
                  
//                   <TouchableOpacity 
//                     style={styles.actionButton}
//                     onPress={handleViewAnalytics}
//                   >
//                     {Platform.OS !== 'web' ? (
//                       <LinearGradient
//                         colors={['#3B82F6', '#2563EB']}
//                         start={{ x: 0, y: 0 }}
//                         end={{ x: 1, y: 1 }}
//                         style={[styles.gradientButton, styles.smallButton]}
//                       >
//                         <BarChart size={16} color={Colors.dark.text} />
//                         <Text style={styles.actionButtonText}>Analytics</Text>
//                       </LinearGradient>
//                     ) : (
//                       <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: '#3B82F6' }]}>
//                         <BarChart size={16} color={Colors.dark.text} />
//                         <Text style={styles.actionButtonText}>Analytics</Text>
//                       </View>
//                     )}
//                   </TouchableOpacity>
                  
//                   <TouchableOpacity 
//                     style={styles.actionButton}
//                     onPress={handleManageGuestLists}
//                   >
//                     {Platform.OS !== 'web' ? (
//                       <LinearGradient
//                         colors={['#10B981', '#059669']}
//                         start={{ x: 0, y: 0 }}
//                         end={{ x: 1, y: 1 }}
//                         style={[styles.gradientButton, styles.smallButton]}
//                       >
//                         <UserCheck size={16} color={Colors.dark.text} />
//                         <Text style={styles.actionButtonText}>Guest Lists</Text>
//                       </LinearGradient>
//                     ) : (
//                       <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: '#10B981' }]}>
//                         <UserCheck size={16} color={Colors.dark.text} />
//                         <Text style={styles.actionButtonText}>Guest Lists</Text>
//                       </View>
//                     )}
//                   </TouchableOpacity>
//                 </>
//               )}
//             </>
//           ) : (
//             <>
//               <TouchableOpacity 
//                 style={styles.actionButton}
//                 onPress={handleFollowToggle}
//               >
//                 {isFollowing(authUser.id) ? (
//                   <View style={styles.unfollowButton}>
//                     <Text style={styles.unfollowButtonText}>Unfollow</Text>
//                   </View>
//                 ) : Platform.OS !== 'web' ? (
//                   <LinearGradient
//                     colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
//                     start={{ x: 0, y: 0 }}
//                     end={{ x: 1, y: 1 }}
//                     style={[styles.gradientButton, styles.smallButton]}
//                   >
//                     <Text style={styles.actionButtonText}>Follow</Text>
//                   </LinearGradient>
//                 ) : (
//                   <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: Colors.dark.primary }]}>
//                     <Text style={styles.actionButtonText}>Follow</Text>
//                   </View>
//                 )}
//               </TouchableOpacity>
              
//               <TouchableOpacity 
//                 style={styles.messageButton} 
//                 onPress={handleMessageUser}
//               >
//                 <Text style={styles.messageButtonText}>Message</Text>
//               </TouchableOpacity>
//             </>
//           )}
//         </View>
        
//         {authProfile.user_type === 'business' && (
//           <View style={styles.businessBadge}>
//             <Text style={styles.businessBadgeText}>
//               {authProfile.business_type || 'Business Account'}
//             </Text>
//           </View>
//         )}
//       </View>
      
//       <View style={styles.tabsContainer}>
//         <TouchableOpacity 
//           style={[styles.tab, activeTab === 'videos' && styles.activeTab]}
//           onPress={handleVideosPress}
//         >
//           <Grid size={24} color={activeTab === 'videos' ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>
//         <TouchableOpacity 
//           style={[styles.tab, activeTab === 'saved' && styles.activeTab]}
//           onPress={handleSavedPress}
//         >
//           <Bookmark size={24} color={activeTab === 'saved' ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>
//         <TouchableOpacity 
//           style={[styles.tab, activeTab === 'following' && styles.activeTab]}
//           onPress={handleFollowingPress}
//         >
//           <Users size={24} color={activeTab === 'following' ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>
//         {isCurrentUserProfile && (
//           <TouchableOpacity 
//             style={[styles.tab, activeTab === 'orders' && styles.activeTab]}
//             onPress={() => setActiveTab('orders')}
//           >
//             <FileText size={24} color={activeTab === 'orders' ? Colors.dark.primary : Colors.dark.inactive} />
//           </TouchableOpacity>
//         )}
//       </View>
      
//       {activeTab === 'videos' && (
//         <View style={styles.videosGrid}>
//           {userVideos.length > 0 ? (
//             userVideos.map(video => (
//               <TouchableOpacity 
//                 key={video.id} 
//                 style={styles.videoThumbnail}
//                 onPress={() => router.push({
//                   pathname: '/event/[id]',
//                   params: { id: video.id }
//                 })}
//               >
//                 <Image
//                   source={{ uri: video.thumbnail }}
//                   style={styles.thumbnailImage}
//                   contentFit="cover"
//                   transition={300}
//                 />
//                 <View style={styles.videoStats}>
//                   <Text style={styles.videoStatsText}>{video.likes} likes</Text>
//                 </View>
//               </TouchableOpacity>
//             ))
//           ) : (
//             <View style={styles.emptyStateContainer}>
//               <Text style={styles.emptyStateText}>No videos yet</Text>
//               <Text style={styles.emptyStateSubtext}>
//                 {isCurrentUserProfile 
//                   ? "Your uploaded videos will appear here" 
//                   : `${authProfile.full_name} hasn't uploaded any videos yet`}
//               </Text>
//             </View>
//           )}
//         </View>
//       )}
      
//       {activeTab === 'saved' && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>No saved videos</Text>
//           <Text style={styles.emptyStateSubtext}>
//             Videos you save will appear here
//           </Text>
//         </View>
//       )}
      
//       {activeTab === 'following' && (
//         <View style={styles.followingContainer}>
//           {isCurrentUserProfile ? (
//             followedUsersData.length > 0 ? (
//               followedUsersData.map(user => (
//                 <TouchableOpacity 
//                   key={user.id} 
//                   style={styles.followedUserItem}
//                   onPress={() => handleUserPress(user.id)}
//                 >
//                   <Image
//                     source={{ uri: user.avatar }}
//                     style={styles.followedUserAvatar}
//                     contentFit="cover"
//                     transition={300}
//                   />
//                   <View style={styles.followedUserInfo}>
//                     <Text style={styles.followedUserName}>{user.displayName || user.name}</Text>
//                     <Text style={styles.followedUserUsername}>@{user.username}</Text>
//                   </View>
//                 </TouchableOpacity>
//               ))
//             ) : (
//               <View style={styles.emptyStateContainer}>
//                 <Text style={styles.emptyStateText}>Not following anyone</Text>
//                 <Text style={styles.emptyStateSubtext}>
//                   Users you follow will appear here
//                 </Text>
//               </View>
//             )
//           ) : (
//             <View style={styles.emptyStateContainer}>
//               <Text style={styles.emptyStateText}>Following list not available</Text>
//               <Text style={styles.emptyStateSubtext}>
//                 You can only view your own following list
//               </Text>
//             </View>
//           )}
//         </View>
//       )}
      
//       {activeTab === 'orders' && isCurrentUserProfile && (
//         <OrderPDFList userId={authUser?.id || ''} />
//       )}
//     </ScrollView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'flex-end',
//     padding: 16,
//     marginTop:40
//   },
//   settingsButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   profileSection: {
//     alignItems: 'center',
//     paddingHorizontal: 20,
//     marginBottom: 20,
//   },
//   avatarContainer: {
//     position: 'relative',
//     marginBottom: 16,
//   },
//   profileImage: {
//     width: 100,
//     height: 100,
//     borderRadius: 50,
//     borderWidth: 3,
//     borderColor: Colors.dark.primary,
//   },
//   businessIndicator: {
//     position: 'absolute',
//     bottom: 0,
//     right: 0,
//     backgroundColor: Colors.dark.secondary,
//     paddingHorizontal: 8,
//     paddingVertical: 4,
//     borderRadius: 10,
//   },
//   businessIndicatorText: {
//     color: Colors.dark.text,
//     fontSize: 10,
//     fontWeight: 'bold',
//   },
//   displayName: {
//     fontSize: 24,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   username: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//   },
//   location: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//     marginBottom: 16,
//     fontWeight: '500',
//   },
//   bio: {
//     fontSize: 15,
//     color: Colors.dark.text,
//     textAlign: 'center',
//     marginBottom: 20,
//     paddingHorizontal: 20,
//     lineHeight: 22,
//   },
//   statsContainer: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     width: '80%',
//     marginBottom: 24,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 16,
//     paddingVertical: 16,
//     paddingHorizontal: 8,
//   },
//   statItem: {
//     alignItems: 'center',
//     flex: 1,
//   },
//   statValue: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   statLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   statDivider: {
//     width: 1,
//     height: '60%',
//     backgroundColor: Colors.dark.divider,
//     alignSelf: 'center',
//   },
//   buttonContainer: {
//     flexDirection: 'row',
//     marginBottom: 20,
//     flexWrap: 'wrap',
//     justifyContent: 'center',
//     gap: 12,
//   },
//   editProfileButton: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.card,
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderRadius: 12,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   editProfileText: {
//     color: Colors.dark.text,
//     marginLeft: 8,
//     fontWeight: '500',
//   },
//   actionButton: {
//     borderRadius: 12,
//     overflow: 'hidden',
//     elevation: 4,
//     shadowColor: Colors.dark.primary,
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.2,
//     shadowRadius: 8,
//   },
//   gradientButton: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     paddingVertical: 14,
//     paddingHorizontal: 24,
//   },
//   smallButton: {
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//   },
//   actionButtonText: {
//     color: Colors.dark.text,
//     fontWeight: '600',
//     fontSize: 15,
//     marginLeft: 8,
//   },
//   unfollowButton: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//     borderRadius: 12,
//   },
//   unfollowButtonText: {
//     color: Colors.dark.primary,
//     fontWeight: '600',
//     fontSize: 15,
//   },
//   messageButton: {
//     backgroundColor: Colors.dark.card,
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderRadius: 12,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   messageButtonText: {
//     color: Colors.dark.text,
//     fontWeight: '500',
//     fontSize: 15,
//   },
//   businessBadge: {
//     backgroundColor: 'rgba(16, 185, 129, 0.1)',
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     borderRadius: 12,
//     marginBottom: 16,
//     borderWidth: 1,
//     borderColor: 'rgba(16, 185, 129, 0.3)',
//   },
//   businessBadgeText: {
//     color: Colors.dark.secondary,
//     fontWeight: '600',
//     fontSize: 13,
//   },
//   tabsContainer: {
//     flexDirection: 'row',
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   tab: {
//     flex: 1,
//     alignItems: 'center',
//     paddingVertical: 16,
//   },
//   activeTab: {
//     borderBottomWidth: 2,
//     borderBottomColor: Colors.dark.primary,
//   },
//   videosGrid: {
//     flexDirection: 'row',
//     flexWrap: 'wrap',
//     padding: 2,
//   },
//   videoThumbnail: {
//     width: '33.33%',
//     aspectRatio: 1,
//     padding: 2,
//     position: 'relative',
//   },
//   thumbnailImage: {
//     width: '100%',
//     height: '100%',
//     borderRadius: 8,
//   },
//   videoStats: {
//     position: 'absolute',
//     bottom: 0,
//     left: 0,
//     right: 0,
//     backgroundColor: 'rgba(0, 0, 0, 0.5)',
//     padding: 6,
//     alignItems: 'center',
//     borderBottomLeftRadius: 8,
//     borderBottomRightRadius: 8,
//   },
//   videoStatsText: {
//     color: Colors.dark.text,
//     fontSize: 12,
//     fontWeight: '500',
//   },
//   emptyStateContainer: {
//     width: '100%',
//     padding: 40,
//     alignItems: 'center',
//   },
//   emptyStateText: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   emptyStateSubtext: {
//     fontSize: 15,
//     color: Colors.dark.subtext,
//     textAlign: 'center',
//     lineHeight: 22,
//   },
//   errorText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     textAlign: 'center',
//     marginTop: 40,
//   },
//   followingContainer: {
//     padding: 16,
//   },
//   followedUserItem: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     paddingVertical: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   followedUserAvatar: {
//     width: 50,
//     height: 50,
//     borderRadius: 25,
//     marginRight: 16,
//   },
//   followedUserInfo: {
//     flex: 1,
//   },
//   followedUserName: {
//     fontSize: 16,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   followedUserUsername: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   notAuthenticatedContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     padding: 20,
//     marginTop: 100,
//   },
//   notAuthenticatedTitle: {
//     fontSize: 28,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//     marginBottom: 16,
//   },
//   notAuthenticatedText: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: 'center',
//     marginBottom: 32,
//     lineHeight: 24,
//   },
//   loadingContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     padding: 20,
//     marginTop: 100,
//   },
//   loadingText: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   loadingSubtext: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     textAlign: 'center',
//     marginBottom: 24,
//     lineHeight: 20,
//   },
//   refreshButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//   },
//   refreshButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: '600',
//   },
// });
