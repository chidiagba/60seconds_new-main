import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export type WebpageShare = { title: string; url: string; username?: string | null; location?: string | null; date?: string | null; description?: string | null };
export function webpageShareMessage(page: WebpageShare) {
  const username = page.username?.replace(/^@+/, '');
  const description = page.description?.trim() || '';
  return [
    `🎉 ${page.title}`, username ? `👤 Uploaded by @${username}` : null,
    page.location ? `📍 ${page.location}` : null, page.date ? `🗓️ ${page.date}` : null,
    description.length > 140 ? `${description.slice(0, 137)}...` : description || null,
    `🔗 ${page.url}`,
  ].filter(Boolean).join('\n');
}
/** The same public event-page payload for home and Discover, on both native platforms. */
export async function shareWebpage(page: WebpageShare): Promise<boolean> {
  const message = webpageShareMessage(page);
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: page.title, text: message, url: page.url });
      } else await Clipboard.setStringAsync(page.url);
      return true;
    }
    const result = await Share.share({ title: page.title, message, url: page.url });
    return result.action !== Share.dismissedAction;
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return false;
    throw error;
  }
}
