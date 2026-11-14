import { logger } from '@/lib/logger';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth-store';

/**
 * Hook to listen for avatar changes and trigger a callback
 * Useful for screens that need to refetch user profiles when avatars change
 *
 * @param callback - Function to call when avatar changes
 * @param enabled - Whether to enable the listener (default: true)
 */
export function useAvatarSync(
  callback: () => void | Promise<void>,
  enabled: boolean = true
) {
  const avatarVersion = useAuthStore((state) => state.avatarVersion);
  const previousAvatarVersionRef = useRef(avatarVersion);

  useEffect(() => {
    if (!enabled) return;

    // Check if avatar version has changed
    if (avatarVersion !== previousAvatarVersionRef.current) {
      logger.debug('🎭 Avatar changed detected, triggering callback');
      Promise.resolve().then(callback).catch((error) => {
        logger.error('Error in useAvatarSync callback:', error);
      });
    }

    previousAvatarVersionRef.current = avatarVersion;
  }, [avatarVersion, enabled, callback]);
}

/**
 * Get current avatar version to use as a dependency
 * Useful for inline refetch triggers without a separate hook
 */
export function useAvatarVersion(): number {
  return useAuthStore((state) => state.avatarVersion);
}
