import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Platform,
  TouchableOpacity,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MapPin, Calendar, Copy, Share2 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { mockVideos } from '@/mocks/videos';
import { Video } from '@/types';
import * as Clipboard from 'expo-clipboard';
import { buildVideoShareUrl } from '@/constants/app-links';

export default function WebVideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [video, setVideo] = useState<Video | null>(null);

  const getUploaderUsername = (inputVideo: Video | null) => {
    const rawUsername = String(inputVideo?.user?.username || '').trim();
    if (!rawUsername) return null;
    return `@${rawUsername.replace(/^@+/, '')}`;
  };

  useEffect(() => {
    if (id) {
      const foundVideo = mockVideos.find((v) => v.id === id);
      setVideo(foundVideo || null);
    }
  }, [id]);

  const handleShare = async () => {
    if (!video) return;
    const shareLink = buildVideoShareUrl(video.id);
    const uploaderUsername = getUploaderUsername(video);
    const shareMessage = [
      `Check out this event: ${video.eventName} at ${video.location.name}`,
      uploaderUsername ? `Uploaded by ${uploaderUsername}` : null,
      shareLink,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      await Share.share({
        message: shareMessage,
        title: video.eventName,
        url: shareLink,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleCopyLink = async () => {
    if (!video) return;
    const shareLink = buildVideoShareUrl(video.id);
    await Clipboard.setStringAsync(shareLink);
    alert('Link copied to clipboard!');
  };

  if (!video) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Video not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pageUrl = buildVideoShareUrl(video.id);
  const uploaderUsername = getUploaderUsername(video);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Close Button (for modal-like experience) */}
          {Platform.OS !== 'web' && (
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => router.back()}
            >
              <Text style={styles.closeButtonText}>← Back</Text>
            </TouchableOpacity>
          )}

          {/* Video Container */}
          <View style={styles.videoContainer}>
            {Platform.OS === 'web' ? (
              <video
                style={{
                  width: '100%',
                  maxHeight: 500,
                  backgroundColor: '#000',
                  borderRadius: 12,
                }}
                controls
                autoPlay
                playsInline
                poster={video.thumbnail}
              >
                <source src={video.url} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            ) : (
              <View style={styles.videoThumbnail}>
                <Text style={styles.playIcon}>▶</Text>
              </View>
            )}
          </View>

          {/* Event Details */}
          <View style={styles.detailsContainer}>
            <Text style={styles.eventName}>{video.eventName}</Text>

            {/* Location */}
            <View style={styles.detailRow}>
              <MapPin color={Colors.dark.primary} size={20} />
              <Text style={styles.detailText}>{video.location.name}</Text>
            </View>

            {/* Date */}
            {video.eventDate && (
              <View style={styles.detailRow}>
                <Calendar color={Colors.dark.primary} size={20} />
                <Text style={styles.detailText}>
                  {new Date(video.eventDate).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            )}

            {/* Description */}
            {video.description && (
              <Text style={styles.description}>{video.description}</Text>
            )}

            {/* User Info */}
            <View style={styles.userCard}>
              <Text style={styles.userLabel}>Hosted by</Text>
              <Text style={styles.userName}>{video.user?.displayName || video.user?.name}</Text>
              {uploaderUsername && <Text style={styles.userUsername}>{uploaderUsername}</Text>}
              {video.user?.avatar && (
                <Text style={styles.userAvatar}>👤</Text>
              )}
            </View>

            {/* Stats */}
            <View style={styles.statsContainer}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{video.likes}</Text>
                <Text style={styles.statLabel}>Likes</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{video.comments}</Text>
                <Text style={styles.statLabel}>Comments</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{video.shares}</Text>
                <Text style={styles.statLabel}>Shares</Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.shareButton]}
                onPress={handleShare}
              >
                <Share2 color="#fff" size={20} />
                <Text style={styles.buttonText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.copyButton]}
                onPress={handleCopyLink}
              >
                <Copy color={Colors.dark.primary} size={20} />
                <Text style={styles.copyButtonText}>Copy Link</Text>
              </TouchableOpacity>
            </View>

            {/* Share Link Display */}
            <View style={styles.shareLinkContainer}>
              <Text style={styles.shareLinkLabel}>Share this video:</Text>
              <Text style={styles.shareLink}>{pageUrl}</Text>
            </View>
          </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  placeholderText: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    marginBottom: 16,
  },
  closeButtonText: {
    fontSize: 16,
    color: Colors.dark.primary,
    fontWeight: '600',
  },
  videoContainer: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: '#000',
  },
  videoThumbnail: {
    width: '100%',
    aspectRatio: 9 / 16,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 48,
    color: Colors.dark.primary,
    opacity: 0.7,
  },
  detailsContainer: {
    gap: 16,
  },
  eventName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailText: {
    fontSize: 14,
    color: Colors.dark.subtext,
    flex: 1,
  },
  description: {
    fontSize: 14,
    color: Colors.dark.text,
    lineHeight: 20,
    marginVertical: 8,
  },
  userCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    marginVertical: 8,
  },
  userLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 4,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  userUsername: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginTop: 2,
  },
  userAvatar: {
    fontSize: 32,
    marginTop: 8,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 16,
    marginVertical: 12,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.primary,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginTop: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  shareButton: {
    backgroundColor: Colors.dark.primary,
  },
  copyButton: {
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  copyButtonText: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  shareLinkContainer: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  shareLinkLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 6,
  },
  shareLink: {
    fontSize: 12,
    color: Colors.dark.primary,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
