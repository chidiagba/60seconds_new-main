export type AvatarGender = 'male' | 'female' | null | undefined;

// Old releases stored these stock portraits as if they were profile photos.
const STOCK_AVATAR_IDS = ['photo-1472099645785-5658abf4ff4e', 'photo-1535713875002-d1d0cf377fde', 'photo-1522075469751-3a6694fb2f61'];
export const DEFAULT_AVATAR_URL = '';
export const MALE_AVATAR_URL = '';
export const FEMALE_AVATAR_URL = '';
export const getGenderAvatarUrl = (_gender: AvatarGender): null => null;

export const resolveAvatarUrl = (params: {
  avatarUrl?: string | null;
  avatarGender?: AvatarGender;
  fallbackUrl?: string;
}): string => {
  const photo = (params.avatarUrl || '').trim();
  if (!/^(https?:\/\/|file:\/\/|content:\/\/|data:image\/)/i.test(photo)) return '';
  if (STOCK_AVATAR_IDS.some(id => photo.includes(id)) || /images\.unsplash\.com|via\.placeholder\.com|pravatar\.cc|twemoji@/i.test(photo)) return '';
  return photo;
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
