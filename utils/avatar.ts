export type AvatarGender = 'male' | 'female' | null | undefined;

export const DEFAULT_AVATAR_URL =
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80';

export const MALE_AVATAR_URL =
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f468.png';

export const FEMALE_AVATAR_URL =
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f469.png';

export const getGenderAvatarUrl = (gender: AvatarGender): string | null => {
  if (gender === 'male') return MALE_AVATAR_URL;
  if (gender === 'female') return FEMALE_AVATAR_URL;
  return null;
};

export const resolveAvatarUrl = (params: {
  avatarUrl?: string | null;
  avatarGender?: AvatarGender;
  fallbackUrl?: string;
}): string => {
  const normalizedAvatarUrl = (params.avatarUrl || '').trim();
  if (normalizedAvatarUrl.length > 0) {
    return normalizedAvatarUrl;
  }

  const genderAvatarUrl = getGenderAvatarUrl(params.avatarGender);
  if (genderAvatarUrl) {
    return genderAvatarUrl;
  }

  return params.fallbackUrl || DEFAULT_AVATAR_URL;
};

/** Preserve omitted legacy fields, but never undo an intentional avatar removal. */
export function mergeProfileAvatarFields<T extends { id: string; avatar_url?: string | null; avatar_gender?: AvatarGender }>(next: T, previous: T | null): T {
  if (!previous || previous.id !== next.id) return next;
  return {
    ...next,
    avatar_url: next.avatar_url !== undefined ? next.avatar_url : previous.avatar_url,
    avatar_gender: next.avatar_gender !== undefined ? next.avatar_gender : previous.avatar_gender,
  };
}
