import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist, createJSONStorage } from 'zustand/middleware';
import { User } from '@/types';
import { followService } from '@/lib/database';
import { supabase } from '@/lib/supabase';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  followedUsers: string[]; // Array of user IDs that the current user follows
  followVersion: number;
  avatarVersion: number; // Increment when avatar changes to trigger re-renders
  login: (user: User) => void;
  logout: () => void;
  syncUser: (user: User | null) => void;
  updateUser: (userData: Partial<User>) => void;
  updateAvatarInfo: (avatarData: { avatar?: string; avatarGender?: 'male' | 'female' | null }) => void;
  followUser: (userId: string) => Promise<void>;
  unfollowUser: (userId: string) => Promise<void>;
  isFollowing: (userId: string) => boolean;
  refreshFollowedUsers: () => Promise<void>;
  register: (userData: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null, // Start with no user
      isAuthenticated: false, // Start not authenticated
      followedUsers: [], // Start with no followed users
      followVersion: 0,
      avatarVersion: 0, // Increment on avatar changes
      login: (user) => set({ user, isAuthenticated: true }),
      logout: () => set({ user: null, isAuthenticated: false, followedUsers: [], followVersion: 0, avatarVersion: 0 }),
      syncUser: (user) =>
        set((state) => {
          if (!user) {
            if (!state.user && !state.isAuthenticated && state.followedUsers.length === 0) {
              return state;
            }

            return { user: null, isAuthenticated: false, followedUsers: [] };
          }

          return {
            user,
            isAuthenticated: true,
          };
        }),
      register: (userData) => {
        // In a real app, you would make an API call to register the user
        // For now, we'll just set the user in the store
        set({ 
          user: userData, 
          isAuthenticated: true,
          followedUsers: []
        });
      },
      updateUser: (userData) => 
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
      updateAvatarInfo: (avatarData) =>
        set((state) => ({
          user: state.user ? {
            ...state.user,
            avatar: avatarData.avatar !== undefined ? avatarData.avatar : state.user.avatar,
          } : null,
          avatarVersion: state.avatarVersion + 1,
        })),
      refreshFollowedUsers: async () => {
        try {
          const { data } = await supabase.auth.getUser();
          const authUserId = data.user?.id;
          if (!authUserId) {
            set({ followedUsers: [] });
            return;
          }

          const [followingIds, counts] = await Promise.all([
            followService.getFollowingIds(authUserId),
            followService.getFollowCounts(authUserId),
          ]);

          set((state) => ({
            followedUsers: followingIds,
            user: state.user
              ? {
                  ...state.user,
                  followers: counts.followersCount,
                  following: counts.followingCount,
                }
              : null,
          }));
        } catch (error) {
          console.error('Error refreshing followed users:', error);
        }
      },

      followUser: async (userId) => {
        try {
          const { data } = await supabase.auth.getUser();
          const authUserId = data.user?.id;
          if (!authUserId || authUserId === userId) return;

          await followService.followUser(authUserId, userId);

          const [followingIds, counts] = await Promise.all([
            followService.getFollowingIds(authUserId),
            followService.getFollowCounts(authUserId),
          ]);

          set((state) => ({
            followedUsers: followingIds,
            followVersion: state.followVersion + 1,
            user: state.user
              ? {
                  ...state.user,
                  followers: counts.followersCount,
                  following: counts.followingCount,
                }
              : null,
          }));
        } catch (error) {
          console.error('Error following user:', error);
        }
      },

      unfollowUser: async (userId) => {
        try {
          const { data } = await supabase.auth.getUser();
          const authUserId = data.user?.id;
          if (!authUserId) return;

          await followService.unfollowUser(authUserId, userId);

          const [followingIds, counts] = await Promise.all([
            followService.getFollowingIds(authUserId),
            followService.getFollowCounts(authUserId),
          ]);

          set((state) => ({
            followedUsers: followingIds,
            followVersion: state.followVersion + 1,
            user: state.user
              ? {
                  ...state.user,
                  followers: counts.followersCount,
                  following: counts.followingCount,
                }
              : null,
          }));
        } catch (error) {
          console.error('Error unfollowing user:', error);
        }
      },
      isFollowing: (userId) => {
        return get().followedUsers.includes(userId);
      }
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);