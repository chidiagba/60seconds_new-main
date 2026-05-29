export const APP_WEBSITE_URL = 'https://60secondsapp.io/';

export const APP_SHARE_BASE_URL = (process.env.EXPO_PUBLIC_SHARE_BASE_URL || 'https://60secondsapp.io').replace(/\/+$/, '');

export const buildVideoShareUrl = (videoId: string) => `${APP_SHARE_BASE_URL}/video/${videoId}`;

export const APP_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=app.sixtyseconds.nightlife';

export const APP_APP_STORE_URL =
  'https://apps.apple.com/ch/app/60seconds-catch-the-moments/id6756535386?l=en-GB';

export const APP_SHARE_LINKS_MESSAGE = [
  `Website: ${APP_SHARE_BASE_URL}`,
].join('\n');
