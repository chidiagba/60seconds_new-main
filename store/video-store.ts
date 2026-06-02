
/////////////////////////////        31 jan    2026   /////////////////////


import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Video, Comment, RatingValue, ShareSource, SearchFilters, ShareAnalytics, TaggedUser, User, Attendee, AttendanceStatus, Product } from '@/types';
import { mockVideos } from '@/mocks/videos';

import { calculateDistance } from '@/utils/location';
import { DEFAULT_AVATAR_URL, resolveAvatarUrl } from '@/utils/avatar';
import { getEventLifecycleStatus } from '@/utils/event-status';
import { useAuthStore } from '@/store/auth-store';
import { videoService, storageService, productService, commentService, ratingService, interactionService } from '@/lib/database';
import { supabase } from '@/lib/supabase';

const VIDEO_FEED_CACHE_KEY = 'video-feed-cache-v2';
const VIDEO_FEED_CACHE_LIMIT = 3;
const FEED_PAGE_SIZE = 20;
const LOCATION_FILTER_BATCH_SIZE = 100;

const resolveProfileAvatar = (profile?: any): string =>
  resolveAvatarUrl({
    avatarUrl: profile?.avatar_url,
    avatarGender: profile?.avatar_gender,
    fallbackUrl: DEFAULT_AVATAR_URL,
  });

const resolveProductCurrency = (productRow: any, eventCurrency?: string | null): string => {
  const code = String(
    productRow?.currency || productRow?.currency_code || eventCurrency || 'USD'
  )
    .trim()
    .toUpperCase();

  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
};

const normalizeLocationCoordinate = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const persistVideoFeedCache = async (videos: Video[]) => {
  try {
    await AsyncStorage.setItem(
      VIDEO_FEED_CACHE_KEY,
      JSON.stringify(videos.slice(0, VIDEO_FEED_CACHE_LIMIT))
    );
  } catch (error) {
    console.warn('Failed to persist video feed cache:', error);
  }
};

const enrichVideoEventStatus = (
  video: Video,
  source?: {
    status?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    eventDate?: string | null;
  }
): Video => {
  const eventStartDate = source?.startDate || video.eventStartDate || video.eventDate || null;
  const eventEndDate = source?.endDate || video.eventEndDate || null;

  return {
    ...video,
    eventStartDate: eventStartDate || undefined,
    eventEndDate: eventEndDate || undefined,
    eventStatus: getEventLifecycleStatus({
      status: source?.status,
      startDate: eventStartDate,
      endDate: eventEndDate,
      eventDate: source?.eventDate || video.eventDate || null,
    }),
  };
};

const readVideoFeedCache = async (): Promise<Video[]> => {
  try {
    const rawValue = await AsyncStorage.getItem(VIDEO_FEED_CACHE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch (error) {
    console.warn('Failed to read video feed cache:', error);
    return [];
  }
};

const fetchAllVideoRows = async (batchSize = LOCATION_FILTER_BATCH_SIZE) => {
  const allVideos: any[] = [];
  let offset = 0;

  while (true) {
    const batch = await videoService.getVideos(batchSize, offset);
    if (batch.length === 0) {
      break;
    }

    allVideos.push(...batch);

    if (batch.length < batchSize) {
      break;
    }

    offset += batchSize;
  }

  return allVideos;
};


interface VideoState {
  videos: Video[];
  currentVideoIndex: number;
  comments: Comment[];
  isLoading: boolean;
  error: string | null;
  userLikedVideos: Set<string>;
  deletedVideoIds: Set<string>;
  
  hasMoreVideos: boolean;
  isFetchingMore: boolean;
  _feedOffset: number;
  
  // Actions
  loadCachedVideos: () => Promise<boolean>;
  fetchVideos: () => Promise<void>;
  fetchMoreVideos: () => Promise<void>;
  fetchVideoById: (id: string) => Promise<Video | null>;
  refreshVideoEngagement: (videoId: string) => Promise<void>;
  fetchComments: (videoId: string) => Promise<void>;
  likeVideo: (videoId: string) => Promise<void>;
  unlikeVideo: (videoId: string) => Promise<void>;
  isVideoLiked: (videoId: string) => boolean;
 loadUserLikes: (userId: string) => Promise<void>;
  clearUserLikes: () => void;
  addComment: (videoId: string, text: string, author?: User) => Promise<void>;
  addReply: (videoId: string, parentCommentId: string, text: string, author?: User) => Promise<void>;
  shareVideo: (videoId: string, source?: ShareSource) => Promise<void>;
  rateVideo: (videoId: string, rating: RatingValue) => Promise<void>;
  setCurrentVideoIndex: (index: number) => void;
  searchVideos: (query: string, filters?: SearchFilters) => Promise<Video[]>;
  filterVideosByLocation: (latitude: number, longitude: number, radiusKm: number) => Promise<void>;
  addTaggedUser: (videoId: string, user: User, timestamp?: number, position?: { x: number, y: number }) => void;
  removeTaggedUser: (videoId: string, userId: string) => void;
  uploadVideo: (video: Video) => void;
  
  // Attendance actions
  attendEvent: (videoId: string, status: AttendanceStatus, notes?: string) => void;
  cancelAttendance: (videoId: string) => void;
  isAttending: (videoId: string) => AttendanceStatus | null;
  getEventAttendees: (videoId: string) => Attendee[];

  // Content moderation
  removeVideo: (videoId: string) => Promise<void>;
  syncUserProfile: (userId: string, updates: Partial<User>) => void;
}

export const useVideoStore = create<VideoState>((set, get) => ({
  videos: [],
  currentVideoIndex: 0,
  comments: [],
  isLoading: false,
  error: null,
  userLikedVideos: new Set<string>(),
  deletedVideoIds: new Set<string>(),
  hasMoreVideos: true,
  isFetchingMore: false,
  _feedOffset: 0,

  loadCachedVideos: async () => {
    const cachedVideos = await readVideoFeedCache();
    if (cachedVideos.length === 0) {
      return false;
    }

    const { deletedVideoIds } = get();
    const visibleVideos = cachedVideos
      .filter((video) => video?.id && !deletedVideoIds.has(video.id))
      .map((video) => enrichVideoEventStatus(video as Video));
    if (visibleVideos.length === 0) {
      return false;
    }

    set((state) => {
      if (state.videos.length > 0) {
        return state;
      }

      return {
        videos: visibleVideos,
        error: null,
      };
    });

    return true;
  },
  
  fetchVideos: async () => {
    console.log('📹 VideoStore: Fetching videos from database...');
    set({ isLoading: true, error: null });
    try {
      const videosData = await videoService.getVideos(FEED_PAGE_SIZE, 0);
      console.log('📹 VideoStore: Fetched', videosData.length, 'videos from database');
      
      if (videosData.length === 0) {
        console.warn('📹 VideoStore: No videos found in database');
        set({ videos: [], isLoading: false, _feedOffset: 0, hasMoreVideos: false });
        return;
      }
      
      const videoIds = videosData.map(v => v.id);
      
      let eventsData: any[] = [];
      if (videoIds.length > 0) {
        try {
          const { data } = await supabase
            .from('events')
            .select('id, video_id, currency, start_date, end_date, status')
            .in('video_id', videoIds);
          if (data) eventsData = data;
        } catch (e) { console.warn('📹 VideoStore: Error fetching batched events:', e); }
      }

      const eventIdByVideoId = new Map<string, string>();
      const eventCurrencyByEventId = new Map<string, string>();
      const eventDetailsByVideoId = new Map<string, { status?: string | null; startDate?: string | null; endDate?: string | null }>();
      const eventIds: string[] = [];
      eventsData.forEach(e => {
        if (e.video_id && e.id) {
          eventIdByVideoId.set(e.video_id, e.id);
          eventIds.push(e.id);
          if (e.currency) {
            eventCurrencyByEventId.set(e.id, String(e.currency).trim().toUpperCase());
          }
          eventDetailsByVideoId.set(e.video_id, {
            status: e.status,
            startDate: e.start_date,
            endDate: e.end_date,
          });
        }
      });

      let productsData: any[] = [];
      if (eventIds.length > 0) {
        try {
          const { data } = await supabase.from('products').select('*').in('event_id', eventIds);
          if (data) productsData = data;
        } catch (e) { console.warn('📹 VideoStore: Error fetching batched products:', e); }
      }

      const productsByEventId = new Map<string, Product[]>();
      productsData.forEach(p => {
        if (p.event_id) {
          const existing = productsByEventId.get(p.event_id) || [];
          existing.push({ id: p.id, videoId: '', name: p.name, description: p.description || '', price: p.price, image: p.image_url || '', type: p.type, available: p.available_quantity, sold: p.sold_quantity, createdAt: p.created_at, currency: resolveProductCurrency(p, eventCurrencyByEventId.get(p.event_id)) });
          productsByEventId.set(p.event_id, existing);
        }
      });

      const videosWithProducts = videosData.map((videoData) => {
        let resolvedVideoUrl = (typeof videoData.video_url === 'string' && videoData.video_url.trim().length > 0 ? videoData.video_url.trim() : typeof (videoData as any).url === 'string' && (videoData as any).url.trim().length > 0 ? (videoData as any).url.trim() : '');
        if (resolvedVideoUrl && !/^https?:\/\//i.test(resolvedVideoUrl) && !/^file:\/\//i.test(resolvedVideoUrl)) { resolvedVideoUrl = supabase.storage.from('videos').getPublicUrl(resolvedVideoUrl).data.publicUrl; }
        let resolvedThumbnailUrl = (typeof videoData.thumbnail_url === 'string' && videoData.thumbnail_url.trim().length > 0 ? videoData.thumbnail_url.trim() : '');
        if (resolvedThumbnailUrl && !/^https?:\/\//i.test(resolvedThumbnailUrl) && !/^file:\/\//i.test(resolvedThumbnailUrl)) { resolvedThumbnailUrl = supabase.storage.from('images').getPublicUrl(resolvedThumbnailUrl).data.publicUrl; }
        const eventId = eventIdByVideoId.get(videoData.id) || undefined;
        let products = eventId ? (productsByEventId.get(eventId) || []) : [];
        products = products.map(p => ({ ...p, videoId: videoData.id }));
        return enrichVideoEventStatus({
          id: videoData.id, url: resolvedVideoUrl,
          thumbnail: resolvedThumbnailUrl || 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80',
          description: videoData.description || undefined, likes: videoData.likes_count || 0, comments: videoData.comments_count || 0, shares: videoData.shares_count || 0, rating: videoData.rating || 0, ratingCount: videoData.rating_count || 0, userId: videoData.user_id,
          user: { id: videoData.profiles?.id || videoData.user_id, username: videoData.profiles?.username || 'Unknown', name: videoData.profiles?.full_name || 'Unknown User', avatar: resolveProfileAvatar(videoData.profiles), isBusinessAccount: videoData.profiles?.user_type === 'business', followers: videoData.profiles?.followers_count || 0, following: videoData.profiles?.following_count || 0, bio: videoData.profiles?.bio || undefined, businessName: videoData.profiles?.business_name || undefined, businessType: videoData.profiles?.business_type || undefined },
          createdAt: videoData.created_at,
          location: { name: videoData.location_name || '', address: '', state: '', latitude: normalizeLocationCoordinate(videoData.location_latitude), longitude: normalizeLocationCoordinate(videoData.location_longitude), city: videoData.location_city || '', country: videoData.location_country || '' },
          eventName: videoData.event_name || '', eventDate: videoData.event_date || undefined, products, hashtags: videoData.hashtags || [], caption: videoData.description || undefined, eventId,
        } as Video, eventDetailsByVideoId.get(videoData.id));
      });
      
      const { deletedVideoIds } = get();
      const visibleVideos = videosWithProducts.filter((video) => !deletedVideoIds.has(video.id));
      console.log('📹 VideoStore: Transformed', visibleVideos.length, 'videos successfully');
      await persistVideoFeedCache(visibleVideos);
      // Reset pagination state on a fresh fetch
      set({ videos: visibleVideos, isLoading: false, _feedOffset: FEED_PAGE_SIZE, hasMoreVideos: videosData.length >= FEED_PAGE_SIZE });
    } catch (error) {
      console.error('📹 VideoStore: Error fetching videos:', error);
      const { deletedVideoIds } = get();
      const fallbackVideos = mockVideos.filter((video) => !deletedVideoIds.has(video.id));
      await persistVideoFeedCache(fallbackVideos);
      set({ videos: fallbackVideos, isLoading: false, error: null, _feedOffset: 0, hasMoreVideos: false });
    }
  },

  fetchMoreVideos: async () => {
    const { isFetchingMore, hasMoreVideos, _feedOffset, deletedVideoIds } = get();
    if (isFetchingMore || !hasMoreVideos) return;

    console.log('📹 VideoStore: Fetching more videos, offset =', _feedOffset);
    set({ isFetchingMore: true });
    try {
      const videosData = await videoService.getVideos(FEED_PAGE_SIZE, _feedOffset);
      console.log('📹 VideoStore: Fetched', videosData.length, 'more videos');

      if (videosData.length === 0) {
        set({ hasMoreVideos: false, isFetchingMore: false });
        return;
      }

      const videoIds = videosData.map(v => v.id);
      let eventsData: any[] = [];
      if (videoIds.length > 0) {
        try {
          const { data } = await supabase
            .from('events')
            .select('id, video_id, currency, start_date, end_date, status')
            .in('video_id', videoIds);
          if (data) eventsData = data;
        } catch (e) {}
      }
      const eventIdByVideoId = new Map<string, string>();
      const eventCurrencyByEventId = new Map<string, string>();
      const eventDetailsByVideoId = new Map<string, { status?: string | null; startDate?: string | null; endDate?: string | null }>();
      const eventIds: string[] = [];
      eventsData.forEach(e => {
        if (e.video_id && e.id) {
          eventIdByVideoId.set(e.video_id, e.id);
          eventIds.push(e.id);
          if (e.currency) {
            eventCurrencyByEventId.set(e.id, String(e.currency).trim().toUpperCase());
          }
          eventDetailsByVideoId.set(e.video_id, {
            status: e.status,
            startDate: e.start_date,
            endDate: e.end_date,
          });
        }
      });

      let productsData: any[] = [];
      if (eventIds.length > 0) {
        try { const { data } = await supabase.from('products').select('*').in('event_id', eventIds); if (data) productsData = data; } catch (e) {}
      }
      const productsByEventId = new Map<string, Product[]>();
      productsData.forEach(p => {
        if (p.event_id) {
          const existing = productsByEventId.get(p.event_id) || [];
          existing.push({ id: p.id, videoId: '', name: p.name, description: p.description || '', price: p.price, image: p.image_url || '', type: p.type, available: p.available_quantity, sold: p.sold_quantity, createdAt: p.created_at, currency: resolveProductCurrency(p, eventCurrencyByEventId.get(p.event_id)) });
          productsByEventId.set(p.event_id, existing);
        }
      });

      const newVideos = videosData.map((videoData) => {
        let resolvedVideoUrl = (typeof videoData.video_url === 'string' && videoData.video_url.trim().length > 0 ? videoData.video_url.trim() : '');
        if (resolvedVideoUrl && !/^https?:\/\//i.test(resolvedVideoUrl) && !/^file:\/\//i.test(resolvedVideoUrl)) { resolvedVideoUrl = supabase.storage.from('videos').getPublicUrl(resolvedVideoUrl).data.publicUrl; }
        let resolvedThumbnailUrl = (typeof videoData.thumbnail_url === 'string' && videoData.thumbnail_url.trim().length > 0 ? videoData.thumbnail_url.trim() : '');
        if (resolvedThumbnailUrl && !/^https?:\/\//i.test(resolvedThumbnailUrl) && !/^file:\/\//i.test(resolvedThumbnailUrl)) { resolvedThumbnailUrl = supabase.storage.from('images').getPublicUrl(resolvedThumbnailUrl).data.publicUrl; }
        const eventId = eventIdByVideoId.get(videoData.id) || undefined;
        let products = eventId ? (productsByEventId.get(eventId) || []) : [];
        products = products.map(p => ({ ...p, videoId: videoData.id }));
        return enrichVideoEventStatus({
          id: videoData.id, url: resolvedVideoUrl,
          thumbnail: resolvedThumbnailUrl || 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80',
          description: videoData.description || undefined, likes: videoData.likes_count || 0, comments: videoData.comments_count || 0, shares: videoData.shares_count || 0, rating: videoData.rating || 0, ratingCount: videoData.rating_count || 0, userId: videoData.user_id,
          user: { id: videoData.profiles?.id || videoData.user_id, username: videoData.profiles?.username || 'Unknown', name: videoData.profiles?.full_name || 'Unknown User', avatar: resolveProfileAvatar(videoData.profiles), isBusinessAccount: videoData.profiles?.user_type === 'business', followers: videoData.profiles?.followers_count || 0, following: videoData.profiles?.following_count || 0, bio: videoData.profiles?.bio || undefined, businessName: videoData.profiles?.business_name || undefined, businessType: videoData.profiles?.business_type || undefined },
          createdAt: videoData.created_at,
          location: { name: videoData.location_name || '', address: '', state: '', latitude: normalizeLocationCoordinate(videoData.location_latitude), longitude: normalizeLocationCoordinate(videoData.location_longitude), city: videoData.location_city || '', country: videoData.location_country || '' },
          eventName: videoData.event_name || '', eventDate: videoData.event_date || undefined, products, hashtags: videoData.hashtags || [], caption: videoData.description || undefined, eventId,
        } as Video, eventDetailsByVideoId.get(videoData.id));
      }).filter(v => !deletedVideoIds.has(v.id));

      // Deduplicate against existing videos
      const existingIds = new Set(get().videos.map(v => v.id));
      const uniqueNew = newVideos.filter(v => !existingIds.has(v.id));
      
      set((state) => ({
        videos: [...state.videos, ...uniqueNew],
        _feedOffset: _feedOffset + FEED_PAGE_SIZE,
        hasMoreVideos: videosData.length >= FEED_PAGE_SIZE,
        isFetchingMore: false,
      }));
    } catch (error) {
      console.error('📹 VideoStore: Error fetching more videos:', error);
      set({ isFetchingMore: false });
    }
  },
  
  // Note: an earlier incomplete block caused a syntax error here. It has been removed.

  syncUserProfile: (userId: string, updates: Partial<User>) => {
    set((state) => ({
      videos: state.videos.map((video) => {
        if (video.userId !== userId && video.user?.id !== userId) {
          return video;
        }

        return {
          ...video,
          user: {
            ...video.user,
            ...updates,
          },
        };
      }),
      comments: state.comments.map((comment) => {
        if (comment.userId !== userId && comment.user?.id !== userId) {
          return comment;
        }

        return {
          ...comment,
          user: {
            ...comment.user,
            ...updates,
          },
        };
      }),
    }));
  },
  
  fetchVideoById: async (id: string) => {
    const { videos } = get();
    
    // If videos are already loaded, find the video
    let video = videos.find(v => v.id === id);
    if (video) return video;
    
    // Otherwise, try to fetch it explicitly
    try {
      console.log(`📹 VideoStore: Fetching missing video by ID: ${id}`);
      const videoData = await videoService.getVideo(id);
      if (!videoData) return null;

      let resolvedVideoUrl =
        (typeof videoData.video_url === 'string' && videoData.video_url.trim().length > 0
          ? videoData.video_url.trim()
          : typeof (videoData as any).url === 'string' && (videoData as any).url.trim().length > 0
          ? (videoData as any).url.trim()
          : '');

      if (resolvedVideoUrl && !/^https?:\/\//i.test(resolvedVideoUrl) && !/^file:\/\//i.test(resolvedVideoUrl)) {
        resolvedVideoUrl = supabase.storage.from('videos').getPublicUrl(resolvedVideoUrl).data.publicUrl;
      }

      let resolvedThumbnailUrl =
        (typeof videoData.thumbnail_url === 'string' && videoData.thumbnail_url.trim().length > 0
          ? videoData.thumbnail_url.trim()
          : '');

      if (resolvedThumbnailUrl && !/^https?:\/\//i.test(resolvedThumbnailUrl) && !/^file:\/\//i.test(resolvedThumbnailUrl)) {
        resolvedThumbnailUrl = supabase.storage.from('images').getPublicUrl(resolvedThumbnailUrl).data.publicUrl;
      }

      // Fetch related event
      let eventId = undefined;
      let eventCurrency: string | null = null;
      let eventData: { id: string; currency?: string | null; start_date?: string | null; end_date?: string | null; status?: string | null } | null = null;
      try {
        const { data } = await supabase
          .from('events')
          .select('id, currency, start_date, end_date, status')
          .eq('video_id', id)
          .maybeSingle();
        if (data) {
          eventData = data;
          eventId = data.id;
          eventCurrency = data.currency || null;
        }
      } catch (e) {}

      // Fetch related products
      let productsData: any[] = [];
      if (eventId) {
        try {
          const { data } = await supabase
            .from('products')
            .select('*')
            .eq('event_id', eventId);
          if (data) productsData = data;
        } catch (e) {}
      }

      const products: Product[] = productsData.map(p => ({
        id: p.id,
        videoId: id,
        name: p.name,
        description: p.description || undefined,
        price: p.price,
        image: p.image_url || '',
        type: p.type,
        available: p.available_quantity,
        sold: p.sold_quantity,
        createdAt: p.created_at,
        currency: resolveProductCurrency(p, eventCurrency),
      }));

      const formattedVideo: Video = enrichVideoEventStatus({
        id: videoData.id,
        url: resolvedVideoUrl,
        thumbnail: resolvedThumbnailUrl || 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80',
        description: videoData.description || undefined,
        likes: videoData.likes_count || 0,
        comments: videoData.comments_count || 0,
        shares: videoData.shares_count || 0,
        rating: videoData.rating || 0,
        ratingCount: videoData.rating_count || 0,
        userId: videoData.user_id,
        user: {
          id: videoData.profiles?.id || videoData.user_id,
          username: videoData.profiles?.username || 'Unknown',
          name: videoData.profiles?.full_name || 'Unknown User',
          avatar: resolveProfileAvatar(videoData.profiles),
          isBusinessAccount: videoData.profiles?.user_type === 'business',
          followers: videoData.profiles?.followers_count || 0,
          following: videoData.profiles?.following_count || 0,
          bio: videoData.profiles?.bio || undefined,
          businessName: videoData.profiles?.business_name || undefined,
          businessType: videoData.profiles?.business_type || undefined,
        },
        createdAt: videoData.created_at,
        location: {
          name: videoData.location_name || '',
          address: '',
          state: '',
          latitude: normalizeLocationCoordinate(videoData.location_latitude),
          longitude: normalizeLocationCoordinate(videoData.location_longitude),
          city: videoData.location_city || '',
          country: videoData.location_country || '',
        },
        eventName: videoData.event_name || '',
        eventDate: videoData.event_date || undefined,
        products: products,
        hashtags: videoData.hashtags || [],
        caption: videoData.description || undefined,
        eventId: eventId,
      }, eventData ? {
        status: eventData.status,
        startDate: eventData.start_date,
        endDate: eventData.end_date,
      } : undefined);

      // Add the explicitly fetched video to the front of the feed
      console.log('📹 VideoStore: Successfully formatted explicitly fetched video:', {
        id: formattedVideo.id,
        url: formattedVideo.url,
        hasUser: !!formattedVideo.user,
        username: formattedVideo.user?.username
      });

      set((state) => {
        // Double check it wasn't added concurrently
        const existing = state.videos.find(v => v.id === id);
        if (existing) {
          console.log('📹 VideoStore: Video already in store, updating it.');
          return {
            videos: state.videos.map(v => v.id === id ? formattedVideo : v)
          };
        }
        return { videos: [formattedVideo, ...state.videos] };
      });

      return formattedVideo;
    } catch (e) {
      console.error('📹 VideoStore: Error explicitly fetching video by ID', e);
      return null;
    }
  },

  refreshVideoEngagement: async (videoId: string) => {
    if (!videoId) return;

    try {
      const { data, error } = await supabase
        .from('videos')
        .select('id, likes_count, comments_count, shares_count, rating, rating_count')
        .eq('id', videoId)
        .maybeSingle();

      if (error) {
        console.warn('Failed to refresh engagement for video:', videoId, error);
        return;
      }

      if (!data) return;

      set((state) => ({
        videos: state.videos.map((video) =>
          video.id === videoId
            ? {
                ...video,
                likes: data.likes_count ?? video.likes,
                comments: data.comments_count ?? video.comments,
                shares: data.shares_count ?? video.shares,
                rating: data.rating ?? video.rating,
                ratingCount: data.rating_count ?? video.ratingCount,
              }
            : video
        ),
      }));
    } catch (error) {
      console.warn('Unexpected error while refreshing engagement:', error);
    }
  },
  
  fetchComments: async (videoId: string) => {
    const hasCachedComments = get().comments.some((comment) => comment.videoId === videoId);
    set({ isLoading: !hasCachedComments, error: null });
    try {
      const rows = await commentService.getComments(videoId);

      // Map DB rows → Comment shape used by the UI
      const comments: Comment[] = rows.map((row: any) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const resolvedAvatar = resolveProfileAvatar(profile);
        return {
          id: row.id,
          videoId: row.video_id,
          userId: row.user_id,
          parentId: row.parent_id ?? undefined,
          text: row.text,
          likes: row.likes_count,
          createdAt: row.created_at,
          user: {
            id: row.user_id,
            name: profile?.full_name || profile?.username || 'User',
            username: profile?.username || 'user',
            email: '',
            avatar: resolvedAvatar,
            followers: 0,
            following: 0,
            isBusinessAccount: false,
          },
        };
      });

      // Keep existing comments for other videos intact, replace for this video
      set(state => ({
        comments: [
          ...state.comments.filter(c => c.videoId !== videoId),
          ...comments,
        ],
        isLoading: false,
      }));
    } catch (err) {
      console.error('fetchComments error:', err);
      set({ error: 'Failed to fetch comments', isLoading: false });
    }
  },
  
  likeVideo: async (videoId: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    const state = get();
    if (state.userLikedVideos.has(videoId)) return; // Already liked
    
    set(state => ({
      videos: state.videos.map(video => 
        video.id === videoId 
          ? { ...video, likes: video.likes + 1 } 
          : video
      ),
      userLikedVideos: new Set([...state.userLikedVideos, videoId])
    }));

    try {
      await interactionService.likeVideo(videoId, user.id);
      const { data } = await supabase
        .from('videos')
        .select('likes_count')
        .eq('id', videoId)
        .single();

      if (data) {
        set(current => ({
          videos: current.videos.map(video =>
            video.id === videoId ? { ...video, likes: data.likes_count } : video
          ),
        }));
      }
    } catch (error) {
      // Roll back optimistic update when DB write fails
      set(current => {
        const updated = new Set(current.userLikedVideos);
        updated.delete(videoId);
        return {
          videos: current.videos.map(video =>
            video.id === videoId ? { ...video, likes: Math.max(0, video.likes - 1) } : video
          ),
          userLikedVideos: updated,
        };
      });
      console.warn('Failed to persist like:', error);
    }
  },
  
  unlikeVideo: async (videoId: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    const state = get();
    if (!state.userLikedVideos.has(videoId)) return; // Not liked
    
    set(state => {
      const updated = new Set(state.userLikedVideos);
      updated.delete(videoId);
      return {
        videos: state.videos.map(video => 
          video.id === videoId 
            ? { ...video, likes: Math.max(0, video.likes - 1) } 
            : video
        ),
        userLikedVideos: updated
      };
    });

    try {
      await interactionService.unlikeVideo(videoId, user.id);
      const { data } = await supabase
        .from('videos')
        .select('likes_count')
        .eq('id', videoId)
        .single();

      if (data) {
        set(current => ({
          videos: current.videos.map(video =>
            video.id === videoId ? { ...video, likes: data.likes_count } : video
          ),
        }));
      }
    } catch (error) {
      // Roll back optimistic update when DB write fails
      set(current => ({
        videos: current.videos.map(video =>
          video.id === videoId ? { ...video, likes: video.likes + 1 } : video
        ),
        userLikedVideos: new Set([...current.userLikedVideos, videoId]),
      }));
      console.warn('Failed to persist unlike:', error);
    }
  },
  
  isVideoLiked: (videoId: string) => {
    return get().userLikedVideos.has(videoId);
  },
  
  loadUserLikes: async (userId: string) => {
    try {
      const likedVideoIds = await interactionService.getUserLikedVideoIds(userId);
      set({ userLikedVideos: new Set(likedVideoIds) });
    } catch (error) {
      console.warn('Failed to load user likes from database:', error);
    }
  },
  
  clearUserLikes: () => {
    set({ userLikedVideos: new Set<string>() });
  },
  
  addComment: async (videoId: string, text: string, author?: User) => {
    const { user: storeUser } = useAuthStore.getState();
    const user = author || storeUser;
    if (!user) return;

    try {
      const row = await commentService.addComment(videoId, user.id, text);

      const profile = Array.isArray(row.profiles) ? (row as any).profiles[0] : (row as any).profiles;
      const resolvedAvatar = resolveAvatarUrl({
        avatarUrl: profile?.avatar_url || user.avatar,
        avatarGender: profile?.avatar_gender,
        fallbackUrl: DEFAULT_AVATAR_URL,
      });
      const newComment: Comment = {
        id: row.id,
        videoId: row.video_id,
        userId: row.user_id,
        parentId: row.parent_id ?? undefined,
        text: row.text,
        likes: row.likes_count,
        createdAt: row.created_at,
        user: {
          id: user.id,
          name: profile?.full_name || user.name || user.username,
          username: profile?.username || user.username,
          email: user.email || '',
          avatar: resolvedAvatar,
          followers: user.followers || 0,
          following: user.following || 0,
          isBusinessAccount: user.isBusinessAccount || false,
        },
      };

      set(state => ({
        comments: [newComment, ...state.comments],
        videos: state.videos.map(video =>
          video.id === videoId
            ? { ...video, comments: video.comments + 1 }
            : video
        ),
      }));

      await get().refreshVideoEngagement(videoId);
    } catch (err) {
      console.error('addComment error:', err);
    }
  },
  
  addReply: async (videoId: string, parentCommentId: string, text: string, author?: User) => {
    const { user: storeUser } = useAuthStore.getState();
    const user = author || storeUser;
    if (!user) return;

    try {
      const row = await commentService.addComment(videoId, user.id, text, parentCommentId);

      const profile = Array.isArray((row as any).profiles) ? (row as any).profiles[0] : (row as any).profiles;
      const resolvedAvatar = resolveAvatarUrl({
        avatarUrl: profile?.avatar_url || user.avatar,
        avatarGender: profile?.avatar_gender,
        fallbackUrl: DEFAULT_AVATAR_URL,
      });
      const newReply: Comment = {
        id: row.id,
        videoId: row.video_id,
        userId: row.user_id,
        parentId: row.parent_id ?? undefined,
        text: row.text,
        likes: row.likes_count,
        createdAt: row.created_at,
        user: {
          id: user.id,
          name: profile?.full_name || user.name || user.username,
          username: profile?.username || user.username,
          email: user.email || '',
          avatar: resolvedAvatar,
          followers: user.followers || 0,
          following: user.following || 0,
          isBusinessAccount: user.isBusinessAccount || false,
        },
      };

      set(state => ({
        comments: [...state.comments, newReply],
        videos: state.videos.map(video =>
          video.id === videoId
            ? { ...video, comments: video.comments + 1 }
            : video
        ),
      }));

      await get().refreshVideoEngagement(videoId);
    } catch (err) {
      console.error('addReply error:', err);
    }
  },
  
  shareVideo: async (videoId: string, source?: ShareSource) => {
    const { user } = useAuthStore.getState();

    set(state => ({
      videos: state.videos.map(video => {
        if (video.id === videoId) {
          const currentAnalytics = video.shareAnalytics || { total: 0 };
          const sourceCount = source ? (currentAnalytics[source] || 0) + 1 : 0;
          
          const updatedAnalytics: ShareAnalytics = {
            ...currentAnalytics,
            ...(source ? { [source]: sourceCount } : {}),
            total: currentAnalytics.total + 1
          };
          
          return { 
            ...video, 
            shares: video.shares + 1,
            shareAnalytics: updatedAnalytics
          };
        }
        return video;
      })
    }));

    if (!user) {
      return;
    }

    try {
      await interactionService.trackShare(videoId, user.id, source);
      const { data } = await supabase
        .from('videos')
        .select('shares_count')
        .eq('id', videoId)
        .single();

      if (data) {
        set(current => ({
          videos: current.videos.map(video =>
            video.id === videoId ? { ...video, shares: data.shares_count } : video
          ),
        }));
      }
    } catch (error) {
      console.error('shareVideo error:', error);
    }
  },
  
  rateVideo: async (videoId: string, rating: RatingValue) => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    // Optimistic UI update
    set(state => ({
      videos: state.videos.map(video => {
        if (video.id === videoId) {
          const newRatingCount = video.ratingCount + 1;
          const newRating = ((video.rating * video.ratingCount) + rating) / newRatingCount;
          return {
            ...video,
            rating: parseFloat(newRating.toFixed(1)),
            ratingCount: newRatingCount,
          };
        }
        return video;
      }),
    }));

    try {
      await ratingService.upsertRating(videoId, user.id, rating);
      // After DB trigger updates videos.rating/rating_count, re-fetch this video
      // to stay in sync (trigger runs server-side)
      const { data } = await (await import('@/lib/supabase')).supabase
        .from('videos')
        .select('rating, rating_count')
        .eq('id', videoId)
        .single();
      if (data) {
        set(state => ({
          videos: state.videos.map(video =>
            video.id === videoId
              ? { ...video, rating: data.rating, ratingCount: data.rating_count }
              : video
          ),
        }));
      }
    } catch (err) {
      console.error('rateVideo error:', err);
    }
  },
  
  setCurrentVideoIndex: (index: number) => {
    set({ currentVideoIndex: index });
  },
  
  searchVideos: async (query: string, filters?: SearchFilters) => {
    set({ isLoading: true });
    
    try {
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const { videos } = get();
      const searchQuery = query.toLowerCase();
      
      let filteredVideos = videos;
      
      // Apply search query
      if (searchQuery) {
        filteredVideos = filteredVideos.filter(video => 
          video.eventName.toLowerCase().includes(searchQuery) ||
          video.location.name.toLowerCase().includes(searchQuery) ||
          video.location.city?.toLowerCase().includes(searchQuery) ||
          video.hashtags?.some(tag => tag.toLowerCase().includes(searchQuery)) ||
          video.description?.toLowerCase().includes(searchQuery) ||
          // Search in tagged users
          video.taggedUsers?.some(taggedUser => 
            taggedUser.user.username.toLowerCase().includes(searchQuery) ||
            taggedUser.user.name.toLowerCase().includes(searchQuery)
          )
        );
      }
      
      // Apply additional filters if provided
      if (filters) {
        if (filters.location) {
          const locationQuery = filters.location.toLowerCase();
          filteredVideos = filteredVideos.filter(video => 
            video.location.name.toLowerCase().includes(locationQuery) ||
            video.location.city?.toLowerCase().includes(locationQuery) ||
            video.location.address?.toLowerCase().includes(locationQuery)
          );
        }
        
        if (filters.hashtag) {
          const hashtagQuery = filters.hashtag.toLowerCase();
          filteredVideos = filteredVideos.filter(video => 
            video.hashtags?.some(tag => tag.toLowerCase().includes(hashtagQuery))
          );
        }
        
        if (filters.eventName) {
          const eventQuery = filters.eventName.toLowerCase();
          filteredVideos = filteredVideos.filter(video => 
            video.eventName.toLowerCase().includes(eventQuery)
          );
        }
        
        if (filters.date) {
          // In a real app, we would implement date filtering
          // This is a placeholder - date filtering not implemented
        }
        
        if (filters.price) {
          // In a real app, we would implement price filtering
          // This is a placeholder - price filtering not implemented
        }
      }
      
      set({ isLoading: false });
      return filteredVideos;
    } catch {
      set({ error: 'Failed to search videos', isLoading: false });
      return [];
    }
  },

  filterVideosByLocation: async (latitude: number, longitude: number, radiusKm: number) => {
    set({ isLoading: true, error: null });
    try {
      // Fetch the full feed in batches so location mode can still reach older videos.
      const supabaseVideos = await fetchAllVideoRows();
      
      // Transform and filter videos by location
      const transformedAndFilteredVideos: Video[] = [];
      
      for (const video of supabaseVideos) {
        // Skip videos without location data
        if (!video.location_latitude || !video.location_longitude) {
          continue;
        }
        
        // Calculate distance
        const distance = calculateDistance(
          latitude,
          longitude,
          video.location_latitude,
          video.location_longitude
        );
        
        // Only include videos within the specified radius
        if (distance <= radiusKm) {
          // Get the public URL for the video
          // Check if video_url is already a full URL or just a path
          let videoUrl = video.video_url;
          if (!videoUrl.startsWith('http')) {
            // It's a path, get the public URL
            videoUrl = await storageService.getVideoUrl(video.video_url);
          }
          
          const transformedVideo: Video = {
            id: video.id,
            userId: video.user_id,
            user: video.profiles ? {
              id: video.profiles.id,
              username: video.profiles.username,
              name: video.profiles.full_name,
              avatar: resolveProfileAvatar(video.profiles),
              isBusinessAccount: video.profiles.user_type === 'business',
              followers: video.profiles.followers_count,
              following: video.profiles.following_count,
              bio: video.profiles.bio,
              businessName: video.profiles.business_name,
              businessType: video.profiles.business_type,
            } : {
              id: video.user_id,
              username: 'unknown',
              name: 'Unknown User',
              avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80',
              isBusinessAccount: false,
              followers: 0,
              following: 0,
            },
            url: videoUrl,
            thumbnail: video.thumbnail_url || 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80',
            eventName: video.title,
            description: video.description || '',
            location: {
              name: video.location_name || '',
              address: video.location_address || '',
              city: video.location_city || '',
              state: video.location_state || '',
              country: video.location_country || '',
              latitude: video.location_latitude,
              longitude: video.location_longitude,
            },
            eventDate: video.event_date || video.upload_date,

            hashtags: video.hashtags || [],
            likes: video.likes_count,
            comments: video.comments_count,

            shares: video.shares_count,
            rating: video.rating,
            ratingCount: video.rating_count,
            attendeeCount: 0,
            createdAt: video.created_at,
          };
          
          transformedAndFilteredVideos.push(transformedVideo);
        }
      }
      
      const { deletedVideoIds } = get();
      const visibleVideos = transformedAndFilteredVideos.filter((video) => !deletedVideoIds.has(video.id));

      // If no nearby videos from Supabase, fall back to filtering mock data
      if (visibleVideos.length === 0) {
        const nearbyMockVideos = mockVideos.filter(video => {
          const distance = calculateDistance(
            latitude,
            longitude,
            video.location.latitude,
            video.location.longitude
          );
          
          return distance <= radiusKm;
        });
        
        const fallbackVideos = nearbyMockVideos.filter((video) => !deletedVideoIds.has(video.id));
        await persistVideoFeedCache(fallbackVideos);
        set({
          videos: fallbackVideos,
          isLoading: false,
          _feedOffset: 0,
          hasMoreVideos: false,
        });
      } else {
        await persistVideoFeedCache(visibleVideos);
        set({ videos: visibleVideos, isLoading: false, _feedOffset: visibleVideos.length, hasMoreVideos: false });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      console.error('Error filtering videos by location:', errorMessage);
      console.error('Full error object:', error);
      set({ error: `Failed to filter videos by location: ${errorMessage}`, isLoading: false });
      
      // Fallback to all videos if location filtering fails
      await get().fetchVideos();
    }
  },
  
  addTaggedUser: (videoId: string, user: User, timestamp?: number, position?: { x: number, y: number }) => {
    set(state => {
      const updatedVideos = state.videos.map(video => {
        if (video.id === videoId) {
          // Create a new tagged user
          const newTaggedUser: TaggedUser = {
            userId: user.id,
            user,
            timestamp,
            position
          };
          
          // Add to existing tagged users or create a new array
          const updatedTaggedUsers = video.taggedUsers 
            ? [...video.taggedUsers, newTaggedUser]
            : [newTaggedUser];
          
          return {
            ...video,
            taggedUsers: updatedTaggedUsers
          };
        }
        return video;
      });
      
      return { videos: updatedVideos };
    });
  },
  
  removeTaggedUser: (videoId: string, userId: string) => {
    set(state => {
      const updatedVideos = state.videos.map(video => {
        if (video.id === videoId && video.taggedUsers) {
          return {
            ...video,
            taggedUsers: video.taggedUsers.filter(tag => tag.userId !== userId)
          };
        }
        return video;
      });
      
      return { videos: updatedVideos };
    });
  },
  
  uploadVideo: (video: Video) => {
    set(state => ({
      videos: [video, ...state.videos]
    }));
  },
  
  // Attendance functions
  attendEvent: (videoId: string, status: AttendanceStatus, notes?: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    set(state => {
      const updatedVideos = state.videos.map(video => {
        if (video.id === videoId) {
          // Check if user is already attending
          const existingAttendeeIndex = video.attendees?.findIndex(a => a.userId === user.id) ?? -1;
          
          let updatedAttendees: Attendee[] = [];
          
          if (existingAttendeeIndex >= 0 && video.attendees) {
            // Update existing attendance
            updatedAttendees = [...video.attendees];
            updatedAttendees[existingAttendeeIndex] = {
              ...updatedAttendees[existingAttendeeIndex],
              status,
              notes,
              timestamp: new Date().toISOString()
            };
          } else {
            // Add new attendance
            const newAttendee: Attendee = {
              userId: user.id,
              user,
              status,
              notes,
              timestamp: new Date().toISOString()
            };
            
            updatedAttendees = video.attendees ? [...video.attendees, newAttendee] : [newAttendee];
          }
          
          // Count attendees with 'going' status
          const goingCount = updatedAttendees.filter(a => a.status === AttendanceStatus.GOING).length;
          
          return {
            ...video,
            attendees: updatedAttendees,
            attendeeCount: goingCount
          };
        }
        return video;
      });
      
      return { videos: updatedVideos };
    });
  },
  
  cancelAttendance: (videoId: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    set(state => {
      const updatedVideos = state.videos.map(video => {
        if (video.id === videoId && video.attendees) {
          const updatedAttendees = video.attendees.filter(a => a.userId !== user.id);
          
          // Count attendees with 'going' status
          const goingCount = updatedAttendees.filter(a => a.status === AttendanceStatus.GOING).length;
          
          return {
            ...video,
            attendees: updatedAttendees,
            attendeeCount: goingCount
          };
        }
        return video;
      });
      
      return { videos: updatedVideos };
    });
  },
  
  isAttending: (videoId: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return null;
    
    const { videos } = get();
    const video = videos.find(v => v.id === videoId);
    
    if (!video || !video.attendees) return null;
    
    const attendee = video.attendees.find(a => a.userId === user.id);
    return attendee ? attendee.status : null;
  },
  
  getEventAttendees: (videoId: string) => {
    const { videos } = get();
    const video = videos.find(v => v.id === videoId);
    
    if (!video || !video.attendees) return [];
    
    return video.attendees;
  },

  removeVideo: async (videoId: string) => {
    const previousState = get();

    set((state) => {
      const nextVideos = state.videos.filter((video) => video.id !== videoId);
      const nextLikedVideos = new Set(state.userLikedVideos);
      nextLikedVideos.delete(videoId);
      const nextDeletedVideoIds = new Set(state.deletedVideoIds);
      nextDeletedVideoIds.add(videoId);

      return {
        videos: nextVideos,
        comments: state.comments.filter((comment) => comment.videoId !== videoId),
        userLikedVideos: nextLikedVideos,
        deletedVideoIds: nextDeletedVideoIds,
        currentVideoIndex: Math.min(state.currentVideoIndex, Math.max(0, nextVideos.length - 1)),
      };
    });

    await persistVideoFeedCache(get().videos);

    try {
      await videoService.deleteVideo(videoId);
    } catch (e) {
      set({
        videos: previousState.videos,
        comments: previousState.comments,
        userLikedVideos: new Set(previousState.userLikedVideos),
        deletedVideoIds: new Set(previousState.deletedVideoIds),
        currentVideoIndex: previousState.currentVideoIndex,
      });

      await persistVideoFeedCache(previousState.videos);
      console.error('Failed to remove video:', e);
      throw e;
    }
  },
}));