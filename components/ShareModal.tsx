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
import * as MediaLibrary from 'expo-media-library';
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

type VideoDestination = 'instagram' | 'facebook' | 'twitter' | 'whatsapp' | 'tiktok' | 'generic';
type SharePreparationState =
  | 'idle' | 'resolving-source' | 'watermarking' | 'validating'
  | 'watermark-ready' | 'checking-destination' | 'sharing'
  | 'completed' | 'failed';

type PreparedVideoShare = {
  uri: string;
  mimeType: string;
  isWatermarked: true;
  destination: VideoDestination;
  size: number | null;
};

const DESTINATION_LABELS: Record<VideoDestination, string> = {
  instagram: 'Instagram', facebook: 'Facebook', twitter: 'X',
  whatsapp: 'WhatsApp', tiktok: 'TikTok', generic: 'Share Sheet',
};

type ShareVideoFileOptions = {
  target?: 'generic' | 'instagram' | 'facebook' | 'twitter' | 'whatsapp' | 'tiktok';
};

const resolveShareSocialTarget = (
  target?: ShareVideoFileOptions['target']
): any | null => {
  if (!target || target === 'generic') return null;

  const socialMap: Record<string, string> = {
    instagram: 'INSTAGRAM',
    facebook: 'FACEBOOK',
    twitter: 'TWITTER',
    whatsapp: 'WHATSAPP',
  };

  const socialKey = socialMap[target];
  if (!socialKey) return null;

  return (ShareOpen.Social as any)?.[socialKey] ?? null;
};

export default function ShareModal({ visible, onClose, video }: ShareModalProps) {
  const { shareVideo } = useVideoStore();
  const [isPreparingVideo, setIsPreparingVideo] = useState(false);
  const [watermarkProgress, setWatermarkProgress] = useState(0);
  const [preparationState, setPreparationState] = useState<SharePreparationState>('idle');
  const [preparedShare, setPreparedShare] = useState<PreparedVideoShare | null>(null);
  const [showWatermarkReady, setShowWatermarkReady] = useState(false);
  const [showDestinationUnavailable, setShowDestinationUnavailable] = useState(false);
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
      setPreparationState('idle');
      setPreparedShare(null);
      setShowWatermarkReady(false);
      setShowDestinationUnavailable(false);
    }
    onClose();
  };

  const videoUrl = useMemo(() => (video.url || '').trim(), [video.url]);
  const watermarkedVideoUrl = useMemo(() => (video.watermarkedVideoUrl || '').trim(), [video.watermarkedVideoUrl]);
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

  // Keep X captions concise; the video file is passed separately as an attachment.
  const xShareMessage = useMemo(() => {
    const title = Array.from((video.eventName || 'Watch on 60Seconds').trim());
    const shortTitle = title.length > 80 ? `${title.slice(0, 79).join('')}…` : title.join('');
    return `${shortTitle}\n${videoShareLink}`;
  }, [video.eventName, videoShareLink]);

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

  const getVideoUrlCacheToken = () => {
    const normalizedUrl = videoUrl.trim().toLowerCase();
    let hash = 0;

    for (let index = 0; index < normalizedUrl.length; index += 1) {
      hash = (hash * 31 + normalizedUrl.charCodeAt(index)) >>> 0;
    }

    return hash.toString(36) || 'src';
  };

  const getRemoteExtension = () => {
    const cleanRemote = videoUrl.split('?')[0].toLowerCase();
    const candidate = cleanRemote.split('.').pop() || '';
    return Object.prototype.hasOwnProperty.call(VIDEO_MIME_MAP, candidate) ? candidate : 'mp4';
  };

  const getOriginalCacheUri = () => `${FileSystem.cacheDirectory}share_video_${video.id}_${getVideoUrlCacheToken()}.${getRemoteExtension()}`;
  // Version this key whenever the transformation changes so an older, oversized
  // watermark is never reused from the device cache.
  const getWatermarkCacheKey = () => `share_core_image_v5_${video.id}_${getVideoUrlCacheToken()}`;

  const getCachedFileIfPresent = async (uri: string) => {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && (typeof info.size !== 'number' || info.size > 1024)) {
        return uri;
      }
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      return null;
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
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || (typeof info.size === 'number' && info.size <= 1024)) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        throw new Error('Downloaded video is empty or incomplete');
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

  /**
   * Prepare a local video that is guaranteed to be watermarked.
   */
  const prepareVideoForShare = async (): Promise<{ uri: string | null; mimeType: string; isWatermarked: boolean }> => {
    if (!videoUrl || Platform.OS === 'web') {
      return { uri: null, mimeType: 'video/mp4', isWatermarked: false };
    }

    try {
      if (watermarkedVideoUrl) {
        try {
          const brandedExt = watermarkedVideoUrl.split('?')[0].toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
          const brandedCache = `${FileSystem.cacheDirectory}share_branded_${video.id}_${getVideoUrlCacheToken()}.${brandedExt}`;
          let localBranded = await getCachedFileIfPresent(brandedCache);
          if (!localBranded) {
            const download = await FileSystem.downloadAsync(watermarkedVideoUrl, brandedCache);
            if (download.status === 200) localBranded = await getCachedFileIfPresent(download.uri);
          }
          if (localBranded) {
            return { uri: localBranded, mimeType: VIDEO_MIME_MAP[brandedExt], isWatermarked: true };
          }
        } catch (error) {
          console.warn('[VideoShare] Stored branded asset unavailable; regenerating:', error);
        }
      }

      const cachedWatermarkedUri = await videoWatermarkService.getCachedWatermarkedVideo(getWatermarkCacheKey());
      if (cachedWatermarkedUri) {
        console.log('[Share] Using cached watermarked video for instant share:', cachedWatermarkedUri);
        const cachedType = cachedWatermarkedUri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
        return { uri: cachedWatermarkedUri, mimeType: cachedType, isWatermarked: true };
      }

      const preparedOriginal = await ensureOriginalVideoCached();
      if (!preparedOriginal.uri) {
        return { uri: null, mimeType: preparedOriginal.mimeType, isWatermarked: false };
      }

      const watermarkResult = await videoWatermarkService.addWatermarkToVideo(preparedOriginal.uri, {
        position: 'bottom-right',
        opacity: 0.8,
        scale: 0.10,
        sourceUrl: videoUrl,
        strict: true,
        allowFallback: false,
      });

      if (!watermarkResult.applied || watermarkResult.uri === preparedOriginal.uri) {
        return { uri: null, mimeType: preparedOriginal.mimeType, isWatermarked: false };
      }

      const cachedUri = await videoWatermarkService.cacheWatermarkedVideo(getWatermarkCacheKey(), watermarkResult.uri, watermarkResult.outputType);
      return { uri: cachedUri, mimeType: watermarkResult.mimeType, isWatermarked: true };
    } catch (error) {
      console.warn('[VideoShare] Watermark preparation failed:', error);
      return { uri: null, mimeType: 'video/mp4', isWatermarked: false };
    }
  };

  const beginVideoShare = async (destination: VideoDestination) => {
    if (Platform.OS === 'web') {
      return;
    }
    if (activeShareSession || isPreparingVideo) {
      notifySharePreparing();
      return;
    }
    console.log(`[VideoShare] Selected destination: ${DESTINATION_LABELS[destination]}`);
    isCancelRequestedRef.current = false;
    activeShareSession = true;
    updatePreparingState(true);
    setPreparationState('resolving-source');
    setPreparedShare(null);
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
      setPreparationState('watermarking');
      const { uri: localUri, mimeType, isWatermarked } = await prepareVideoForShare();
      if (isCancelRequestedRef.current) return;

      clearProgressInterval();
      if (isMountedRef.current) setWatermarkProgress(95);
      if (!localUri || !isWatermarked) {
        setPreparationState('failed');
        Alert.alert('Watermark Required', 'Could not prepare a validated watermarked video. Please try again.');
        return;
      }
      setPreparationState('validating');
      const info = await FileSystem.getInfoAsync(localUri);
      const size = info.exists && typeof info.size === 'number' ? info.size : null;
      if (!info.exists || (size !== null && size <= 1024)) {
        setPreparationState('failed');
        Alert.alert('Watermark Required', 'The watermarked video could not be validated. Please try again.');
        return;
      }
      if (isMountedRef.current) setWatermarkProgress(100);
      const prepared: PreparedVideoShare = { uri: localUri, mimeType, isWatermarked: true, destination, size };
      setPreparedShare(prepared);
      setPreparationState('watermark-ready');
      setShowWatermarkReady(true);
      console.log('[VideoShare] Watermarked video ready', { uri: localUri, mimeType, size, isWatermarked: true });
    } catch (error) {
      console.warn('[VideoShare] Preparation/validation failed:', error);
      setPreparationState('failed');
      Alert.alert('Watermark Required', 'Could not prepare a validated watermarked video. Please try again.');
    } finally {
      clearProgressInterval();
      activeShareSession = false;
      updatePreparingState(false);
      if (isMountedRef.current) setWatermarkProgress(0);
    }
  };

  const finishShare = () => {
    if (preparedShare) shareVideo(video.id, preparedShare.destination as any);
    setPreparationState('completed');
    setPreparedShare(null);
    onClose();
  };

  const openSystemShareSheet = async () => {
    if (!preparedShare || activeShareSession) return;
    activeShareSession = true;
    setShowDestinationUnavailable(false);
    setPreparationState('sharing');
    try {
      const response = await ShareOpen.open({ title: video.eventName, ...(preparedShare.destination === 'tiktok' ? {} : {
        message: preparedShare.destination === 'twitter' ? xShareMessage : shareMessage }),
        url: preparedShare.uri, type: preparedShare.mimeType, failOnCancel: false });
      if (!isLikelyShareCancelled(response)) finishShare();
      else if (preparedShare.destination === 'tiktok') setShowWatermarkReady(true);
    } catch (error) {
      if (!isLikelyShareCancelled(error)) {
        console.warn('[VideoShare] System share sheet failed:', error);
        Alert.alert('Share Failed', 'The share sheet could not be opened. Please try again.');
      }
      if (preparedShare.destination === 'tiktok') setShowWatermarkReady(true);
    } finally { activeShareSession = false; }
  };

  const savePreparedVideoForTikTok = async () => {
    if (!preparedShare || activeShareSession) return;
    activeShareSession = true;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert('Photo Access Needed', 'Allow photo access in Settings to save the video, or use the share sheet.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(preparedShare.uri);
      Alert.alert('Video Saved', 'Open TikTok, tap +, then Upload and select the saved video.');
    } catch {
      Alert.alert('Save Failed', 'The video could not be saved. Please try the share sheet.');
    } finally {
      activeShareSession = false;
    }
  };

  const continuePreparedShare = async () => {
    if (!preparedShare || activeShareSession) return;
    setShowWatermarkReady(false);
    // X's direct-share fallback interpolates `url` into a tweet intent, exposing
    // file:// cache paths as text. The system sheet sends a native video attachment
    // to X's share extension instead, including when the X app is unavailable.
    // TikTok is not a supported direct target in react-native-share.
    if (preparedShare.destination === 'generic' || preparedShare.destination === 'twitter' || preparedShare.destination === 'tiktok') {
      await openSystemShareSheet();
      return;
    }
    activeShareSession = true;
    setPreparationState('checking-destination');
    console.log(`[VideoShare] Checking destination availability: ${DESTINATION_LABELS[preparedShare.destination]}`);
    try {
      const socialTarget = resolveShareSocialTarget(preparedShare.destination);
      if (!socialTarget || typeof ShareOpen.shareSingle !== 'function') {
        console.warn('[VideoShare] Native sharing module unavailable');
        Alert.alert('Sharing Unavailable', 'Native sharing is unavailable in this app build.');
        return;
      }
      setPreparationState('sharing');
      const supportsMessage = preparedShare.destination === 'whatsapp';
      const response = await ShareOpen.shareSingle({ social: socialTarget, url: preparedShare.uri,
        type: preparedShare.mimeType, ...(supportsMessage ? { message: shareMessage } : {}) });
      console.log(`[VideoShare] ${DESTINATION_LABELS[preparedShare.destination]} installed: true`);
      if (!isLikelyShareCancelled(response)) finishShare();
    } catch (error: any) {
      if (isLikelyShareCancelled(error)) return;
      const message = String(error?.message || error || '').toLowerCase();
      if (message.includes('not installed')) {
        console.log(`[VideoShare] ${DESTINATION_LABELS[preparedShare.destination]} installed: false`);
        setPreparationState('watermark-ready');
        setShowDestinationUnavailable(true);
      } else {
        console.warn('[VideoShare] Destination share failed:', error);
        Alert.alert('Share Failed', 'The prepared video could not be sent. You can try the iOS share sheet.');
        setShowDestinationUnavailable(true);
      }
    } finally { activeShareSession = false; }
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

  const handleShareToInstagram = async () => {
    handleHapticFeedback();
    if (Platform.OS === 'web') return void Linking.openURL('https://www.instagram.com/').catch(() => {});
    await beginVideoShare('instagram');
  };

  const handleShareToFacebook = async () => {
    handleHapticFeedback();
    await beginVideoShare('facebook');
  };

  const handleShareToTwitter = async () => {
    handleHapticFeedback();
    await beginVideoShare('twitter');
  };

  const handleShareToWhatsApp = async () => {
    handleHapticFeedback();
    await beginVideoShare('whatsapp');
  };

  const handleShareToTikTok = async () => {
    handleHapticFeedback();
    await beginVideoShare('tiktok');
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

        {showWatermarkReady && preparedShare && (
          <View style={styles.dialogBackdrop}>
            <View style={styles.dialogCard}>
              <Text style={styles.dialogIcon}>✓</Text>
              <Text style={styles.dialogTitle}>Watermark Added Successfully</Text>
              <Text style={styles.dialogBody}>{preparedShare.destination === 'twitter'
                ? 'Your watermarked video is ready. Select X from the share sheet to create your post.'
                 : preparedShare.destination === 'tiktok'
                  ? 'Select TikTok from the share sheet. If it is not listed, save the video and upload it in TikTok.'
                  : 'Your video is ready to share with the 60Seconds logo embedded.'}</Text>
              <TouchableOpacity style={styles.dialogPrimaryButton} onPress={continuePreparedShare}>
                <Text style={styles.dialogPrimaryText}>Continue to {DESTINATION_LABELS[preparedShare.destination]}</Text>
              </TouchableOpacity>
              {preparedShare.destination === 'tiktok' && (
                <TouchableOpacity style={styles.dialogSecondaryButton} onPress={savePreparedVideoForTikTok}>
                  <Text style={styles.dialogSecondaryText}>Save video for TikTok</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.dialogSecondaryButton} onPress={() => {
                setShowWatermarkReady(false); setPreparedShare(null); setPreparationState('idle');
              }}>
                <Text style={styles.dialogSecondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {showDestinationUnavailable && preparedShare && (
          <View style={styles.dialogBackdrop}>
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>{DESTINATION_LABELS[preparedShare.destination]} is not available</Text>
              <Text style={styles.dialogBody}>The watermarked video is ready. You can share it using the iOS Share Sheet.</Text>
              <TouchableOpacity style={styles.dialogPrimaryButton} onPress={openSystemShareSheet}>
                <Text style={styles.dialogPrimaryText}>Use iOS Share Sheet</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogSecondaryButton} onPress={() => setShowDestinationUnavailable(false)}>
                <Text style={styles.dialogSecondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    padding: 24,
    alignItems: 'center',
  },
  dialogIcon: {
    color: Colors.dark.primary,
    fontSize: 44,
    fontWeight: '800',
    marginBottom: 8,
  },
  dialogTitle: {
    color: Colors.dark.text,
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  dialogBody: {
    color: Colors.dark.subtext,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 22,
  },
  dialogPrimaryButton: {
    width: '100%',
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dialogPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dialogSecondaryButton: { paddingVertical: 14, paddingHorizontal: 24 },
  dialogSecondaryText: { color: Colors.dark.subtext, fontSize: 15, fontWeight: '600' },
});
