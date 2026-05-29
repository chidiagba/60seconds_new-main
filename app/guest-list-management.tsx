import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  SafeAreaView,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Users, UserPlus, Calendar, MapPin, Clock, CheckCircle, XCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useGuestListStore } from '@/store/guest-list-store';
import { useVideoStore } from '@/store/video-store';
import { useAuthStore } from '@/store/auth-store';
import { GuestListRequestStatus } from '@/types';

export default function GuestListManagementScreen() {
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const { user } = useAuthStore();
  const { videos, fetchVideos } = useVideoStore();
  const {
    fetchGuestList,
    fetchGuestListRequests,
    approveGuestListRequest,
    rejectGuestListRequest,
    getGuestListForEvent,
    getGuestListRequestsForEvent,
    isLoading
  } = useGuestListStore();

  const [selectedEventId, setSelectedEventId] = useState<string | null>(eventId || null);

  // Get user's business events
  const businessEvents = videos.filter(video => 
    user && video.userId === user.id && user.isBusinessAccount
  );

  const selectedEvent = selectedEventId ? videos.find(v => v.id === selectedEventId) : null;
  const guestList = selectedEventId ? getGuestListForEvent(selectedEventId) : [];
  const guestListRequests = selectedEventId ? getGuestListRequestsForEvent(selectedEventId) : [];
  const pendingRequests = guestListRequests.filter(r => r.status === GuestListRequestStatus.PENDING);

  useEffect(() => {
    fetchVideos();
  }, []);

  useEffect(() => {
    if (selectedEventId) {
      fetchGuestList(selectedEventId);
      fetchGuestListRequests(selectedEventId);
    }
  }, [selectedEventId]);

  const handleApproveRequest = async (requestId: string) => {
    if (!selectedEventId) return;
    
    try {
      await approveGuestListRequest(selectedEventId, requestId);
      Alert.alert('Success', 'Request approved and user added to guest list');
    } catch (error) {
      Alert.alert('Error', 'Failed to approve request');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!selectedEventId) return;
    
    try {
      await rejectGuestListRequest(selectedEventId, requestId);
      Alert.alert('Success', 'Request rejected');
    } catch (error) {
      Alert.alert('Error', 'Failed to reject request');
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Date TBA';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/profile');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Guest List Management</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content}>
        {/* Event Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Event</Text>
          {businessEvents.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Calendar size={40} color={Colors.dark.subtext} />
              <Text style={styles.emptyText}>No events found</Text>
              <Text style={styles.emptySubtext}>Create an event to manage guest lists</Text>
            </View>
          ) : (
            businessEvents.map(event => (
              <TouchableOpacity
                key={event.id}
                style={[
                  styles.eventCard,
                  selectedEventId === event.id && styles.selectedEventCard
                ]}
                onPress={() => setSelectedEventId(event.id)}
              >
                <Image
                  source={{ uri: event.thumbnail }}
                  style={styles.eventThumbnail}
                  contentFit="cover"
                  transition={300}
                />
                
                <View style={styles.eventInfo}>
                  <Text style={styles.eventName}>{event.eventName}</Text>
                  
                  <View style={styles.eventDetails}>
                    <View style={styles.eventDetail}>
                      <MapPin size={14} color={Colors.dark.subtext} />
                      <Text style={styles.eventDetailText}>{event.location.name}</Text>
                    </View>
                    
                    <View style={styles.eventDetail}>
                      <Calendar size={14} color={Colors.dark.subtext} />
                      <Text style={styles.eventDetailText}>{formatDate(event.eventDate)}</Text>
                    </View>
                  </View>
                  
                  <View style={styles.eventStats}>
                    <View style={styles.statItem}>
                      <Users size={14} color={Colors.dark.primary} />
                      <Text style={styles.statText}>
                        {guestList.length} guests
                      </Text>
                    </View>
                    
                    {pendingRequests.length > 0 && (
                      <View style={styles.statItem}>
                        <Clock size={14} color="#FFA500" />
                        <Text style={styles.statText}>
                          {pendingRequests.length} pending
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Guest List Management */}
        {selectedEvent && (
          <>
            {/* Pending Requests */}
            {pendingRequests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Pending Requests ({pendingRequests.length})
                </Text>
                
                {pendingRequests.map(request => (
                  <View key={request.id} style={styles.requestCard}>
                    <Image
                      source={{ uri: request.user.avatar }}
                      style={styles.userAvatar}
                      contentFit="cover"
                      transition={300}
                    />
                    
                    <View style={styles.requestInfo}>
                      <Text style={styles.userName}>
                        {request.user.displayName || request.user.name}
                      </Text>
                      <Text style={styles.userUsername}>@{request.user.username}</Text>
                      
                      {request.message && (
                        <Text style={styles.requestMessage} numberOfLines={2}>
                          "{request.message}"
                        </Text>
                      )}
                      
                      <Text style={styles.requestTime}>
                        Requested {new Date(request.requestedAt).toLocaleDateString()}
                      </Text>
                    </View>
                    
                    <View style={styles.requestActions}>
                      <TouchableOpacity
                        style={styles.approveButton}
                        onPress={() => handleApproveRequest(request.id)}
                      >
                        <CheckCircle size={20} color="#4CAF50" />
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={styles.rejectButton}
                        onPress={() => handleRejectRequest(request.id)}
                      >
                        <XCircle size={20} color="#FF5252" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Current Guest List */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  Guest List ({guestList.length})
                </Text>
                
                <TouchableOpacity
                  style={styles.manageButton}
                  onPress={() => {
                    if (selectedEventId) {
                      router.push({
                        pathname: '/event/[id]',
                        params: { id: selectedEventId }
                      });
                    }
                  }}
                >
                  <UserPlus size={16} color={Colors.dark.primary} />
                  <Text style={styles.manageButtonText}>Manage</Text>
                </TouchableOpacity>
              </View>
              
              {guestList.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Users size={40} color={Colors.dark.subtext} />
                  <Text style={styles.emptyText}>No guests yet</Text>
                  <Text style={styles.emptySubtext}>
                    Add users to your guest list or approve pending requests
                  </Text>
                </View>
              ) : (
                guestList.map(entry => (
                  <View key={entry.id} style={styles.guestCard}>
                    <Image
                      source={{ uri: entry.user.avatar }}
                      style={styles.userAvatar}
                      contentFit="cover"
                      transition={300}
                    />
                    
                    <View style={styles.guestInfo}>
                      <Text style={styles.userName}>
                        {entry.user.displayName || entry.user.name}
                      </Text>
                      <Text style={styles.userUsername}>@{entry.user.username}</Text>
                      
                      {entry.notes && (
                        <Text style={styles.guestNotes} numberOfLines={1}>
                          "{entry.notes}"
                        </Text>
                      )}
                      
                      <Text style={styles.addedTime}>
                        Added {new Date(entry.addedAt).toLocaleDateString()}
                      </Text>
                    </View>
                    
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusText}>Confirmed</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.dark.primary} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  manageButtonText: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 4,
  },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedEventCard: {
    borderColor: Colors.dark.primary,
  },
  eventThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    marginRight: 12,
  },
  eventInfo: {
    flex: 1,
  },
  eventName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  eventDetails: {
    marginBottom: 8,
  },
  eventDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventDetailText: {
    color: Colors.dark.subtext,
    fontSize: 14,
    marginLeft: 6,
  },
  eventStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statText: {
    color: Colors.dark.text,
    fontSize: 12,
    marginLeft: 4,
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  guestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  requestInfo: {
    flex: 1,
  },
  guestInfo: {
    flex: 1,
  },
  userName: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '500',
  },
  userUsername: {
    color: Colors.dark.subtext,
    fontSize: 14,
    marginTop: 2,
  },
  requestMessage: {
    color: Colors.dark.text,
    fontSize: 14,
    marginTop: 4,
    fontStyle: 'italic',
  },
  guestNotes: {
    color: Colors.dark.text,
    fontSize: 14,
    marginTop: 4,
    fontStyle: 'italic',
  },
  requestTime: {
    color: Colors.dark.subtext,
    fontSize: 12,
    marginTop: 4,
  },
  addedTime: {
    color: Colors.dark.subtext,
    fontSize: 12,
    marginTop: 4,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  approveButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  statusText: {
    color: Colors.dark.primary,
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 16,
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptySubtext: {
    marginTop: 8,
    color: Colors.dark.subtext,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: Colors.dark.text,
    fontSize: 16,
  },
});