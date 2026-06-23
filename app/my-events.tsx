import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { CalendarDays, ChevronRight, MapPin, CircleOff, CircleCheck, X, Clock } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { EventQueries, EventWithProducts } from '@/lib/event-queries';
import { useAuth } from '@/lib/auth';
import { isEventClosed } from '@/utils/event-status';

export default function MyEventsScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<EventWithProducts[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endedEvent, setEndedEvent] = useState<EventWithProducts | null>(null);

  const loadEvents = useCallback(async () => {
    if (!user?.id) {
      setEvents([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await EventQueries.getUserEvents(user.id);
      if (!result.success) {
        setError(result.error || 'Failed to load events');
        setEvents([]);
        return;
      }

      setEvents(result.events || []);
    } catch (caughtError: any) {
      setError(caughtError?.message || 'Something went wrong');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents])
  );

  const openEvent = (event: EventWithProducts) => {
    const closed = isEventClosed({
      status: event.status,
      startDate: event.start_date,
      endDate: event.end_date,
      eventDate: (event as any).event_date,
    });
    if (closed) {
      setEndedEvent(event);
      return;
    }

    // Open the dedicated event page directly so organizer history remains navigable
    // even when feed routing/selectVideo state is stale.
    router.push({ pathname: '/event/[id]', params: { id: event.video_id || event.video?.id || event.id } });
  };

  if (authLoading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>My Events</Text>
        <Text style={styles.subtitle}>Sign in to view the events you created.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/signin')}>
          <Text style={styles.primaryButtonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Organizer tools</Text>
        <Text style={styles.title}>My Events</Text>
        <Text style={styles.subtitle}>
          Track every event you created. Events close automatically once their scheduled time has passed.
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{events.length}</Text>
          <Text style={styles.summaryLabel}>Created events</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{events.filter((event) => isEventClosed({ status: event.status, startDate: event.start_date, endDate: event.end_date, eventDate: (event as any).event_date })).length}</Text>
          <Text style={styles.summaryLabel}>Closed events</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator size="small" color={Colors.dark.primary} />
          <Text style={styles.loadingText}>Loading your events...</Text>
        </View>
      ) : error ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Unable to load events</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={loadEvents}>
            <Text style={styles.primaryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No events yet</Text>
          <Text style={styles.emptyText}>Create an event and it will appear here automatically.</Text>
        </View>
      ) : (
        events.map((event) => {
          const closed = isEventClosed({ status: event.status, startDate: event.start_date, endDate: event.end_date, eventDate: (event as any).event_date });
          const statusLabel = event.status === 'draft' ? 'Draft' : closed ? 'Closed' : 'Open';
          const thumbnail = event.video?.thumbnail_url || event.image_url || 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80';

          return (
            <TouchableOpacity key={event.id} style={styles.eventCard} onPress={() => openEvent(event)} activeOpacity={0.85}>
              <Image source={{ uri: thumbnail }} style={styles.thumbnail} contentFit="cover" transition={250} />

              <View style={styles.eventBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.eventName} numberOfLines={1}>{event.event_name}</Text>
                  <View style={[styles.statusBadge, closed ? styles.closedBadge : event.status === 'draft' ? styles.draftBadge : styles.openBadge]}>
                    {closed ? <CircleOff size={12} color={Colors.dark.text} /> : <CircleCheck size={12} color={Colors.dark.text} />}
                    <Text style={styles.statusText}>{statusLabel}</Text>
                  </View>
                </View>

                {!!event.description && <Text style={styles.eventDescription} numberOfLines={2}>{event.description}</Text>}

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <CalendarDays size={14} color={Colors.dark.primary} />
                    <Text style={styles.metaText}>{new Date(event.start_date).toLocaleString()}</Text>
                  </View>
                  {!!event.location_name && (
                    <View style={styles.metaItem}>
                      <MapPin size={14} color={Colors.dark.primary} />
                      <Text style={styles.metaText} numberOfLines={1}>{event.location_name}</Text>
                    </View>
                  )}
                </View>
              </View>

              <ChevronRight size={20} color={Colors.dark.inactive} />
            </TouchableOpacity>
          );
        })
      )}

      <View style={styles.footerSpace} />
    </ScrollView>

    <Modal
      visible={!!endedEvent}
      transparent
      animationType="fade"
      onRequestClose={() => setEndedEvent(null)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.endedDialog}>
          <TouchableOpacity
            style={styles.dialogCloseButton}
            onPress={() => setEndedEvent(null)}
            accessibilityLabel="Close ended event dialog"
          >
            <X size={18} color={Colors.dark.text} />
          </TouchableOpacity>

          <View style={styles.dialogIconWrap}>
            <Clock size={30} color={Colors.dark.text} />
          </View>

          <Text style={styles.dialogKicker}>Event closed</Text>
          <Text style={styles.dialogTitle}>This event has ended</Text>
          <Text style={styles.dialogMessage}>
            {endedEvent?.event_name ? `${endedEvent.event_name} is no longer active.` : 'This event is no longer active.'} Closed events stay in your organizer history, but the live event page is not available anymore.
          </Text>

          <View style={styles.dialogDivider} />

          <TouchableOpacity style={styles.dialogPrimaryButton} onPress={() => setEndedEvent(null)}>
            <Text style={styles.dialogPrimaryText}>Back to My Events</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
    gap: 16,
  },
  hero: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  kicker: {
    color: Colors.dark.primary,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
    fontWeight: '700',
  },
  title: {
    color: Colors.dark.text,
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: Colors.dark.subtext,
    fontSize: 14,
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  summaryValue: {
    color: Colors.dark.text,
    fontSize: 26,
    fontWeight: '800',
  },
  summaryLabel: {
    color: Colors.dark.subtext,
    marginTop: 4,
    fontSize: 12,
  },
  loadingCard: {
    borderRadius: 20,
    padding: 20,
    backgroundColor: '#111827',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.dark.subtext,
  },
  emptyCard: {
    borderRadius: 20,
    padding: 20,
    backgroundColor: '#111827',
    gap: 10,
  },
  emptyTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    color: Colors.dark.subtext,
    lineHeight: 20,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 20,
    padding: 12,
    backgroundColor: '#0B1220',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  thumbnail: {
    width: 76,
    height: 76,
    borderRadius: 16,
    backgroundColor: '#1F2937',
  },
  eventBody: {
    flex: 1,
    gap: 8,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  eventName: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  openBadge: {
    backgroundColor: '#059669',
  },
  closedBadge: {
    backgroundColor: '#374151',
  },
  draftBadge: {
    backgroundColor: '#7C3AED',
  },
  statusText: {
    color: Colors.dark.text,
    fontSize: 11,
    fontWeight: '700',
  },
  eventDescription: {
    color: Colors.dark.subtext,
    fontSize: 13,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
  },
  metaText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    flexShrink: 1,
  },
  primaryButton: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: Colors.dark.text,
    fontWeight: '700',
  },
  footerSpace: {
    height: 24,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.76)',
  },
  endedDialog: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(129,140,248,0.42)',
    alignItems: 'center',
    shadowColor: Colors.dark.primary,
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  dialogCloseButton: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialogIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  dialogKicker: {
    color: Colors.dark.primaryLight,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  dialogTitle: {
    color: Colors.dark.text,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  dialogMessage: {
    color: Colors.dark.subtext,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  dialogDivider: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 20,
  },
  dialogPrimaryButton: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.dark.primary,
  },
  dialogPrimaryText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '800',
  },
});
