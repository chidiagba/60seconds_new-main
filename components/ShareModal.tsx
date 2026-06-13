import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
} from 'react-native';
import ShareOpen from 'react-native-share';
import { Copy, Facebook, Instagram, Link, MessageCircle, Share2, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import Colors from '@/constants/colors';
import { Video } from '@/types';
import { useVideoStore } from '@/store/video-store';
import { videoWatermarkService } from '@/utils/video-watermark';
import {
  APP_WEBSITE_URL,
  buildVideoShareUrl,
} from '@/constants/app-links';

interface ShareModalProps {
  visible: boolean;
  onClose: () => void;
  video: Video;
}

let activeShareSession = false;
const originalShareCacheJobs = new Map<string, Promise<string | null>>();
const VIDEO_MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
};

type ShareVideoFileResult = {
  success: boolean;
  cancelled: boolean;
};

export default function ShareModal({ visible, onClose, video }: ShareModalProps) {
  const { shareVideo } = useVideoStore();
  const [isPreparingVideo, setIsPreparingVideo] = useState(false);
  const [watermarkProgress, setWatermarkProgress] = useState(0);
  const isMountedRef = useRef(true);
  const isCancelRequestedRef = useRef(false);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBusyNoticeAtRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updatePreparingState = (value: boolean) => {
    if (isMountedRef.current) {
      setIsPreparingVideo(value);
    }
  };

  const clearProgressInterval = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const handleModalClose = () => {
    // Always allow close — cancel any in-progress watermark operation
    isCancelRequestedRef.current = true;
    clearProgressInterval();
    activeShareSession = false;
    if (isMountedRef.current) {
      setIsPreparingVideo(false);
      setWatermarkProgress(0);
    }
    onClose();
  };

  const videoUrl = useMemo(() => (video.url || '').trim(), [video.url]);
  const videoShareLink = useMemo(() => buildVideoShareUrl(video.id), [video.id]);
  const uploaderUsername = useMemo(() => {
    const rawUsername = String(video.user?.username || '').trim();
    if (!rawUsername) return null;
    return `@${rawUsername.replace(/^@+/, '')}`;
  }, [video.user?.username]);

  const shortDescription = useMemo(() => {
    const value = (video.description || '').trim();
    if (!value) return '';
    return value.length > 140 ? `${value.slice(0, 137)}...` : value;
  }, [video.description]);

  const locationText = useMemo(() => {
    const { name, address, city, state, country } = video.location;
    const parts = [name, address, city, state, country].filter(Boolean);
    // Deduplicate: drop a part if it duplicates the previous one
    const unique = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
    return unique.join(', ');
  }, [video.location]);

  const eventDateText = useMemo(() => {
    if (!video.eventDate) return null;
    try {
      return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(video.eventDate));
    } catch {
      return new Date(video.eventDate).toLocaleString();
    }
  }, [video.eventDate]);

  // Fully dynamic share message — built from actual video/event data at runtime
  const shareMessage = useMemo(() => {
    const lines: (string | null)[] = [
      `🎉 ${video.eventName}`,
      uploaderUsername ? `👤 Uploaded by ${uploaderUsername}` : null,
      locationText ? `📍 ${locationText}` : null,
      eventDateText ? `🗓️ ${eventDateText}` : null,
      shortDescription || null,
      `🎬 Video: ${videoShareLink}`,
      `🌐 Website: ${APP_WEBSITE_URL}`,
    ];
    return lines.filter(Boolean).join('\n');
  }, [video.eventName, uploaderUsername, locationText, eventDateText, shortDescription, videoShareLink]);

  const handleHapticFeedback = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const notifySharePreparing = () => {
    const now = Date.now();
    if (now - lastBusyNoticeAtRef.current < 1200) {
      return;
    }

    lastBusyNoticeAtRef.current = now;
    handleHapticFeedback();
    Alert.alert('Preparing Share', 'Please wait while watermarking completes, or tap Cancel to close this sheet.');
  };

  const notifyWatermarkRequired = () => {
    Alert.alert(
      'Watermark Required',
      'Could not prepare a watermarked video right now. Please try again in a moment.'
    );
  };

  const isLikelyShareCancelled = (value: any): boolean => {
    if (!value) return false;

    const message = (
      value?.message ||
      value?.error ||
      value?.toString?.() ||
      ''
    ).toLowerCase();

    if (message.includes('cancel') || message.includes('dismiss')) {
      return true;
    }

    if (typeof value === 'object' && value !== null && value.success === false) {
      return true;
    }

    return value?.dismissedAction === true;
  };

  const isLikelyWatermarkedUrl = (url: string) => {
    const normalized = url.toLowerCase();
    return normalized.includes('_wm_') || normalized.includes('/wm_') || normalized.includes('watermarked');
  };

  const getRemoteExtension = () => {
    const cleanRemote = videoUrl.split('?')[0].toLowerCase();
    return cleanRemote.split('.').pop() || 'mp4';
  };

  const getOriginalCacheUri = () => `${FileSystem.cacheDirectory}share_video_${video.id}.${getRemoteExtension()}`;
  const getWatermarkCacheKey = () => `share_${video.id}`;

  const getCachedFileIfPresent = async (uri: string) => {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      return info.exists ? uri : null;
    } catch {
      return null;
    }
  };

  const ensureOriginalVideoCached = async (): Promise<{ uri: string | null; mimeType: string }> => {
    if (!videoUrl || Platform.OS === 'web') {
      return { uri: null, mimeType: 'video/mp4' };
    }

    if (videoUrl.startsWith('file://')) {
      const localClean = videoUrl.split('?')[0].toLowerCase();
      const localExt = localClean.split('.').pop() || 'mp4';
      return { uri: videoUrl, mimeType: VIDEO_MIME_MAP[localExt] || 'video/mp4' };
    }

    const remoteExt = getRemoteExtension();
    const mimeType = VIDEO_MIME_MAP[remoteExt] || 'video/mp4';
    const cacheUri = getOriginalCacheUri();
    const existing = await getCachedFileIfPresent(cacheUri);
    if (existing) {
      return { uri: existing, mimeType };
    }

    const existingJob = originalShareCacheJobs.get(cacheUri);
    if (existingJob) {
      return { uri: await existingJob, mimeType };
    }

    const downloadJob = (async () => {
      console.log('[Share] Downloading original video into stable share cache...');
      const { uri, status } = await FileSystem.downloadAsync(videoUrl, cacheUri);
      if (status !== 200) {
        throw new Error(`Download failed with status ${status}`);
      }
      return uri;
    })();

    originalShareCacheJobs.set(cacheUri, downloadJob);

    try {
      return { uri: await downloadJob, mimeType };
    } finally {
      originalShareCacheJobs.delete(cacheUri);
    }
  };

  const warmShareAssetsInBackground = async () => {
    if (!videoUrl || Platform.OS === 'web') {
      return;
    }

    try {
      const prepared = await ensureOriginalVideoCached();
      if (!prepared.uri || isLikelyWatermarkedUrl(videoUrl)) {
        return;
      }

      await videoWatermarkService.startBackgroundWatermark(prepared.uri, getWatermarkCacheKey(), {
        position: 'bottom-right',
        opacity: 0.8,
        scale: 0.18,
      });
    } catch (error) {
      console.warn('[Share] Background share asset warm-up failed:', error);
    }
  };

  useEffect(() => {
    if (!visible || Platform.OS === 'web') {
      return;
    }

    void warmShareAssetsInBackground();
  }, [visible, video.id, videoUrl]);

  /**
   * Prepare a local video that is guaranteed to be watermarked.
   */
  const prepareVideoForShare = async (): Promise<{ uri: string | null; mimeType: string; isWatermarked: boolean }> => {
    if (!videoUrl || Platform.OS === 'web') {
      return { uri: null, mimeType: 'video/mp4', isWatermarked: false };
    }

    try {
      const cachedWatermarkedUri = await videoWatermarkService.getCachedWatermarkedVideo(getWatermarkCacheKey());
      if (cachedWatermarkedUri) {
        console.log('[Share] Using cached watermarked video for instant share:', cachedWatermarkedUri);
        return { uri: cachedWatermarkedUri, mimeType: 'video/mp4', isWatermarked: true };
      }

      const preparedOriginal = await ensureOriginalVideoCached();
      if (!preparedOriginal.uri) {
        return { uri: null, mimeType: preparedOriginal.mimeType, isWatermarked: false };
      }

      if (isLikelyWatermarkedUrl(videoUrl)) {
        return { uri: preparedOriginal.uri, mimeType: preparedOriginal.mimeType, isWatermarked: true };
      }

      const watermarkedUri = await videoWatermarkService.addWatermarkToVideo(preparedOriginal.uri, {
        position: 'bottom-right',
        opacity: 0.8,
        scale: 0.18,
        sourceUrl: videoUrl,
        strict: true,
        allowFallback: false,
      });

      if (!watermarkedUri || watermarkedUri === preparedOriginal.uri) {
        return { uri: null, mimeType: preparedOriginal.mimeType, isWatermarked: false };
      }

      const cachedUri = await videoWatermarkService.cacheWatermarkedVideo(getWatermarkCacheKey(), watermarkedUri);
      return { uri: cachedUri, mimeType: 'video/mp4', isWatermarked: true };
    } catch (error) {
      console.error('[Share] Failed to prepare watermarked video for share:', error);
      return { uri: null, mimeType: 'video/mp4', isWatermarked: false };
    }
  };

  const shareVideoFile = async (_dialogTitle: string): Promise<ShareVideoFileResult> => {
    if (Platform.OS === 'web') {
      return { success: false, cancelled: false };
    }

    if (activeShareSession || isPreparingVideo) {
      Alert.alert('Share In Progress', 'Please finish the current share before starting another one.');
      return { success: false, cancelled: false };
    }

    isCancelRequestedRef.current = false;
    activeShareSession = true;
    updatePreparingState(true);
    if (isMountedRef.current) setWatermarkProgress(0);

    // Simulate progress 0 → 89% while watermark processes server-side
    let simProgress = 0;
    clearProgressInterval();
    progressIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current || isCancelRequestedRef.current) {
        clearProgressInterval();
        return;
      }
      const increment = simProgress < 30 ? 2.5 : simProgress < 60 ? 1.2 : simProgress < 85 ? 0.4 : 0;
      simProgress = Math.min(simProgress + increment, 89);
      setWatermarkProgress(Math.round(simProgress));
    }, 300);

    try {
      const { uri: localUri, mimeType, isWatermarked } = await prepareVideoForShare();

      // User cancelled during preparation — bail silently
      if (isCancelRequestedRef.current) {
        return { success: false, cancelled: true };
      }

      clearProgressInterval();
      if (isMountedRef.current) setWatermarkProgress(95);

      if (!localUri) {
        Alert.alert('Video Not Available', 'Could not prepare the video file to share. Please try again in a moment.');
        return { success: false, cancelled: false };
      }

      if (isMountedRef.current) setWatermarkProgress(100);
      // Brief pause so user sees 100% before share sheet opens
      await new Promise<void>((r) => setTimeout(r, 250));

      if (isCancelRequestedRef.current) {
        return { success: false, cancelled: true };
      }

      const shareResponse = await ShareOpen.open({
        title: video.eventName,
        subject: uploaderUsername
          ? `Check out: ${video.eventName} by ${uploaderUsername}`
          : `Check out: ${video.eventName}`,
        message: shareMessage,
        url: localUri,
        type: mimeType,
        failOnCancel: false,
      });

      if (isLikelyShareCancelled(shareResponse)) {
        console.log('[Share] Share sheet dismissed by user');
        return { success: false, cancelled: true };
      }

      console.log('[Share] ✓ Share dialog opened with video attached');
      return { success: true, cancelled: false };
    } catch (error: any) {
      console.error('[Share] Failed to share video:', error);

      if (isLikelyShareCancelled(error)) {
        return { success: false, cancelled: true };
      }

      const errorMsg = error?.message || error?.toString() || 'Unknown error';
      if (errorMsg.includes('permission') || errorMsg.includes('Permission')) {
        Alert.alert('Permission Denied', 'The app needs permission to access your files. Please check your device settings.');
      } else if (errorMsg.includes('network') || errorMsg.includes('Network')) {
        Alert.alert('Network Error', 'Could not download the video. Please check your connection and try again.');
      } else if (errorMsg.includes('Watermark failed') || errorMsg.includes('watermark')) {
        Alert.alert('Watermark Error', 'Video watermark could not be applied right now. Please try again.');
      } else {
        Alert.alert('Share Failed', 'Could not share the video. Please try again.');
      }

      return { success: false, cancelled: false };
    } finally {
      clearProgressInterval();
      activeShareSession = false;
      updatePreparingState(false);
      if (isMountedRef.current) setWatermarkProgress(0);
    }
  };

  const shareViaSystem = async (
    source: 'instagram' | 'facebook' | 'twitter' | 'whatsapp' | 'tiktok' | 'webpage' | 'other' = 'other',
    options?: { preferVideoFile?: boolean }
  ) => {
    try {
      const shouldShareVideoFile = options?.preferVideoFile ?? true;
      const shareResult = shouldShareVideoFile ? await shareVideoFile('Share video') : { success: false, cancelled: false };

      if (shareResult.cancelled) {
        onClose();
        return;
      }
      
      if (shareResult.success) {
        shareVideo(video.id, source);
        onClose();
        return;
      }

      if (shouldShareVideoFile) {
        notifyWatermarkRequired();
        return;
      }

      // shouldShareVideoFile was false — share text only
      const payload = {
        message: shareMessage,
        title: video.eventName,
      };

      await Share.share(payload);
      shareVideo(video.id, source);
      onClose();
    } catch (error) {
      console.error('[Share] Error sharing via system sheet', error);
      Alert.alert('Share Error', 'Could not share. Please try again.');
    }
  };

  const handleCopyLink = async () => {
    if (isPreparingVideo || activeShareSession) {
      notifySharePreparing();
      return;
    }
    handleHapticFeedback();
    await Clipboard.setStringAsync(videoShareLink);
    shareVideo(video.id, 'copy');
    onClose();

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Link copied', 'Video link copied successfully.');
    }
  };

  /**
   * Share to Instagram as a Post or Reel.
   *
   * Flow:
   *   1. Generate/download a local watermarked video.
   *   2. Share in a single native payload containing video + event text + links.
   *   3. If media share fails and it's due to watermark issues, offer email/link fallback.
   */
  const handleShareToInstagram = async () => {
    handleHapticFeedback();
    if (isPreparingVideo || activeShareSession) {
      notifySharePreparing();
      return;
    }

    try {
      if (Platform.OS === 'web') {
        await Linking.openURL('https://www.instagram.com/').catch(() => {});
        shareVideo(video.id, 'instagram');
        onClose();
        return;
      }

      // Share the video FILE (routes to Feed/Reels, not DMs)
      const shareResult = await shareVideoFile('Share to Instagram Post or Reel');
      if (shareResult.cancelled) {
        onClose();
        return;
      }

      if (shareResult.success) {
        shareVideo(video.id, 'instagram');
        onClose();
        return;
      }

      notifyWatermarkRequired();
      return;
    } catch (err: any) {
      console.error('[Share] Instagram share error', err);
      Alert.alert('Share Failed', 'Could not share to Instagram. Please try again.');
    }
  };

  const handleShareToFacebook = async () => {
    if (isPreparingVideo || activeShareSession) {
      notifySharePreparing();
      return;
    }
    handleHapticFeedback();

    const shareResult = await shareVideoFile('Share video to Facebook');
    if (shareResult.cancelled) {
      onClose();
      return;
    }

    if (shareResult.success) {
      shareVideo(video.id, 'facebook');
      onClose();
      return;
    }

    notifyWatermarkRequired();
  };

  const handleShareToTwitter = async () => {
    if (isPreparingVideo || activeShareSession) {
      notifySharePreparing();
      return;
    }
    handleHapticFeedback();

    // Primary: share video file + clean message text
    const shareResult = await shareVideoFile('Share video to X');
    if (shareResult.cancelled) {
      onClose();
      return;
    }

    if (shareResult.success) {
      shareVideo(video.id, 'twitter');
      onClose();
      return;
    }

    notifyWatermarkRequired();
  };

  const handleShareToWhatsApp = async () => {
    if (isPreparingVideo || activeShareSession) {
      notifySharePreparing();
      return;
    }
    handleHapticFeedback();

    try {
      // Primary: share video file + message
      const shareResult = await shareVideoFile('Share video to WhatsApp');
      if (shareResult.cancelled) {
        onClose();
        return;
      }

      if (shareResult.success) {
        shareVideo(video.id, 'whatsapp');
        onClose();
        return;
      }

      notifyWatermarkRequired();
    } catch (error) {
      console.error('[Share] WhatsApp share failed:', error);
      Alert.alert('Share Error', 'Unable to open WhatsApp. Please make sure WhatsApp is installed.');
    }
  };

  const handleShareToTikTok = async () => {
    if (isPreparingVideo || activeShareSession) {
      notifySharePreparing();
      return;
    }
    handleHapticFeedback();
    await shareViaSystem('tiktok');
  };

  const handleShareAsWebpage = async () => {
    if (isPreparingVideo || activeShareSession) {
      notifySharePreparing();
      return;
    }
    handleHapticFeedback();

    const webpageMessage = [
      `🎉 ${video.eventName}`,
      uploaderUsername ? `👤 Uploaded by ${uploaderUsername}` : null,
      locationText ? `📍 ${locationText}` : null,
      eventDateText ? `🗓️ ${eventDateText}` : null,
      shortDescription || null,
      `🔗 ${videoShareLink}`,
    ].filter(Boolean).join('\n');

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: video.eventName,
          text: webpageMessage,
          url: videoShareLink,
        });
        shareVideo(video.id, 'webpage');
        onClose();
        return;
      } catch (error) {
        console.error('Web Share API failed, copying link', error);
      }
    }

    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(videoShareLink);
      shareVideo(video.id, 'webpage');
      onClose();
      return;
    }

    // Native: open system share sheet with event page link + message
    try {
      await Share.share({
        message: webpageMessage,
        title: video.eventName,
        url: videoShareLink,
      });
      shareVideo(video.id, 'webpage');
      onClose();
    } catch (error) {
      console.error('[Share] Share page failed:', error);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={handleModalClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Share to</Text>
            <TouchableOpacity onPress={handleModalClose} style={styles.closeButton}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.optionsContainer}>
            {isPreparingVideo && (
              <View style={styles.progressContainer}>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${watermarkProgress}%` as any }]} />
                </View>
                <Text style={styles.loadingText}>
                  {watermarkProgress < 100
                    ? `Embedding watermark… ${watermarkProgress}%`
                    : 'Ready! Opening share sheet…'}
                </Text>
              </View>
            )}

            <View style={styles.shareRow}>
              <ShareOption
                icon={<Instagram size={28} color="#E1306C" />}
                label="Instagram"
                onPress={handleShareToInstagram}
              />

              <ShareOption icon={<Facebook size={28} color="#1877F2" />} label="Facebook" onPress={handleShareToFacebook} />

              <ShareOption icon={<X size={28} color="#000000" />} label="X" onPress={handleShareToTwitter} />
            </View>

            <View style={styles.shareRow}>
              <ShareOption icon={<MessageCircle size={28} color="#25D366" />} label="WhatsApp" onPress={handleShareToWhatsApp} />

              <ShareOption icon={<Share2 size={28} color="#EE1D52" />} label="TikTok" onPress={handleShareToTikTok} />

              <ShareOption icon={<Copy size={28} color={Colors.dark.primary} />} label="Copy Link" onPress={handleCopyLink} />
            </View>

            <View style={styles.shareRow}>
              <ShareOption icon={<Link size={28} color={Colors.dark.secondary} />} label="Share Page" onPress={handleShareAsWebpage} />
            </View>

            <View style={styles.shareInfoContainer}>
              <Text style={styles.shareInfoText}>
                Share this event as a webpage where others can watch the video, view products, and make purchases.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelButton} onPress={handleModalClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface ShareOptionProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function ShareOption({ icon, label, onPress, disabled = false }: ShareOptionProps) {
  return (
    <TouchableOpacity style={[styles.shareOption, disabled && styles.disabledShareOption]} onPress={onPress} disabled={disabled}>
      <View style={styles.iconContainer}>{icon}</View>
      <Text style={styles.optionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: Colors.dark.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 30,
    minHeight: 300,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionsContainer: {
    maxHeight: 300,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
    gap: 8,
  },
  progressContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: Colors.dark.background,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.dark.primary,
    borderRadius: 3,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.dark.subtext,
    textAlign: 'center',
  },
  shareRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  shareOption: {
    alignItems: 'center',
    width: 80,
  },
  disabledShareOption: {
    opacity: 0.45,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  optionLabel: {
    fontSize: 12,
    color: Colors.dark.text,
    textAlign: 'center',
  },
  shareInfoContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  shareInfoText: {
    fontSize: 14,
    color: Colors.dark.subtext,
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: 20,
    marginTop: 10,
  },
  cancelButton: {
    backgroundColor: Colors.dark.background,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  cancelText: {
    color: Colors.dark.text,
    fontWeight: '600',
    fontSize: 16,
  },
});