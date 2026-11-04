import React, { useState } from 'react';
import { Image, type ImageProps } from 'expo-image';

/** Keep a visible local avatar when a remote photo is missing or cannot load. */
export default function AvatarImage({ uri, ...props }: Omit<ImageProps, 'source'> & { uri?: string | null }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const photo = uri?.trim();
  return <Image {...props}
    source={photo && photo !== failedUri ? { uri: photo } : require('@/assets/images/avatar-placeholder.png')}
    onError={(error) => { setFailedUri(photo || null); props.onError?.(error); }}
  />;
}
