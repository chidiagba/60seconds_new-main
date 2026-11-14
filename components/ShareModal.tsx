import { videoWatermarkService } from '@/utils/video-watermark';
import * as MediaLibrary from 'expo-media-library';
import { logger } from '@/lib/logger';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import ShareOpen from '@/lib/native-share';
import { Copy, Facebook, Instagram, Link, MessageCircle, Share2, Download, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import Colors from '@/constants/colors';
import { Video } from '@/types';
import { supabase } from '@/lib/supabase';
import { findPublicEventForVideo } from '@/lib/public-event-link';
import { useVideoStore } from '@/store/video-store';
import {
  APP_WEBSITE_URL,
  buildVideoShareUrl,
  buildEventShareUrl,
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

type VideoDestination = 'instagram' | 'facebook' | 'twitter' | 'whatsapp' | 'tiktok' | 'generic';
type PreparedVideoShare = {
  uri: string;
  mimeType: string;
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
  const [linkedEvent, setLinkedEvent] = useState<{ videoId: string; eventId: string } | null>(null);
  const eventId = video.eventId || (linkedEvent?.videoId === video.id ? linkedEvent.eventId : undefined);
  useEffect(() => {
    let active = true;
    if (visible && !video.eventId) {
      void findPublicEventForVideo(supabase, video.id).then(id => {
        if (active && id) setLinkedEvent({ videoId: video.id, eventId: id });
      }).catch(error => logger.warn('Unable to resolve event share link:', error));
    }
    return () => { active = false; };
  }, [visible, video.id, video.eventId]);
  const [isPreparingVideo, setIsPreparingVideo] = useState(false);
  const isMountedRef = useRef(true);
  const isCancelRequestedRef = useRef(false);
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

  const handleModalClose = () => {
    // Always allow close — cancel any in-progress video preparation
    isCancelRequestedRef.current = true;
    if (isMountedRef.current) {
      setIsPreparingVideo(false);

    }
    onClose();
  };

  const videoUrl = useMemo(() => (video.url || '').trim(), [video.url]);
  const videoShareLink = useMemo(() => eventId ? buildEventShareUrl(eventId) : buildVideoShareUrl(video.id), [video.id, eventId]);
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
    Alert.alert('Preparing Share', 'Preparing your video. You can cancel at any time.');
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
    const normalizedUrl = videoUrl.trim();
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
      logger.debug('[Share] Downloading original video into stable share cache...');
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

  const prepareVideoForShare = async () => {
    const original = await ensureOriginalVideoCached();
    if (!original.uri) throw new Error('The source video could not be downloaded');
    const prepared = await videoWatermarkService.prepareExport(original.uri, video.user?.username || '', video.id);
    const normalizedUri = prepared.uri.split('?')[0].toLowerCase();
    if (!prepared.applied || prepared.outputType !== 'mp4' || prepared.mimeType !== 'video/mp4'
      || !prepared.uri.startsWith('file://') || !normalizedUri.endsWith('.mp4')) {
      throw new Error('The watermark exporter did not return a local MP4 video');
    }
    const info = await FileSystem.getInfoAsync(prepared.uri);
    if (!info.exists || (typeof info.size === 'number' && info.size <= 1024)) {
      throw new Error('The exported MP4 is missing or incomplete');
    }
    return prepared;
  };

  const beginVideoShare = async (destination: VideoDestination) => {
    if (Platform.OS === 'web') {
      return;
    }
    if (activeShareSession || isPreparingVideo) {
      notifySharePreparing();
      return;
    }
    logger.debug(`[VideoShare] Selected destination: ${DESTINATION_LABELS[destination]}`);
    isCancelRequestedRef.current = false;
    activeShareSession = true;
    updatePreparingState(true);

    try {
      const { uri: localUri, mimeType } = await prepareVideoForShare();
      if (isCancelRequestedRef.current || !isMountedRef.current) return;

      if (!localUri) {
        Alert.alert('Video Unavailable', 'Could not prepare the video. Please try again.');
        return;
      }

      const info = await FileSystem.getInfoAsync(localUri);
      const size = info.exists && typeof info.size === 'number' ? info.size : null;
      if (!info.exists || (size !== null && size <= 1024)) {
        Alert.alert('Video Unavailable', 'The video could not be validated. Please try again.');
        return;
      }
      if (isCancelRequestedRef.current || !isMountedRef.current) return;
      const prepared: PreparedVideoShare = { uri: localUri, mimeType, destination, size };

      await continuePreparedShare(prepared);
      logger.debug('[VideoShare] Watermarked video ready', { uri: localUri, mimeType, size });
    } catch (error) {
      if (isLikelyShareCancelled(error) || isCancelRequestedRef.current || !isMountedRef.current) return;
      logger.warn('[VideoShare] Preparation/validation failed:', error);

      const message = error instanceof Error ? error.message : 'Could not prepare the video. Please try again.';
      Alert.alert('Video Unavailable', message);
    } finally {
      activeShareSession = false;
      updatePreparingState(false);
    }
  };

  const finishShare = (prepared: PreparedVideoShare) => {
    shareVideo(video.id, prepared.destination as any);

    onClose();
  };

  const openSystemShareSheet = async (prepared: PreparedVideoShare) => {
    if (!prepared) return;

    const response = await ShareOpen.open({
      title: video.eventName,
      ...(prepared.destination === 'tiktok' ? {} : {
        message: prepared.destination === 'twitter' ? xShareMessage : shareMessage,
      }),
      url: prepared.uri, type: prepared.mimeType, failOnCancel: false,
      ...(Platform.OS === 'android' ? { useInternalStorage: true } : {}),
    });
    if (!isLikelyShareCancelled(response)) finishShare(prepared);
  };

  const continuePreparedShare = async (prepared: PreparedVideoShare) => {
    if (isCancelRequestedRef.current || !isMountedRef.current) return;
    const socialTarget = resolveShareSocialTarget(prepared.destination);
    // Route every iOS destination through UIActivityViewController so iOS hands
    // the local MP4 file to the selected app's share extension.
    const useSystemVideoShareSheet = Platform.OS === 'ios' || prepared.destination === 'generic'
      || prepared.destination === 'twitter' || prepared.destination === 'tiktok'
      || prepared.mimeType !== 'video/mp4';
    if (useSystemVideoShareSheet || !socialTarget || typeof ShareOpen.shareSingle !== 'function') {
      await openSystemShareSheet(prepared);
      return;
    }

    try {
      if (Platform.OS === 'android' && typeof ShareOpen.isPackageInstalled === 'function') {
        const packages = { instagram: 'com.instagram.android', facebook: 'com.facebook.katana', whatsapp: 'com.whatsapp' };
        const packageName = packages[prepared.destination as keyof typeof packages];
        if (packageName && !(await ShareOpen.isPackageInstalled(packageName)).isInstalled) {
          await openSystemShareSheet(prepared);
          return;
        }
      }
      const response = await ShareOpen.shareSingle({
        social: socialTarget, url: prepared.uri, type: prepared.mimeType,
        ...(Platform.OS === 'android' ? { useInternalStorage: true } : {}),
        ...(prepared.destination === 'whatsapp' ? { message: shareMessage } : {}),
      });
      if (!isLikelyShareCancelled(response)) finishShare(prepared);
    } catch (error) {
      if (!isLikelyShareCancelled(error)) await openSystemShareSheet(prepared);
    }
  };

  const handleSaveVideo = async () => {
    if (Platform.OS === 'web' || activeShareSession || isPreparingVideo) return;
    activeShareSession = true;
    isCancelRequestedRef.current = false;
    updatePreparingState(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (isCancelRequestedRef.current || !isMountedRef.current) return;
      if (!permission.granted) {
        Alert.alert('Photos Permission', 'Allow photo library access to save this video.');
        return;
      }
      const result = await prepareVideoForShare();
      if (isCancelRequestedRef.current || !isMountedRef.current) return;
      await MediaLibrary.saveToLibraryAsync(result.uri);
      Alert.alert('Video saved', 'The watermarked video was saved to your library.');
    } catch (error) {
      logger.warn('Watermarked video download failed:', error);
      const message = error instanceof Error ? error.message : 'The watermarked video could not be prepared. Please try again.';
      Alert.alert('Export unavailable', message);
    } finally {
      activeShareSession = false;
      updatePreparingState(false);
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
    if (Platform.OS === 'web') {
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`);
      return;
    }
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
        logger.error('Web Share API failed, copying link', error);
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
      logger.error('[Share] Share page failed:', error);
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
                <ActivityIndicator color={Colors.dark.primary} />
                <Text style={styles.loadingText}>Preparing video…</Text>
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
              {Platform.OS !== 'web' && <ShareOption icon={<Download size={28} color={Colors.dark.primary} />} label="Save video" onPress={handleSaveVideo} />}
              <ShareOption icon={<Link size={28} color={Colors.dark.secondary} />} label="Share Page" onPress={handleShareAsWebpage} />
            </View>

            <View style={styles.shareInfoContainer}>
              <Text style={styles.shareInfoText}>
                Share this event as a webpage where others can watch the video, buy tickets, purchase products, and reserve table seats.
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
