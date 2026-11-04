// react-native-share eagerly loads RNShare, which cannot exist in a browser.
// Keep the same small interface used by ShareModal without importing that module.
type ShareOptions = { title?: string; message?: string; url?: string; social?: string; type?: string; failOnCancel?: boolean };
async function open(options: ShareOptions) {
  if (typeof navigator === 'undefined') throw new Error('Sharing is available in the browser.');
  const data = { title: options.title, text: options.message, url: options.url };
  if (navigator.share) await navigator.share(data);
  else if (navigator.clipboard) await navigator.clipboard.writeText([options.message, options.url].filter(Boolean).join('\n'));
  else throw new Error('Copy the event link from your browser address bar to share it.');
  return { success: true };
}
export default {
  Social: { WHATSAPP: 'whatsapp', INSTAGRAM: 'instagram', FACEBOOK: 'facebook', TWITTER: 'twitter' },
  open,
  shareSingle: open,
};
