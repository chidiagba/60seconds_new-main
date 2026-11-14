import { logger } from '@/lib/logger';
import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { hiddenVideosService } from "@/lib/database";

const HIDDEN_VIDEOS_KEY = "content_moderation_hidden_videos_v1";
const BLOCKED_USERS_KEY = "content_moderation_blocked_users_v1";

interface ContentModerationState {
  hiddenVideoIds: Set<string>;
  blockedUserIds: Set<string>;
  loadHiddenVideos: () => Promise<void>;
  loadBlockedUsers: () => Promise<void>;
  hideVideo: (videoId: string) => Promise<void>;
  unhideVideo: (videoId: string) => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  isVideoHidden: (videoId: string) => boolean;
  isUserBlocked: (userId: string) => boolean;
}

export const useContentModerationStore = create<ContentModerationState>(
  (set, get) => ({
    hiddenVideoIds: new Set<string>(),
    blockedUserIds: new Set<string>(),

    /**
     * Load hidden videos from both AsyncStorage (offline fallback) and database (source of truth).
     * Database takes priority - if it has data, use that. Otherwise fall back to AsyncStorage.
     */
    loadHiddenVideos: async () => {
      try {
        // Try to load from database first (source of truth)
        const dbHiddenVideos = await hiddenVideosService.getHiddenVideosForUser();
        if (dbHiddenVideos && dbHiddenVideos.length > 0) {
          set({ hiddenVideoIds: new Set(dbHiddenVideos) });
          // Sync to AsyncStorage for offline access
          try {
            await AsyncStorage.setItem(
              HIDDEN_VIDEOS_KEY,
              JSON.stringify(dbHiddenVideos)
            );
          } catch (e) {
            logger.warn("Failed to sync hidden videos to AsyncStorage:", e);
          }
          return;
        }

        // If no database data, try AsyncStorage (offline fallback)
        const stored = await AsyncStorage.getItem(HIDDEN_VIDEOS_KEY);
        const ids = stored ? (JSON.parse(stored) as string[]) : [];
        set({ hiddenVideoIds: new Set(ids) });
      } catch (e) {
        logger.error("Failed to load hidden videos:", e);
        // Still try AsyncStorage as fallback
        try {
          const stored = await AsyncStorage.getItem(HIDDEN_VIDEOS_KEY);
          const ids = stored ? (JSON.parse(stored) as string[]) : [];
          set({ hiddenVideoIds: new Set(ids) });
        } catch (e2) {
          logger.error("Failed to load hidden videos from AsyncStorage:", e2);
          set({ hiddenVideoIds: new Set() });
        }
      }
    },

    loadBlockedUsers: async () => {
      try {
        const stored = await AsyncStorage.getItem(BLOCKED_USERS_KEY);
        const ids = stored ? (JSON.parse(stored) as string[]) : [];
        set({ blockedUserIds: new Set(ids) });
      } catch {
        set({ blockedUserIds: new Set() });
      }
    },

    /**
     * Hide a video for the current user.
     * This will:
     * 1. Save to database (persistent across devices)
     * 2. Update AsyncStorage (offline access)
     * 3. Update local state
     */
    hideVideo: async (videoId: string) => {
      const { hiddenVideoIds } = get();
      const next = new Set(hiddenVideoIds);
      next.add(videoId);
      set({ hiddenVideoIds: next });

      // Save to both storage systems
      try {
        // Save to database (source of truth, persistent across devices)
        await hiddenVideosService.hideVideoForUser(videoId);
      } catch (e) {
        logger.error("Failed to save hidden video to database:", e);
        // Continue anyway - AsyncStorage will act as fallback
      }

      try {
        // Also save to AsyncStorage for offline access
        await AsyncStorage.setItem(
          HIDDEN_VIDEOS_KEY,
          JSON.stringify([...next])
        );
      } catch (e) {
        logger.error("Failed to persist hidden video to AsyncStorage:", e);
      }
    },

    /**
     * Unhide a video for the current user.
     * This will:
     * 1. Remove from database
     * 2. Remove from AsyncStorage
     * 3. Update local state
     */
    unhideVideo: async (videoId: string) => {
      const { hiddenVideoIds } = get();
      const next = new Set(hiddenVideoIds);
      next.delete(videoId);
      set({ hiddenVideoIds: next });

      // Remove from both storage systems
      try {
        // Remove from database
        await hiddenVideosService.unhideVideoForUser(videoId);
      } catch (e) {
        logger.error("Failed to remove hidden video from database:", e);
      }

      try {
        // Also remove from AsyncStorage
        await AsyncStorage.setItem(
          HIDDEN_VIDEOS_KEY,
          JSON.stringify([...next])
        );
      } catch (e) {
        logger.error("Failed to update AsyncStorage:", e);
      }
    },

    blockUser: async (userId: string) => {
      const { blockedUserIds } = get();
      const next = new Set(blockedUserIds);
      next.add(userId);
      set({ blockedUserIds: next });
      try {
        await AsyncStorage.setItem(
          BLOCKED_USERS_KEY,
          JSON.stringify([...next])
        );
      } catch (e) {
        logger.error("Failed to persist blocked user:", e);
      }
      // developer notification: send a record to backend (fire-and-forget)
      try {
        // if you have a table for moderation you can insert here
        // example: await supabase.from('user_blocks').insert({ user_id: userId });
      } catch (e) {
        logger.warn('Failed to notify server about blocked user', e);
      }
    },

    isVideoHidden: (videoId: string) => {
      return get().hiddenVideoIds.has(videoId);
    },

    isUserBlocked: (userId: string) => {
      return get().blockedUserIds.has(userId);
    },
  })
);
