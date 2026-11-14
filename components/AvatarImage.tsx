import React, { useState } from 'react';
import { Image, type ImageProps } from 'expo-image';
import { useAuthStore } from '@/store/auth-store';
import { resolveAvatarUrl } from '@/utils/avatar';

/** Uploaded photos only. Missing or failed photos leave the avatar empty. */
export default function AvatarImage({ uri, userId, ...props }: Omit<ImageProps, 'source'> & { uri?: string | null; userId?: string }) {
  const ownPhoto = useAuthStore(state => userId && state.user?.id === userId ? state.user.avatar : undefined);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const photo = resolveAvatarUrl({ avatarUrl: ownPhoto !== undefined ? ownPhoto : uri });
  return <Image {...props}
    source={photo && photo !== failedUri ? { uri: photo } : null}
    onError={(error) => { setFailedUri(photo || null); props.onError?.(error); }}
  />;
}
