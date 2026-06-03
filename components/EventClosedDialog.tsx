import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Calendar, MapPin, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/colors';

type EventClosedDialogProps = {
  visible: boolean;
  event: any | null;
  onClose: () => void;
  onWatchVideo?: () => void;
};

const formatEventDate = (value?: string | null) => {
  if (!value) return 'Date not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date not available';

  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export default function EventClosedDialog({
  visible,
  event,
  onClose,
  onWatchVideo,
}: EventClosedDialogProps) {
  const closedDate = formatEventDate(event?.end_date || event?.start_date || event?.event_date);
  const startDate = formatEventDate(event?.start_date);
  const eventName = event?.event_name || event?.title || 'Event closed';
  const location = [event?.location_name, event?.location_city].filter(Boolean).join(', ');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <X size={20} color={Colors.dark.text} />
          </TouchableOpacity>

          <LinearGradient
            colors={['rgba(255, 56, 92, 0.24)', 'rgba(10, 10, 15, 0)']}
            style={styles.headerGlow}
          />

          <View style={styles.badge}>
            <Text style={styles.badgeText}>Event Closed</Text>
          </View>

          <Text style={styles.title} numberOfLines={2}>{eventName}</Text>
          <Text style={styles.closedText}>Closed on {closedDate}</Text>

          <View style={styles.detailRow}>
            <Calendar size={16} color={Colors.dark.primary} style={styles.detailIcon} />
            <Text style={styles.detailText}>Started {startDate}</Text>
          </View>

          {!!location && (
            <View style={styles.detailRow}>
              <MapPin size={16} color={Colors.dark.primary} style={styles.detailIcon} />
              <Text style={styles.detailText} numberOfLines={2}>{location}</Text>
            </View>
          )}

          {!!event?.description && (
            <Text style={styles.description} numberOfLines={4}>{event.description}</Text>
          )}

          {onWatchVideo ? (
            <TouchableOpacity style={styles.primaryButton} onPress={onWatchVideo}>
              <Text style={styles.primaryButtonText}>Watch Event Video</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.primaryButton} onPress={onClose}>
              <Text style={styles.primaryButtonText}>Got It</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: Colors.dark.card,
    padding: 22,
  },
  headerGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 2,
    height: 34,
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 56, 92, 0.16)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  badgeText: {
    color: Colors.dark.primary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.dark.text,
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
    marginRight: 28,
  },
  closedText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 18,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  detailIcon: {
    marginRight: 8,
  },
  detailText: {
    flex: 1,
    color: Colors.dark.subtext,
    fontSize: 14,
    lineHeight: 20,
  },
  description: {
    color: Colors.dark.text,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 18,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    marginTop: 8,
  },
  primaryButtonText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '800',
  },
});
