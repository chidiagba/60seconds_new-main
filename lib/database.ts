import {loadTicketSellers} from './ticket-seller';
import { videoVenueCoordinates } from '@/utils/venue-location';
import { profileSearchFilter } from './profile-search';
import { logger } from '@/lib/logger';
import Constants from 'expo-constants';
import { createVideoFeedLoader } from './video-feed';
import { Platform } from 'react-native';
import { supabase, Database } from './supabase';
import { mockVideos } from '@/mocks/videos';
import { resolveCurrencyFromCountry } from '@/utils/country-currency';
import { isLegacyVoucherSchemaError, legacyVoucherFields } from '@/utils/voucher-fields';

const loadVideoFeed = createVideoFeedLoader(supabase);

type Tables = Database['public']['Tables'];
type Profile = Tables['profiles']['Row'];
type Video = Tables['videos']['Row'];
type Order = Tables['orders']['Row'];
type TicketReceipt = Tables['ticket_receipts']['Row'];
type Event = Tables['events']['Row'];
type Voucher = Tables['vouchers']['Row'];
type Reservation = Tables['reservations']['Row'];
type Follow = Tables['follows']['Row'];

const PUBLIC_OPEN_EVENT_STATUSES = ['published', 'open'];

const normalizeUsernameSeed = (input: string) => {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
};

async function ensureAuthenticatedProfileExists() {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('User must be authenticated');
  }

  const { data: existingProfile, error: profileReadError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileReadError) {
    throw profileReadError;
  }

  if (existingProfile?.id) {
    return user;
  }

  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const email = (user.email || `${user.id}@example.com`).toLowerCase();
  const emailPrefix = email.split('@')[0] || 'user';

  // Only use the username from metadata (given by user during signup)
  const targetUsername = typeof metadata.username === 'string' ? metadata.username.trim() : emailPrefix;

  const country = typeof metadata.country === 'string' ? metadata.country : null;
  const countryCode = typeof metadata.country_code === 'string' ? metadata.country_code : null;
  const metadataCurrency = typeof metadata.currency === 'string' ? metadata.currency : null;
  const resolvedCurrency = resolveCurrencyFromCountry({
    country,
    countryCode,
    fallbackCurrency: metadataCurrency || 'USD',
  });

  const profileInsertBase = {
    id: user.id,
    email,
    full_name:
      (typeof metadata.full_name === 'string' && metadata.full_name.trim()) ||
      emailPrefix ||
      'User',
    username: targetUsername,
    user_type: metadata.user_type === 'business' ? 'business' : 'private',
    followers_count: 0,
    following_count: 0,
    business_name: typeof metadata.business_name === 'string' ? metadata.business_name : null,
    business_type: typeof metadata.business_type === 'string' ? metadata.business_type : null,
    country,
    country_code: countryCode,
    location_city: typeof metadata.location_city === 'string' ? metadata.location_city.trim() : null,
    currency: resolvedCurrency,
    avatar_url: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
  } as const;

  const { error: insertError } = await supabase
    .from('profiles')
    .insert(profileInsertBase);

  if (insertError) {
    // If conflict on ID, means profile was created while we were checking. Just return.
    if (insertError.code === '23505' && insertError.message?.includes('profiles_pkey')) {
      return user;
    }

    logger.error('Failed to create profile:', insertError.message);
    throw insertError;
  }

  return user;
}

export type FollowProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  user_type: string | null;
  business_type: string | null;
  followers_count: number | null;
  following_count: number | null;
};

const PROFILE_SELECT_WITH_AVATAR_GENDER =
  'id, username, full_name, avatar_url, avatar_gender, user_type, followers_count, following_count, bio, business_name, business_type';
const PROFILE_SELECT_LEGACY =
  'id, username, full_name, avatar_url, user_type, followers_count, following_count, bio, business_name, business_type';

const isMissingAvatarGenderSelectError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' || message.includes('avatar_gender');
};

async function fetchProfileForVideoById(userId: string) {
  const withGender = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_WITH_AVATAR_GENDER)
    .eq('id', userId)
    .maybeSingle();

  if (!withGender.error) {
    return { data: withGender.data, error: null as any };
  }

  if (!isMissingAvatarGenderSelectError(withGender.error)) {
    logger.warn('Unable to fetch video profile:', withGender.error);
    return { data: null, error: null as any };
  }

  const legacy = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_LEGACY)
    .eq('id', userId)
    .maybeSingle();

  if (legacy.error) {
    logger.warn('Unable to fetch legacy video profile:', legacy.error);
    return { data: null, error: null as any };
  }

  return { data: legacy.data, error: null as any };
}

async function fetchProfilesForVideoByIds(userIds: string[]) {
  if (userIds.length === 0) {
    return { data: [], error: null as any };
  }

  const withGender = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_WITH_AVATAR_GENDER)
    .in('id', userIds);

  if (!withGender.error) {
    return { data: withGender.data || [], error: null as any };
  }

  if (!isMissingAvatarGenderSelectError(withGender.error)) {
    logger.warn('Unable to fetch video profiles:', withGender.error);
    return { data: [], error: null as any };
  }

  const legacy = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_LEGACY)
    .in('id', userIds);

  if (legacy.error) {
    logger.warn('Unable to fetch legacy video profiles:', legacy.error);
    return { data: [], error: null as any };
  }

  return { data: legacy.data || [], error: null as any };
}

const VIDEO_DELETE_API_TIMEOUT_MS = 8000;
let cachedVideoDeleteApiBaseUrl: string | null = null;
let lastVideoDeleteApiCheckAt = 0;

function getVideoDeleteApiCandidates(): string[] {
  const urls: string[] = [];

  const explicit = process.env.EXPO_PUBLIC_RORK_API_BASE_URL?.trim();
  if (explicit) {
    urls.push(explicit.replace(/\/+$/, ''));
  }

  const productionApi = process.env.EXPO_PUBLIC_PRODUCTION_API_BASE_URL?.trim();
  if (productionApi) {
    urls.push(productionApi.replace(/\/+$/, ''));
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

async function canReachVideoDeleteApi(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`${baseUrl}/`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveVideoDeleteApiBaseUrl(): Promise<string | null> {
  const now = Date.now();
  if (cachedVideoDeleteApiBaseUrl && now - lastVideoDeleteApiCheckAt < 60_000) {
    return cachedVideoDeleteApiBaseUrl;
  }

  const candidates = getVideoDeleteApiCandidates();
  for (const candidate of candidates) {
    if (await canReachVideoDeleteApi(candidate)) {
      cachedVideoDeleteApiBaseUrl = candidate;
      lastVideoDeleteApiCheckAt = now;
      return candidate;
    }
  }

  cachedVideoDeleteApiBaseUrl = null;
  lastVideoDeleteApiCheckAt = now;
  return null;
}

async function deleteVideoViaBackend(videoId: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return false;
  }

  const resolvedBaseUrl = await resolveVideoDeleteApiBaseUrl();
  const candidates = resolvedBaseUrl
    ? [resolvedBaseUrl, ...getVideoDeleteApiCandidates().filter((candidate) => candidate !== resolvedBaseUrl)]
    : getVideoDeleteApiCandidates();

  let lastErrorMessage: string | null = null;
  let sawTransportFailure = false;

  for (const baseUrl of candidates) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), VIDEO_DELETE_API_TIMEOUT_MS);
      const response = await fetch(`${baseUrl}/api/videos/${videoId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      if (response.ok) {
        cachedVideoDeleteApiBaseUrl = baseUrl;
        lastVideoDeleteApiCheckAt = Date.now();
        return true;
      }

      const contentType = response.headers.get('content-type') || '';
      if (response.status === 404 && !contentType.includes('application/json')) {
        continue;
      }

      if (contentType.includes('application/json')) {
        const payload = await response.json().catch(() => null);
        if (payload?.error) {
          lastErrorMessage = payload.error;
        }
      } else {
        const responseText = await response.text().catch(() => '');
        if (responseText) {
          lastErrorMessage = responseText;
        }
      }
    } catch (error: any) {
      const message = String(error?.message || '').trim();
      const normalizedMessage = message.toLowerCase();
      const isTransportFailure =
        error?.name === 'AbortError' ||
        normalizedMessage === 'aborted' ||
        normalizedMessage.includes('network request failed') ||
        normalizedMessage.includes('network error') ||
        normalizedMessage.includes('failed to fetch') ||
        normalizedMessage.includes('timeout');

      if (isTransportFailure) {
        sawTransportFailure = true;
      } else if (message) {
        lastErrorMessage = message;
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  if (lastErrorMessage) {
    throw new Error(lastErrorMessage);
  }

  if (sawTransportFailure) {
    return false;
  }

  return false;
}

async function deleteVideoViaRpc(videoId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('delete_video_permanently', {
      target_video_id: videoId,
    });

    if (error) {
      const message = String(error.message || '').toLowerCase();
      const isMissingFunction =
        error.code === 'PGRST202' ||
        message.includes('delete_video_permanently') ||
        message.includes('function') ||
        message.includes('schema cache');

      if (!isMissingFunction) {
        logger.warn('delete_video_permanently RPC failed:', error);
      }

      return false;
    }

    return data === true;
  } catch (error) {
    logger.warn('delete_video_permanently RPC exception:', error);
    return false;
  }
}

// Profile operations
export const profileService = {
  async createProfile(profile: Tables['profiles']['Insert']) {
    logger.debug('Creating profile with data:', profile);

    // Ensure user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to create profile');
    }

    // Ensure profile ID matches authenticated user
    if (profile.id !== user.id) {
      throw new Error('Profile ID must match authenticated user ID');
    }

    const { data, error } = await supabase
      .from('profiles')
      .insert(profile)
      .select()
      .single();

    if (error) {
      logger.error('Error creating profile:', error);
      logger.error('Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });

      // Provide more helpful error messages for common RLS issues
      if (error.code === '42501' || error.message?.includes('row-level security')) {
        throw new Error('Permission denied: Please ensure you are authenticated and have the correct permissions to create a profile.');
      }

      throw error;
    }

    logger.debug('Profile created successfully:', data);
    return data;
  },

  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      logger.error('Error fetching profile:', error.message || error);
      throw error;
    }

    if (!data) {
      logger.debug('No profile found for user:', userId);
      return null;
    }

    return data;
  },

  async updateProfile(userId: string, updates: Tables['profiles']['Update']) {
    const payload = { ...updates, updated_at: new Date().toISOString() } as any;

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select()
      .single();

    if (!error) {
      return data;
    }

    const isMissingAvatarGenderColumn =
      error.code === 'PGRST204' &&
      typeof error.message === 'string' &&
      error.message.includes('avatar_gender');

    // Backward compatibility when DB migration is not applied yet.
    if (isMissingAvatarGenderColumn && Object.prototype.hasOwnProperty.call(payload, 'avatar_gender')) {
      const { avatar_gender, ...fallbackPayload } = payload;

      const { data: fallbackData, error: fallbackError } = await supabase
        .from('profiles')
        .update(fallbackPayload)
        .eq('id', userId)
        .select()
        .single();

      if (!fallbackError) {
        return fallbackData;
      }

      logger.error('Error updating profile (fallback):', fallbackError.message || fallbackError);
      throw fallbackError;
    }

    logger.error('Error updating profile:', error.message || error);
    throw error;
  },

  async getBusinessProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_type', 'business');

    if (error) {
      logger.error('Error fetching business profiles:', error);
      throw error;
    }
    return data;
  },

  async searchProfiles(query: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .or(profileSearchFilter(query));

    if (error) {
      logger.error('Error searching profiles:', error);
      throw error;
    }
    return data;
  }
};

export const followService = {
  async syncProfileFollowCounts(userId: string) {
    const { followersCount, followingCount } = await this.getFollowCounts(userId);

    const { error } = await supabase
      .from('profiles')
      .update({
        followers_count: followersCount,
        following_count: followingCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      logger.error('Error syncing profile follow counts:', error);
      throw error;
    }
  },

  async followUser(followerId: string, followingId: string) {
    if (!followerId || !followingId) {
      throw new Error('Missing follower/following id');
    }
    if (followerId === followingId) {
      throw new Error('You cannot follow yourself');
    }

    const { error } = await supabase
      .from('follows')
      .upsert(
        {
          follower_id: followerId,
          following_id: followingId,
        },
        {
          onConflict: 'follower_id,following_id',
          ignoreDuplicates: true,
        }
      );

    if (error) {
      logger.error('Error following user:', error);
      throw error;
    }

    try {
      await Promise.all([
        this.syncProfileFollowCounts(followerId),
        this.syncProfileFollowCounts(followingId),
      ]);
    } catch (syncError) {
      logger.warn('Follow created but count sync failed:', syncError);
    }
  },

  async unfollowUser(followerId: string, followingId: string) {
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);

    if (error) {
      logger.error('Error unfollowing user:', error);
      throw error;
    }

    try {
      await Promise.all([
        this.syncProfileFollowCounts(followerId),
        this.syncProfileFollowCounts(followingId),
      ]);
    } catch (syncError) {
      logger.warn('Unfollow completed but count sync failed:', syncError);
    }
  },

  async getFollowingIds(followerId: string) {
    const { data, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', followerId);

    if (error) {
      logger.warn('Unable to fetch following ids:', error);
      return [];
    }

    return (data || []).map((item) => item.following_id);
  },

  async isFollowing(followerId: string, followingId: string) {
    const { data, error } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle();

    if (error) {
      logger.error('Error checking follow status:', error);
      throw error;
    }

    return !!data;
  },

  async getFollowCounts(userId: string) {
    const [{ count: followersCount, error: followersError }, { count: followingCount, error: followingError }] = await Promise.all([
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', userId),
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', userId),
    ]);

    if (followersError) {
      logger.warn('Unable to fetch followers count:', followersError);
    }

    if (followingError) {
      logger.warn('Unable to fetch following count:', followingError);
    }

    return {
      followersCount: followersCount || 0,
      followingCount: followingCount || 0,
    };
  },

  async getFollowers(userId: string): Promise<FollowProfile[]> {
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId);

    if (error) {
      logger.error('Error fetching followers:', error);
      throw error;
    }

    const followerIds = (data || []).map((item) => item.follower_id);
    if (followerIds.length === 0) return [];

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, user_type, business_type, followers_count, following_count')
      .in('id', followerIds);

    if (profilesError) {
      logger.error('Error fetching follower profiles:', profilesError);
      throw profilesError;
    }

    return (profiles || []) as FollowProfile[];
  },

  async getFollowing(userId: string): Promise<FollowProfile[]> {
    const { data, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (error) {
      logger.error('Error fetching following:', error);
      throw error;
    }

    const followingIds = (data || []).map((item) => item.following_id);
    if (followingIds.length === 0) return [];

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, user_type, business_type, followers_count, following_count')
      .in('id', followingIds);

    if (profilesError) {
      logger.error('Error fetching following profiles:', profilesError);
      throw profilesError;
    }

    return (profiles || []) as FollowProfile[];
  },
};

// Video operations
export const videoService = {
  extractStoragePath(publicUrl: string | null | undefined, bucket: string): string | null {
    if (!publicUrl) return null;

    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
    ];

    for (const marker of markers) {
      const markerIndex = publicUrl.indexOf(marker);
      if (markerIndex !== -1) {
        const rawPath = publicUrl.slice(markerIndex + marker.length).split('?')[0];
        try {
          return decodeURIComponent(rawPath);
        } catch {
          return rawPath;
        }
      }
    }

    // Support raw storage paths saved directly in DB.
    if (publicUrl.startsWith(`${bucket}/`)) {
      return publicUrl.slice(bucket.length + 1);
    }

    return null;
  },

  async normalizeMediaUrl(mediaUrl: string | null | undefined, bucket: 'videos' | 'images') {
    if (!mediaUrl) return mediaUrl ?? null;

    const trimmedUrl = mediaUrl.trim();
    if (!trimmedUrl) return null;

    const storagePath = this.extractStoragePath(trimmedUrl, bucket);
    if (storagePath) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
      return data.publicUrl;
    }

    if (/^https?:\/\//i.test(trimmedUrl)) {
      return trimmedUrl;
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(trimmedUrl);
    return data.publicUrl;
  },

  async normalizeVideoRecord<T extends { video_url?: string | null; thumbnail_url?: string | null; location_coordinates?: unknown; location_latitude?: unknown; location_longitude?: unknown }>(video: T): Promise<T> {
    const [videoUrl, thumbnailUrl] = await Promise.all([
      this.normalizeMediaUrl(video.video_url ?? null, 'videos'),
      this.normalizeMediaUrl(video.thumbnail_url ?? null, 'images'),
    ]);

    return {
      ...video,
      location_latitude: videoVenueCoordinates(video)?.latitude ?? null,
      location_longitude: videoVenueCoordinates(video)?.longitude ?? null,
      video_url: videoUrl ?? video.video_url ?? null,
      thumbnail_url: thumbnailUrl ?? video.thumbnail_url ?? null,
    };
  },

  async uploadVideo(video: Tables['videos']['Insert']) {
    logger.debug('Creating video record with data:', video);

    // Ensure user is authenticated and has a corresponding profiles row (FK dependency).
    const user = await ensureAuthenticatedProfileExists();

    // Ensure video user_id matches authenticated user
    if (video.user_id !== user.id) {
      throw new Error('Video user_id must match authenticated user ID');
    }

    const { data, error } = await supabase
      .from('videos')
      .insert({
        ...video,
        upload_date: new Date().toISOString(),
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        rating: 0,
        rating_count: 0
      })
      .select()
      .single();

    if (error) {
      logger.error('Error uploading video:', error);
      logger.error('Video upload error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });

      // Provide more helpful error messages for common RLS issues
      if (error.code === '42501' || error.message?.includes('row-level security')) {
        throw new Error('Permission denied: Please ensure you are authenticated and have the correct permissions to upload videos.');
      }

      throw error;
    }

    logger.debug('Video record created successfully:', data);
    return data;
  },

  async getUserVideos(userId: string) {
    logger.debug('📹 getUserVideos: fetching for user', userId);
    // Get videos for the user (all statuses — existing & newly uploaded)
    const { data: videosData, error: videosError } = await supabase
      .from('videos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (videosError) {
      logger.error('📹 getUserVideos error:', videosError);
      throw videosError;
    }

    logger.debug('📹 getUserVideos: found', videosData?.length ?? 0, 'videos for user', userId);
    if (videosData && videosData.length > 0) {
      logger.debug('📹 first video id:', videosData[0].id, 'user_id:', videosData[0].user_id);
    }

    if (!videosData || videosData.length === 0) {
      return [];
    }

    // Get the user's profile
    const { data: profileData, error: profileError } = await fetchProfileForVideoById(userId);

    if (profileError) {
      logger.warn('Unable to fetch user profile:', profileError);
      // Don't throw error, just continue without profile data
    }

    const normalizedVideos = await Promise.all(
      videosData.map((video: any) => this.normalizeVideoRecord(video))
    );

    // Combine videos with profile
    const videosWithProfile = normalizedVideos.map(video => ({
      ...video,
      profiles: profileData || null
    }));

    return videosWithProfile;
  },

  async getVideo(videoId: string) {
    // Get the video
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();

    if (videoError) {
      logger.error('Error fetching video:', videoError);
      throw videoError;
    }

    // Get the user's profile
    const { data: profileData, error: profileError } = await fetchProfileForVideoById(videoData.user_id);

    if (profileError) {
      logger.error('Error fetching video profile:', profileError);
      // Don't throw error, just continue without profile data
    }

    const normalizedVideo = await this.normalizeVideoRecord(videoData);

    // Combine video with profile
    const videoWithProfile = {
      ...normalizedVideo,
      profiles: profileData || null
    };

    return videoWithProfile;
  },

  async getVideos(limit = 20, offset = 0, seed?: string) {
    const { data: videosData, error: videosError } = await loadVideoFeed(limit, offset, seed);

    if (videosError) {
      logger.warn('Unable to fetch videos:', videosError instanceof Error ? videosError.message : String(videosError));
      throw videosError;
    }

    if (!videosData || videosData.length === 0) {
      return [];
    }

    // Get unique user IDs from videos
    const userIds: string[] = [...new Set<string>(videosData.map((video: any) => video.user_id))];

    // Fetch profiles for these users
    const { data: profilesData, error: profilesError } = await fetchProfilesForVideoByIds(userIds);

    if (profilesError) {
      logger.warn('Unable to fetch profiles:', profilesError);
      // Don't throw error, just continue without profile data
    }

    // Create a map of profiles by user ID for quick lookup
    const profilesMap = new Map();
    if (profilesData) {
      profilesData.forEach(profile => {
        profilesMap.set(profile.id, profile);
      });
    }

    const normalizedVideos = await Promise.all(
      videosData.map((video: any) => this.normalizeVideoRecord(video))
    );

    // Combine videos with their profiles
    const videosWithProfiles = normalizedVideos.map(video => ({
      ...video,
      profiles: profilesMap.get(video.user_id) || null
    }));

    return videosWithProfiles;
  },

  async deleteVideo(videoId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to delete videos');
    }

    const { data: ownedVideo, error: ownedVideoError } = await supabase
      .from('videos')
      .select('id, user_id, video_url, thumbnail_url')
      .eq('id', videoId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (ownedVideoError) {
      logger.error('Error validating video ownership:', ownedVideoError);
      throw ownedVideoError;
    }

    if (!ownedVideo) {
      throw new Error('Video could not be deleted because it was not found for this account.');
    }

    const videoStoragePath = this.extractStoragePath(ownedVideo.video_url, 'videos');
    const imageStoragePath = this.extractStoragePath(ownedVideo.thumbnail_url, 'images');

    const deletedViaRpc = await deleteVideoViaRpc(videoId);

    if (!deletedViaRpc) {
      // Clear dependent rows first so FK constraints do not block deletion.
      const dependentCleanup = await Promise.all([
        supabase.from('video_comments').delete().eq('video_id', videoId),
        supabase.from('video_ratings').delete().eq('video_id', videoId),
        supabase.from('video_likes').delete().eq('video_id', videoId),
        supabase.from('video_shares').delete().eq('video_id', videoId),
        supabase
          .from('events')
          .update({ video_id: null, updated_at: new Date().toISOString() })
          .eq('video_id', videoId)
          .eq('user_id', user.id),
      ]);

      const cleanupError = dependentCleanup.find((result) => result.error)?.error;
      if (cleanupError) {
        logger.warn('Dependent cleanup warning before video delete:', cleanupError);
      }

      const { data: deletedRows, error } = await supabase
        .from('videos')
        .delete()
        .eq('id', videoId)
        .eq('user_id', user.id)
        .select('id');

      if (error) {
        logger.error('Error deleting video:', error);
        const deletedViaBackend = await deleteVideoViaBackend(videoId);
        if (!deletedViaBackend) {
          throw error;
        }
      }

      // Some Supabase/RLS combinations can delete successfully but return no deleted
      // rows from delete().select(). Treat the row existence check as the source of truth.
      if (!deletedRows || deletedRows.length === 0) {
        logger.warn('Video delete succeeded without returned rows; verified by follow-up existence check.', {
          videoId,
          userId: user.id,
        });
      }
    }

    let { data: existingVideoAfterDelete, error: existingVideoCheckError } = await supabase
      .from('videos')
      .select('id')
      .eq('id', videoId)
      .maybeSingle();

    if (existingVideoCheckError) {
      logger.warn('Unable to verify deleted video row:', existingVideoCheckError);
    }

    if (existingVideoAfterDelete) {
      const deletedViaBackend = await deleteVideoViaBackend(videoId);
      if (!deletedViaBackend) {
        throw new Error('Video still exists after delete attempt.');
      }

      const verificationResult = await supabase
        .from('videos')
        .select('id')
        .eq('id', videoId)
        .maybeSingle();

      existingVideoAfterDelete = verificationResult.data;
      existingVideoCheckError = verificationResult.error;

      if (existingVideoCheckError) {
        logger.warn('Unable to verify deleted video row after backend fallback:', existingVideoCheckError);
      }

      if (existingVideoAfterDelete) {
        throw new Error('Video still exists after backend delete fallback.');
      }
    }

    if (videoStoragePath) {
      const { error: storageDeleteError } = await supabase.storage
        .from('videos')
        .remove([videoStoragePath]);

      if (storageDeleteError) {
        logger.warn('Video row deleted, but storage file removal failed:', storageDeleteError);
      }
    }

    if (imageStoragePath) {
      const { error: imageDeleteError } = await supabase.storage
        .from('images')
        .remove([imageStoragePath]);

      if (imageDeleteError) {
        logger.warn('Video row deleted, but thumbnail file removal failed:', imageDeleteError);
      }
    }
  },

  async updateVideo(videoId: string, updates: Tables['videos']['Update']) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to update videos');
    }

    const { data, error } = await supabase
      .from('videos')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', videoId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating video:', error);
      throw error;
    }

    return data;
  },

  async updateVideoStats(videoId: string, updates: Tables['videos']['Update']) {
    const { data, error } = await supabase
      .from('videos')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', videoId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating video stats:', error);
      throw error;
    }
    return data;
  },

  async searchVideos(query: string, filters?: {
    location?: string;
    eventName?: string;
    hashtags?: string[];
  }) {
    let queryBuilder = supabase
      .from('videos')
      .select('*');

    if (query) {
      queryBuilder = queryBuilder.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
    }

    if (filters?.location) {
      queryBuilder = queryBuilder.ilike('location_city', `%${filters.location}%`);
    }

    if (filters?.eventName) {
      queryBuilder = queryBuilder.ilike('event_name', `%${filters.eventName}%`);
    }

    if (filters?.hashtags && filters.hashtags.length > 0) {
      queryBuilder = queryBuilder.overlaps('hashtags', filters.hashtags);
    }

    const { data: videosData, error: videosError } = await queryBuilder.order('created_at', { ascending: false });

    if (videosError) {
      logger.error('Error searching videos:', videosError);
      throw videosError;
    }

    if (!videosData || videosData.length === 0) {
      return [];
    }

    // Get unique user IDs from videos
    const userIds: string[] = [...new Set<string>(videosData.map((video: any) => video.user_id))];

    // Fetch profiles for these users
    const { data: profilesData, error: profilesError } = await fetchProfilesForVideoByIds(userIds);

    if (profilesError) {
      logger.warn('Unable to fetch profiles for search:', profilesError);
      // Don't throw error, just continue without profile data
    }

    // Create a map of profiles by user ID for quick lookup
    const profilesMap = new Map();
    if (profilesData) {
      profilesData.forEach(profile => {
        profilesMap.set(profile.id, profile);
      });
    }

    const normalizedVideos = await Promise.all(
      videosData.map((video: any) => this.normalizeVideoRecord(video))
    );

    // Combine videos with their profiles
    const videosWithProfiles = normalizedVideos.map(video => ({
      ...video,
      profiles: profilesMap.get(video.user_id) || null
    }));

    return videosWithProfiles;
  }
};

// Order operations
export const orderService = {
  async createOrder(order: Tables['orders']['Insert']) {
    // Ensure user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to create orders');
    }

    // Ensure order user_id matches authenticated user
    if (order.user_id !== user.id) {
      throw new Error('Order user_id must match authenticated user ID');
    }

    const baseInsertPayload = {
      ...order,
      status: 'pending',
      payment_status: 'pending',
      currency: order.currency || 'USD'
    };

    const insertPayload: Record<string, any> = { ...baseInsertPayload };
    let data: any = null;
    let error: any = null;

    // Backward compatibility for deployments where optional orders columns are not migrated yet.
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await supabase
        .from('orders')
        .insert(insertPayload)
        .select()
        .single();

      data = result.data;
      error = result.error;

      if (!error) {
        break;
      }

      const missingColumnMatch =
        error?.code === 'PGRST204' &&
        typeof error.message === 'string'
          ? error.message.match(/Could not find the '([^']+)' column of 'orders' in the schema cache/i)
          : null;

      const missingColumn = missingColumnMatch?.[1];
      if (!missingColumn || !(missingColumn in insertPayload)) {
        break;
      }

      delete insertPayload[missingColumn];
    }

    if (error) {
      logger.error('Error creating order:', error);

      if (error.code === '42501' || error.message?.includes('row-level security')) {
        throw new Error('Permission denied: Please ensure you are authenticated and have the correct permissions to create orders.');
      }

      throw error;
    }
    return data;
  },

  async getUserOrders(userId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching user orders:', error);
      throw error;
    }
    return data;
  },

  async getBusinessOrders(businessId: string) {
    // Orders are authoritative so pending checkout attempts are visible before
    // payment/receipt issuance. Receipts remain an optional paid-order join.
    const { data: ownedOrders, error: ownedOrdersError } = await supabase
      .from('orders').select('*').eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (ownedOrdersError) throw ownedOrdersError;
    const { data: receipts, error: receiptError } = await supabase
      .from('ticket_receipts')
      .select('order_id,buyer_id,ticket_title,receipt_kind,quantity,total_price,currency,event_name,is_active,redeemed_at')
      .eq('owner_id', businessId);

    if (receiptError) throw receiptError;
    const orderIds = Array.from(new Set([
      ...(ownedOrders || []).map((row: any) => row.id),
      ...(receipts || []).map((row) => row.order_id),
    ].filter(Boolean)));
    if (!orderIds.length) return [];

    const missingIds = orderIds.filter((id) => !(ownedOrders || []).some((order: any) => order.id === id));
    const { data: legacyOrders, error: orderError } = missingIds.length
      ? await supabase.from('orders').select('*').in('id', missingIds)
      : { data: [] as any[], error: null };
    if (orderError) throw orderError;
    const orders = [...(ownedOrders || []), ...(legacyOrders || [])]
      .sort((a: any, b: any) => Date.parse(b.created_at) - Date.parse(a.created_at));

    const buyerIds = Array.from(new Set((receipts || []).map((row) => row.buyer_id).filter(Boolean)));
    const { data: profiles } = buyerIds.length
      ? await supabase.from('profiles').select('id,username,full_name,avatar_url').in('id', buyerIds)
      : { data: [] as any[] };
    const profilesById = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
    const receiptsByOrder = new Map<string, any[]>();
    for (const receipt of receipts || []) {
      const group = receiptsByOrder.get(receipt.order_id) || [];
      group.push(receipt);
      receiptsByOrder.set(receipt.order_id, group);
    }

    return (orders || []).map((order: any) => {
      const orderReceipts = receiptsByOrder.get(order.id) || [];
      const buyerId = order.user_id || orderReceipts[0]?.buyer_id;
      return { ...order, receipts: orderReceipts, buyer: profilesById.get(buyerId) || null };
    });
  },

  async getOrder(orderId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error) {
      logger.error('Error fetching order:', error);
      throw error;
    }
    return data;
  },

  async updateOrderStatus(orderId: string, status: Tables['orders']['Row']['status'], paymentStatus?: Tables['orders']['Row']['payment_status']) {
    const updates: Tables['orders']['Update'] = {
      status,
      updated_at: new Date().toISOString()
    };

    if (paymentStatus) {
      updates.payment_status = paymentStatus;
    }

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating order status:', error);
      throw error;
    }
    return data;
  },

  async manageBusinessOrder(orderId: string, status: 'completed' | 'cancelled', reason?: string) {
    const { data, error } = await supabase.rpc('manage_business_order', {
      target_order_id: orderId,
      next_status: status,
      cancellation_reason: reason?.trim() || null,
    });
    if (error) throw new Error(error.message || 'Unable to update order.');
    return Array.isArray(data) ? data[0] : data;
  },

  async getOrdersByVideo(videoId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        profiles(*)
      `)
      .eq('video_id', videoId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching orders by video:', error);
      throw error;
    }
    return data;
  }
};

type TicketReceiptSourceItem = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  currency?: string;
  type?: string;
  videoId?: string;
};

const buildTicketImageUrl = (_params: {
  eventName: string;
  orderNumber: string;
  seatNo: string;
  startDateLabel: string;
  startTimeLabel: string;
}) => {
  return null;
};

export const ticketReceiptService = {
  async redeemTicket(qrCodeData: string) {
    const normalizedQrCode = qrCodeData.trim();
    if (!normalizedQrCode) throw new Error('Invalid QR code.');

    const isTableBooking = normalizedQrCode.startsWith('TABLE:');
    const { data, error } = isTableBooking
      ? await supabase.rpc('redeem_event_table_booking', { booking_qr_code: normalizedQrCode })
      : await supabase.rpc('redeem_ticket', { receipt_qr_code: normalizedQrCode });

    if (error) {
      throw new Error(error.message || 'Ticket verification failed.');
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error('Ticket verification returned no result.');
    return result;
  },
  async createTicketReceiptsForOrder(input: {
    orderId: string;
    orderNumber: string;
    buyerId: string;
    sourceItems: TicketReceiptSourceItem[];
    fallbackVideoId?: string;
  }) {
    const {data,error}=await supabase.rpc('get_verified_order_receipts',{order_key:input.orderId});
    if(error)throw new Error(error.message || 'Verified purchase receipts are not ready');
    return (data || []) as TicketReceipt[];
  },

  async getVisibleTickets(userId: string) {
    const { data, error } = await supabase
      .from('ticket_receipts')
      .select('*')
      .or(`buyer_id.eq.${userId},owner_id.eq.${userId}`)
      .order('issued_at', { ascending: false });

    if (error) {
      logger.error('Error fetching visible tickets:', error);
      throw error;
    }

    const tickets = (data || []) as TicketReceipt[];
    const orderIds = Array.from(new Set(tickets.map((ticket) => ticket.order_id).filter(Boolean)));
    if (!orderIds.length) return tickets;

    const { data: orderRows, error: orderError } = await supabase
      .from('orders')
      .select('id,created_at')
      .in('id', orderIds);

    if (orderError) {
      logger.warn('Unable to load original purchase dates; using receipt dates:', orderError.message);
    }

    // Receipt snapshots remain authoritative; address is optional display enrichment.
    const eventIds = [...new Set(tickets.map(ticket => ticket.event_id).filter((id): id is string => !!id))];
    const videoIds = [...new Set(tickets.map(ticket => ticket.video_id).filter((id): id is string => !!id))];
    const addressBySource = new Map<string, string>();
    await Promise.all((['events', 'videos'] as const).map(async table => {
      const ids = table === 'events' ? eventIds : videoIds;
      if (!ids.length) return;
      const result = await supabase.from(table).select('id,location_address,location_city').in('id', ids);
      if (result.error) return; // Historical or private event details need not block the ticket.
      for (const row of result.data || []) {
        addressBySource.set(`${table}:${row.id}`, [row.location_address, row.location_city].filter(Boolean).join(', '));
      }
    }));
    const sellers=await loadTicketSellers(supabase,tickets.map(ticket=>ticket.owner_id));
    const purchasedAtByOrder = new Map((orderRows || []).map((order) => [order.id, order.created_at]));
    return tickets.map((ticket) => ({
      ...ticket,
      seller:sellers.get(ticket.owner_id),
      location_address: addressBySource.get(`events:${ticket.event_id}`) || addressBySource.get(`videos:${ticket.video_id}`) || undefined,
      purchased_at: purchasedAtByOrder.get(ticket.order_id) || ticket.issued_at || ticket.created_at,
    })) as Array<TicketReceipt & { purchased_at?: string }>;
  },
};

// Event operations
export const eventService = {
  async createEvent(event: Tables['events']['Insert']) {
    // Ensure user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to create events');
    }

    // Ensure event user_id matches authenticated user
    if (event.user_id !== user.id) {
      throw new Error('Event user_id must match authenticated user ID');
    }

    const { data, error } = await supabase
      .from('events')
      .insert({
        ...event,
        creator_id: user.id, // Add creator_id field
        current_attendees: 0,
        is_public: event.is_public ?? true,
        requires_approval: event.requires_approval ?? false,
        status: event.status ?? 'published'
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating event:', error);

      if (error.code === '42501' || error.message?.includes('row-level security')) {
        throw new Error('Permission denied: Please ensure you are authenticated and have the correct permissions to create events.');
      }

      throw error;
    }
    return data;
  },

  async getUserEvents(userId: string) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        *,
        profiles(*)
      `)
      .eq('user_id', userId)
      .order('start_date', { ascending: true });

    if (error) {
      logger.warn('Unable to fetch user events:', error);
      return [];
    }
    return data;
  },

  async getEvent(eventId: string) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        *,
        profiles(*)
      `)
      .eq('id', eventId)
      .single();

    if (error) {
      logger.error('Error fetching event:', error);
      throw error;
    }
    return data;
  },

  async updateEvent(eventId: string, updates: Tables['events']['Update']) {
    const { data, error } = await supabase
      .from('events')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', eventId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating event:', error);
      throw error;
    }
    return data;
  },

  async getPublicEvents(limit = 20, offset = 0) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        *,
        profiles(*)
      `)
      .eq('is_public', true)
      .in('status', PUBLIC_OPEN_EVENT_STATUSES)
      .gte('start_date', new Date().toISOString())
      .order('start_date', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Error fetching public events:', error);
      throw error;
    }
    return data;
  },

  async searchEvents(query: string, filters?: {
    location?: string;
    category?: string;
    dateRange?: { start: string; end: string };
  }) {
    let queryBuilder = supabase
      .from('events')
      .select(`
        *,
        profiles(*)
      `)
      .eq('is_public', true)
      .in('status', PUBLIC_OPEN_EVENT_STATUSES);

    if (query) {
      queryBuilder = queryBuilder.or(`event_name.ilike.%${query}%,description.ilike.%${query}%`);
    }

    if (filters?.location) {
      queryBuilder = queryBuilder.ilike('location_city', `%${filters.location}%`);
    }

    if (filters?.category) {
      queryBuilder = queryBuilder.eq('category', filters.category);
    }

    if (filters?.dateRange) {
      queryBuilder = queryBuilder
        .gte('start_date', filters.dateRange.start)
        .lte('start_date', filters.dateRange.end);
    }

    const { data, error } = await queryBuilder.order('start_date', { ascending: true });

    if (error) {
      logger.error('Error searching events:', error);
      throw error;
    }
    return data;
  }
};

// Unified Search operations
export const searchService = {
  async resolveFirstVideoForEvents(events: any[]) {
    const missingVideoEvents = events.filter((event) => !event.video_id && event.event_name);
    if (missingVideoEvents.length === 0) {
      return events;
    }

    const eventNames = [...new Set(missingVideoEvents.map((event) => event.event_name).filter(Boolean))];
    const resolvedVideoIdsByEventName = new Map<string, string>();

    await Promise.all(
      eventNames.map(async (eventName) => {
        const { data, error } = await supabase
          .from('videos')
          .select('id, event_name, created_at')
          .ilike('event_name', eventName)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!error && data?.id) {
          resolvedVideoIdsByEventName.set(eventName, data.id);
        }
      })
    );

    return events.map((event) => ({
      ...event,
      video_id: event.video_id || resolvedVideoIdsByEventName.get(event.event_name) || null,
    }));
  },

  async searchAll(query: string, filters?: {
    location?: string;
    category?: string;
    userType?: 'personal' | 'business';
    dateRange?: { start: string; end: string };
  }) {
    const searchResults = {
      events: [] as any[],
      videos: [] as any[],
      users: [] as any[],
      totalResults: 0
    };

    try {
      // Search Events - Now using unified live search
      const searchTerm = `%${query.trim()}%`;
      let eventQuery = supabase
        .from('events')
        .select(`
          *,
          profiles!events_creator_id_fkey(id, username, full_name, avatar_url, user_type, business_name, business_type)
        `)
        .eq('is_public', true)
        .in('status', PUBLIC_OPEN_EVENT_STATUSES);

      if (query) {
        eventQuery = eventQuery.or(`event_name.ilike.${searchTerm},description.ilike.${searchTerm}`);
      }

      const { data: events, error: eventsError } = await eventQuery
        .order('start_date', { ascending: true })
        .limit(10);

      if (eventsError) {
        logger.error('Error fetching events in unified search:', eventsError);
      } else if (events) {
        searchResults.events = await this.resolveFirstVideoForEvents(events);
      }

      if (!query.trim()) {
        return searchResults;
      }

      // 1. Search Videos - Using broad pattern matching for flexibility
      const { data: videosData, error: videosError } = await supabase
        .from('videos')
        .select('*, profiles(*)')
        .or(`description.ilike.${searchTerm},location_name.ilike.${searchTerm},event_name.ilike.${searchTerm},hashtags.adj.{${query.trim()}}`)
        .limit(30);

      if (!videosError && videosData) {
        searchResults.videos = await Promise.all(
          videosData.map(v => videoService.normalizeVideoRecord(v))
        );
      }

      // 2. Search Users
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('*')
        .or(`${profileSearchFilter(query)},business_type.ilike.${searchTerm}`)
        .limit(15);

      if (usersError) throw usersError;

      if (usersData) {
        searchResults.users = usersData;
      }

      // 3. Search Events
      const { data: unifiedEventsData, error: unifiedEventsError } = await supabase
        .from('events')
        .select('*, profiles(*)')
        .or(`event_name.ilike.${searchTerm},location_name.ilike.${searchTerm},description.ilike.${searchTerm},category.ilike.${searchTerm}`)
        .limit(15);

      if (!unifiedEventsError && unifiedEventsData) {
        const mappedEvents = unifiedEventsData.map(e => ({
          id: e.id,
          event_name: e.event_name,
          description: e.description,
          start_date: e.start_date,
          end_date: e.end_date,
          status: e.status,
          video_id: e.video_id,
          image_url: e.image_url,
          location_name: e.location_name,
          location_city: e.location_city,
          profiles: e.profiles
        })) as any;

        searchResults.events = await this.resolveFirstVideoForEvents(mappedEvents);
      }

      searchResults.totalResults = searchResults.videos.length + searchResults.users.length + searchResults.events.length;
      return searchResults;
    } catch (error) {
      logger.error('Error in unified search:', error);
      throw error;
    }
  },

  async searchEvents(query: string, filters?: {
    location?: string;
    category?: string;
    dateRange?: { start: string; end: string };
  }) {
    let queryBuilder = supabase
      .from('events')
      .select(`
        *,
        profiles!events_creator_id_fkey(id, username, full_name, avatar_url, user_type, business_name, business_type)
      `)
      .eq('is_public', true)
      .in('status', PUBLIC_OPEN_EVENT_STATUSES);

    if (query) {
      queryBuilder = queryBuilder.or(`event_name.ilike.%${query}%,description.ilike.%${query}%`);
    }

    if (filters?.location) {
      queryBuilder = queryBuilder.ilike('location_city', `%${filters.location}%`);
    }

    if (filters?.category) {
      queryBuilder = queryBuilder.eq('category', filters.category);
    }

    if (filters?.dateRange) {
      queryBuilder = queryBuilder
        .gte('start_date', filters.dateRange.start)
        .lte('start_date', filters.dateRange.end);
    }

    const { data, error } = await queryBuilder.order('start_date', { ascending: true });

    if (error) {
      logger.error('Error searching events:', error);
      throw error;
    }
    return data;
  },

  async searchVideos(query: string, filters?: {
    location?: string;
    eventName?: string;
    hashtags?: string[];
  }) {
    let queryBuilder = supabase
      .from('videos')
      .select(`
        *,
        profiles!videos_user_id_fkey(id, username, full_name, avatar_url, user_type, business_name, business_type)
      `);

    if (query) {
      queryBuilder = queryBuilder.or(`title.ilike.%${query}%,description.ilike.%${query}%,event_name.ilike.%${query}%`);
    }

    if (filters?.location) {
      queryBuilder = queryBuilder.ilike('location_city', `%${filters.location}%`);
    }

    if (filters?.eventName) {
      queryBuilder = queryBuilder.ilike('event_name', `%${filters.eventName}%`);
    }

    if (filters?.hashtags && filters.hashtags.length > 0) {
      queryBuilder = queryBuilder.overlaps('hashtags', filters.hashtags);
    }

    const { data, error } = await queryBuilder.order('created_at', { ascending: false });

    if (error) {
      logger.error('Error searching videos:', error);
      throw error;
    }
    return data;
  },

  async searchUsers(query: string, filters?: {
    userType?: 'personal' | 'business';
    location?: string;
  }) {
    let queryBuilder = supabase
      .from('profiles')
      .select('*');

    if (query) {
      queryBuilder = queryBuilder.or(profileSearchFilter(query));
    }

    if (filters?.userType) {
      queryBuilder = queryBuilder.eq('user_type', filters.userType);
    }

    if (filters?.location) {
      queryBuilder = queryBuilder.ilike('location_city', `%${filters.location}%`);
    }

    const { data, error } = await queryBuilder
      .order('followers_count', { ascending: false });

    if (error) {
      logger.error('Error searching users:', error);
      throw error;
    }
    return data;
  }
};

// Voucher operations
export const voucherService = {
  async createVoucher(voucher: Tables['vouchers']['Insert']) {
    // Ensure user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to create vouchers');
    }

    // Ensure voucher business_id matches authenticated user
    if (voucher.business_id !== user.id) {
      throw new Error('Voucher business_id must match authenticated user ID');
    }

    // Ensure user is a business user
    const profile = await profileService.getProfile(user.id);
    if (!profile || profile.user_type !== 'business') {
      throw new Error('Only business users can create vouchers');
    }

    // Redemption counters and generated fields belong to the database.
    const { usage_count, id, created_at, updated_at, ...editableVoucher } = voucher;
    const insert = { ...editableVoucher, creator_id: user.id, is_active: voucher.is_active ?? true };

    let { data, error } = await supabase
      .from('vouchers')
      .insert(insert)
      .select()
      .single();

    if (isLegacyVoucherSchemaError(error)) {
      const legacy = await supabase.from('vouchers').insert(legacyVoucherFields(insert)).select().single();
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      logger.error('Error creating voucher:', error);

      if (error.code === '42501' || error.message?.includes('row-level security')) {
        throw new Error('Permission denied: Please ensure you are authenticated as a business user to create vouchers.');
      }

      throw error;
    }
    return data;
  },

  async getBusinessVouchers(businessId: string) {
    const { data, error } = await supabase
      .from('vouchers')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching business vouchers:', error);
      throw error;
    }
    return data;
  },

  async getVoucherByCode(code: string) {
    const { data, error } = await supabase
      .from('vouchers')
      .select(`
        *,
        profiles(*)
      `)
      .eq('code', code)
      .eq('is_active', true)
      .single();

    if (error) {
      logger.error('Error fetching voucher by code:', error);
      throw error;
    }
    return data;
  },

  async redeemVoucher(voucherId: string) {
    const { data, error } = await supabase.rpc('redeem_paid_voucher', { voucher_key: voucherId });
    if (error) throw error;
    return data;
  },

  async updateVoucher(voucherId: string, updates: Tables['vouchers']['Update']) {
    const { data, error } = await supabase
      .from('vouchers')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', voucherId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating voucher:', error);
      throw error;
    }
    return data;
  },

  async getActiveVouchers(businessId?: string) {
    let queryBuilder = supabase
      .from('vouchers')
      .select(`
        *,
        profiles(*)
      `)
      .eq('is_active', true)
      .or('expiry_date.is.null,expiry_date.gte.' + new Date().toISOString());

    if (businessId) {
      queryBuilder = queryBuilder.eq('business_id', businessId);
    }

    const { data, error } = await queryBuilder.order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching active vouchers:', error);
      throw error;
    }
    return data;
  }
};

// Storage operations for file uploads
export const storageService = {
  async ensureBucketExists(bucketName: string, isPublic = true) {
    try {
      // Check if bucket exists
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();

      if (listError) {
        logger.error('Error listing buckets:', listError);
        // If we can't list buckets, assume they exist and continue
        // This handles cases where RLS policies prevent listing
        logger.debug(`Assuming bucket ${bucketName} exists due to listing error`);
        return;
      }

      const bucketExists = buckets?.some(bucket => bucket.name === bucketName);

      if (!bucketExists) {
        logger.debug(`Bucket ${bucketName} does not exist, but skipping creation due to RLS restrictions`);
        logger.debug(`Please ensure the bucket is created manually in Supabase Dashboard or via the RLS setup script`);
        // Don't attempt to create bucket programmatically as it will fail with RLS
        // The bucket should be created via the SQL script or Supabase Dashboard
        return;
      } else {
        logger.debug(`Bucket ${bucketName} already exists`);
      }
    } catch (error) {
      logger.error(`Error ensuring bucket ${bucketName} exists:`, error);
      // If it's an RLS error, assume bucket exists and continue
      if (error instanceof Error && (error.message?.includes('row-level security') || error.message?.includes('permission'))) {
        logger.debug(`Assuming bucket ${bucketName} exists due to RLS restrictions`);
        return;
      }
      // For other errors, don't throw - just log and continue
      logger.debug(`Continuing with upload assuming bucket ${bucketName} exists`);
    }
  },

  async uploadVideo(file: ArrayBuffer, fileName: string, contentType: string) {
    try {
      // Ensure the videos bucket exists
      await this.ensureBucketExists('videos', true);

      logger.debug(`Uploading video: ${fileName} (${contentType})`);

      const { data, error } = await supabase.storage
        .from('videos')
        .upload(fileName, file, {
          contentType,
          upsert: false
        });

      if (error) {
        logger.error('Error uploading video:', error);

        // If it's a bucket not found error, try to create the bucket and retry
        if (error.message?.includes('Bucket not found') || error.message?.includes('bucket does not exist')) {
          logger.debug('Bucket not found, creating and retrying...');
          await this.ensureBucketExists('videos', true);

          // Retry the upload
          const { data: retryData, error: retryError } = await supabase.storage
            .from('videos')
            .upload(fileName, file, {
              contentType,
              upsert: false
            });

          if (retryError) {
            logger.error('Error on retry upload:', retryError);
            throw retryError;
          }

          return retryData;
        }

        throw error;
      }

      logger.debug('Video uploaded successfully:', data);
      return data;
    } catch (error) {
      logger.error('Error in uploadVideo:', error);
      throw error;
    }
  },

  async getVideoUrl(filePath: string) {
    try {
      // Ensure the videos bucket exists
      await this.ensureBucketExists('videos', true);

      const { data } = supabase.storage
        .from('videos')
        .getPublicUrl(filePath);

      logger.debug('Generated video URL:', data.publicUrl);
      return data.publicUrl;
    } catch (error) {
      logger.error('Error getting video URL:', error);
      // Return a fallback URL or rethrow based on your needs
      throw error;
    }
  },

  async uploadImage(file: ArrayBuffer, fileName: string, contentType: string, bucket = 'images') {
    try {
      // Ensure the bucket exists
      await this.ensureBucketExists(bucket, true);

      logger.debug(`Uploading image: ${fileName} to bucket: ${bucket}`);

      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
          contentType,
          upsert: false
        });

      if (error) {
        logger.error('Error uploading image:', error);

        // If it's a bucket not found error, try to create the bucket and retry
        if (error.message?.includes('Bucket not found') || error.message?.includes('bucket does not exist')) {
          logger.debug('Bucket not found, creating and retrying...');
          await this.ensureBucketExists(bucket, true);

          // Retry the upload
          const { data: retryData, error: retryError } = await supabase.storage
            .from(bucket)
            .upload(fileName, file, {
              contentType,
              upsert: false
            });

          if (retryError) {
            logger.error('Error on retry upload:', retryError);
            throw retryError;
          }

          return retryData;
        }

        throw error;
      }

      logger.debug('Image uploaded successfully:', data);
      return data;
    } catch (error) {
      logger.error('Error in uploadImage:', error);
      throw error;
    }
  },

  async getImageUrl(filePath: string, bucket = 'images') {
    try {
      // Ensure the bucket exists
      await this.ensureBucketExists(bucket, true);

      const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      logger.debug('Generated image URL:', data.publicUrl);
      return data.publicUrl;
    } catch (error) {
      logger.error('Error getting image URL:', error);
      throw error;
    }
  },

  async deleteFile(filePath: string, bucket: string) {
    const { error } = await supabase.storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      logger.error('Error deleting file:', error);
      throw error;
    }
  }
};

// Real-time subscriptions
export const subscriptionService = {
  subscribeToUserVideos(userId: string, callback: (payload: any) => void) {
    return supabase
      .channel('user-videos')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'videos',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();
  },

  subscribeToOrders(userId: string, callback: (payload: any) => void) {
    return supabase
      .channel('user-orders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();
  },

  subscribeToEvents(callback: (payload: any) => void) {
    return supabase
      .channel('public-events')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: 'is_public=eq.true'
        },
        callback
      )
      .subscribe();
  },

  subscribeToUserReservations(userId: string, callback: (payload: any) => void) {
    return supabase
      .channel('user-reservations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservations',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();
  },

  subscribeToBusinessReservations(businessId: string, callback: (payload: any) => void) {
    return supabase
      .channel('business-reservations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservations',
          filter: `business_id=eq.${businessId}`
        },
        callback
      )
      .subscribe();
  },

  unsubscribe(subscription: any) {
    return supabase.removeChannel(subscription);
  }
};

// Reservation operations
export const reservationService = {
  async createReservation(reservation: Tables['reservations']['Insert']) {
    // Ensure user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to create reservations');
    }

    // Ensure reservation user_id matches authenticated user
    if (reservation.user_id !== user.id) {
      throw new Error('Reservation user_id must match authenticated user ID');
    }

    const confirmationCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { data, error } = await supabase
      .from('reservations')
      .insert({
        ...reservation,
        status: 'pending',
        confirmation_code: confirmationCode,
        currency: reservation.currency || 'USD'
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating reservation:', error);

      if (error.code === '42501' || error.message?.includes('row-level security')) {
        throw new Error('Permission denied: Please ensure you are authenticated and have the correct permissions to create reservations.');
      }

      throw error;
    }
    return data;
  },

  async getUserReservations(userId: string) {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        profiles(*),
        events(*),
        videos(*)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching user reservations:', error);
      throw error;
    }
    return data;
  },

  async getBusinessReservations(businessId: string) {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        profiles(*),
        events(*),
        videos(*)
      `)
      .eq('business_id', businessId)
      .order('reservation_date', { ascending: true });

    if (error) {
      logger.error('Error fetching business reservations:', error);
      throw error;
    }
    return data;
  },

  async getReservation(reservationId: string) {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        profiles(*),
        events(*),
        videos(*)
      `)
      .eq('id', reservationId)
      .single();

    if (error) {
      logger.error('Error fetching reservation:', error);
      throw error;
    }
    return data;
  },

  async getReservationByConfirmationCode(confirmationCode: string) {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        profiles(*),
        events(*),
        videos(*)
      `)
      .eq('confirmation_code', confirmationCode)
      .single();

    if (error) {
      logger.error('Error fetching reservation by confirmation code:', error);
      throw error;
    }
    return data;
  },

  async updateReservationStatus(reservationId: string, status: Tables['reservations']['Row']['status'], notes?: string) {
    const updates: Tables['reservations']['Update'] = {
      status,
      updated_at: new Date().toISOString()
    };

    if (notes) {
      updates.notes = notes;
    }

    const { data, error } = await supabase
      .from('reservations')
      .update(updates)
      .eq('id', reservationId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating reservation status:', error);
      throw error;
    }
    return data;
  },

  async updateReservation(reservationId: string, updates: Tables['reservations']['Update']) {
    const { data, error } = await supabase
      .from('reservations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', reservationId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating reservation:', error);
      throw error;
    }
    return data;
  },

  async getEventReservations(eventId: string) {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        profiles(*)
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching event reservations:', error);
      throw error;
    }
    return data;
  },

  async getVideoReservations(videoId: string) {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        profiles(*)
      `)
      .eq('video_id', videoId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching video reservations:', error);
      throw error;
    }
    return data;
  },

  async getReservationsByDateRange(businessId: string, startDate: string, endDate: string) {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        profiles(*),
        events(*),
        videos(*)
      `)
      .eq('business_id', businessId)
      .gte('reservation_date', startDate)
      .lte('reservation_date', endDate)
      .order('reservation_date', { ascending: true });

    if (error) {
      logger.error('Error fetching reservations by date range:', error);
      throw error;
    }
    return data;
  },

  async cancelReservation(reservationId: string, reason?: string) {
    const updates: Tables['reservations']['Update'] = {
      status: 'cancelled',
      updated_at: new Date().toISOString()
    };

    if (reason) {
      updates.notes = reason;
    }

    const { data, error } = await supabase
      .from('reservations')
      .update(updates)
      .eq('id', reservationId)
      .select()
      .single();

    if (error) {
      logger.error('Error cancelling reservation:', error);
      throw error;
    }
    return data;
  },

  async getUpcomingReservations(userId: string, limit = 10) {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        profiles(*),
        events(*),
        videos(*)
      `)
      .eq('user_id', userId)
      .in('status', ['pending', 'confirmed'])
      .gte('reservation_date', new Date().toISOString().split('T')[0])
      .order('reservation_date', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('Error fetching upcoming reservations:', error);
      throw error;
    }
    return data;
  }
};

// Product operations
export const productService = {
  async createProduct(product: Tables['products']['Insert']) {
    // Ensure user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to create products');
    }

    // Ensure product business_id matches authenticated user
    if (product.business_id !== user.id) {
      throw new Error('Product business_id must match authenticated user ID');
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        ...product,
        sold_quantity: 0,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating product:', error);
      throw error;
    }
    return data;
  },

  async getProductsByEvent(eventId: string) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('Error fetching products for event:', error);
      throw error;
    }
    return data;
  },

  async getProductsByBusiness(businessId: string) {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        events(*)
      `)
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching business products:', error);
      throw error;
    }
    return data;
  },

  async updateProduct(productId: string, updates: Tables['products']['Update']) {
    // Ensure user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to update products');
    }

    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', productId)
      .eq('business_id', user.id) // Ensure user owns the product
      .select()
      .single();

    if (error) {
      logger.error('Error updating product:', error);
      throw error;
    }
    return data;
  },

  async deleteProduct(productId: string) {
    // Ensure user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to delete products');
    }

    const { error } = await supabase
      .from('products')
      .update({ is_active: false })
      .eq('id', productId)
      .eq('business_id', user.id); // Ensure user owns the product

    if (error) {
      logger.error('Error deleting product:', error);
      throw error;
    }
  },

  async getProduct(productId: string) {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        events(*),
        profiles(*)
      `)
      .eq('id', productId)
      .eq('is_active', true)
      .single();

    if (error) {
      logger.error('Error fetching product:', error);
      throw error;
    }
    return data;
  }
};

// ─── Video Comments Service ──────────────────────────────────────────────────
export const commentService = {
  isMissingAvatarGenderColumn(error: any) {
    return error?.code === '42703' || String(error?.message || '').includes('avatar_gender');
  },

  /** Fetch all visible comments for a video, joined with the author's profile. */
  async getComments(videoId: string) {
    const withGender = await supabase
      .from('video_comments')
      .select(`
        id,
        video_id,
        user_id,
        parent_id,
        text,
        likes_count,
        is_hidden,
        created_at,
        profiles:user_id (
          id,
          username,
          full_name,
          avatar_url,
          avatar_gender
        )
      `)
      .eq('video_id', videoId)
      .eq('is_hidden', false)
      .order('created_at', { ascending: true });

    if (!withGender.error) {
      return withGender.data ?? [];
    }

    if (!commentService.isMissingAvatarGenderColumn(withGender.error)) {
      logger.error('Error fetching comments:', withGender.error);
      throw withGender.error;
    }

    const legacy = await supabase
      .from('video_comments')
      .select(`
        id,
        video_id,
        user_id,
        parent_id,
        text,
        likes_count,
        is_hidden,
        created_at,
        profiles:user_id (
          id,
          username,
          full_name,
          avatar_url
        )
      `)
      .eq('video_id', videoId)
      .eq('is_hidden', false)
      .order('created_at', { ascending: true });

    if (legacy.error) {
      logger.error('Error fetching comments (legacy fallback):', legacy.error);
      throw legacy.error;
    }

    return legacy.data ?? [];
  },

  /** Insert a new comment. Returns the created row. */
  async addComment(videoId: string, userId: string, text: string, parentId?: string | null) {
    const withGender = await supabase
      .from('video_comments')
      .insert({
        video_id: videoId,
        user_id: userId,
        text,
        parent_id: parentId ?? null,
      })
      .select(`
        id,
        video_id,
        user_id,
        parent_id,
        text,
        likes_count,
        is_hidden,
        created_at,
        profiles:user_id (
          id,
          username,
          full_name,
          avatar_url,
          avatar_gender
        )
      `)
      .single();

    if (!withGender.error) {
      return withGender.data;
    }

    if (!commentService.isMissingAvatarGenderColumn(withGender.error)) {
      logger.error('Error adding comment:', withGender.error);
      throw withGender.error;
    }

    const legacy = await supabase
      .from('video_comments')
      .insert({
        video_id: videoId,
        user_id: userId,
        text,
        parent_id: parentId ?? null,
      })
      .select(`
        id,
        video_id,
        user_id,
        parent_id,
        text,
        likes_count,
        is_hidden,
        created_at,
        profiles:user_id (
          id,
          username,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (legacy.error) {
      logger.error('Error adding comment (legacy fallback):', legacy.error);
      throw legacy.error;
    }

    return legacy.data;
  },

  /** Video owner hides a comment; sets is_hidden = true. */
  async hideComment(commentId: string) {
    const { error } = await supabase
      .from('video_comments')
      .update({ is_hidden: true })
      .eq('id', commentId);
    if (error) throw error;
  },

  /** Delete a comment (author or owner). */
  async deleteComment(commentId: string) {
    const { error } = await supabase
      .from('video_comments')
      .delete()
      .eq('id', commentId);
    if (error) throw error;
  },
};

// ─── Video Ratings Service ────────────────────────────────────────────────────
export const ratingService = {
  /** Upsert a rating (insert or update the user's existing rating). */
  async upsertRating(videoId: string, userId: string, rating: number) {
    const { data, error } = await supabase
      .from('video_ratings')
      .upsert(
        { video_id: videoId, user_id: userId, rating },
        { onConflict: 'video_id,user_id' }
      )
      .select()
      .single();

    if (error) {
      logger.error('Error upserting rating:', error);
      throw error;
    }
    return data;
  },

  /** Get the current user's rating for a video, or null if none. */
  async getUserRating(videoId: string, userId: string): Promise<number | null> {
    const { data, error } = await supabase
      .from('video_ratings')
      .select('rating')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('Error fetching user rating:', error);
      return null;
    }
    return data?.rating ?? null;
  },

  /** Video owner hides a 1-star rating (sets is_hidden = true). */
  async hideRating(ratingId: string) {
    const { error } = await supabase
      .from('video_ratings')
      .update({ is_hidden: true })
      .eq('id', ratingId);
    if (error) throw error;
  },
};

// ─── Video Likes + Shares Service ────────────────────────────────────────────
export const interactionService = {
  async likeVideo(videoId: string, userId: string) {
    const { error } = await supabase
      .from('video_likes')
      .insert({ video_id: videoId, user_id: userId });

    if (error && error.code !== '23505') {
      logger.error('Error liking video:', error);
      throw error;
    }
  },

  async unlikeVideo(videoId: string, userId: string) {
    const { error } = await supabase
      .from('video_likes')
      .delete()
      .eq('video_id', videoId)
      .eq('user_id', userId);

    if (error) {
      logger.error('Error unliking video:', error);
      throw error;
    }
  },

  async getUserLikedVideoIds(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('video_likes')
      .select('video_id')
      .eq('user_id', userId);

    if (error) {
      logger.warn('Unable to fetch user likes:', error);
      return [];
    }

    return (data ?? []).map(row => row.video_id);
  },

  async trackShare(videoId: string, userId: string, source?: string) {
    const { error } = await supabase
      .from('video_shares')
      .insert({
        video_id: videoId,
        user_id: userId,
        source: source ?? 'other',
      });

    if (error) {
      logger.error('Error tracking share:', error);
      throw error;
    }
  },
};

// Hidden videos management (user preferences)
let hiddenVideosTableUnavailable = false;

const isMissingHiddenVideosTableError = (error: any) => {
  return error?.code === 'PGRST205' || String(error?.message || '').includes('user_hidden_videos');
};

export const hiddenVideosService = {
  /**
   * Hide a video for the current user.
   * This persists to the database so the preference is maintained across devices.
   */
  async hideVideoForUser(videoId: string) {
    if (hiddenVideosTableUnavailable) {
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to hide videos');
    }

    const { error } = await supabase
      .from('user_hidden_videos')
      .insert({
        user_id: user.id,
        video_id: videoId,
      });

    if (error) {
      if (isMissingHiddenVideosTableError(error)) {
        hiddenVideosTableUnavailable = true;
        logger.warn('[Hidden Videos] user_hidden_videos table missing; hide/unhide preference disabled.');
        return;
      }
      // If duplicate key error, it's already hidden - that's fine
      if (error.code === '23505') {
        logger.debug('[Hidden Videos] Video already hidden for user:', videoId);
        return;
      }
      logger.error('Error hiding video:', error);
      throw error;
    }
    logger.debug('[Hidden Videos] Video hidden for user:', videoId);
  },

  /**
   * Unhide a video for the current user.
   */
  async unhideVideoForUser(videoId: string) {
    if (hiddenVideosTableUnavailable) {
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated to unhide videos');
    }

    const { error } = await supabase
      .from('user_hidden_videos')
      .delete()
      .eq('user_id', user.id)
      .eq('video_id', videoId);

    if (error) {
      if (isMissingHiddenVideosTableError(error)) {
        hiddenVideosTableUnavailable = true;
        logger.warn('[Hidden Videos] user_hidden_videos table missing; hide/unhide preference disabled.');
        return;
      }
      logger.error('Error unhiding video:', error);
      throw error;
    }
    logger.debug('[Hidden Videos] Video unhidden for user:', videoId);
  },

  /**
   * Get all hidden video IDs for the current user.
   */
  async getHiddenVideosForUser(): Promise<string[]> {
    if (hiddenVideosTableUnavailable) {
      return [];
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return [];
    }

    const { data, error } = await supabase
      .from('user_hidden_videos')
      .select('video_id')
      .eq('user_id', user.id);

    if (error) {
      if (isMissingHiddenVideosTableError(error)) {
        hiddenVideosTableUnavailable = true;
        logger.warn('[Hidden Videos] user_hidden_videos table missing; returning no hidden videos.');
        return [];
      }
      logger.error('Error fetching hidden videos:', error);
      return [];
    }

    return (data ?? []).map(row => row.video_id);
  },

  /**
   * Check if a video is hidden for the current user.
   */
  async isVideoHiddenForUser(videoId: string): Promise<boolean> {
    if (hiddenVideosTableUnavailable) {
      return false;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return false;
    }

    const { data, error } = await supabase
      .from('user_hidden_videos')
      .select('id')
      .eq('user_id', user.id)
      .eq('video_id', videoId)
      .single();

    if (error) {
      if (isMissingHiddenVideosTableError(error)) {
        hiddenVideosTableUnavailable = true;
        return false;
      }
      // 'PGRST116' is "no rows found" error - that means it's not hidden
      if (error.code === 'PGRST116') {
        return false;
      }
      logger.error('Error checking if video is hidden:', error);
      return false;
    }

    return !!data;
  },
};

export type {
  Profile,
  Video,
  Order,
  Event,
  Voucher,
  Reservation,
  Follow
};
