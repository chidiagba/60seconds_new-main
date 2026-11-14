import AvatarImage from '@/components/AvatarImage';
import { logger } from '@/lib/logger';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Bell, UserPlus, CheckCircle, XCircle, X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useGuestListStore } from '@/store/guest-list-store';
import { useAuthStore } from '@/store/auth-store';
import { useVideoStore } from '@/store/video-store';
import { GuestListRequestStatus } from '@/types';

interface GuestListNotificationsProps {
  visible: boolean;
  onClose: () => void;
}

export default function GuestListNotifications({ visible, onClose }: GuestListNotificationsProps) {
  const { user } = useAuthStore();
  const { videos } = useVideoStore();
  const {
    fetchGuestListRequests,
    approveGuestListRequest,
    rejectGuestListRequest,
    getGuestListRequestsForEvent
  } = useGuestListStore();

  const [allRequests, setAllRequests] = useState<any[]>([]);

  // Get user's business events
  const businessEvents = videos.filter(video => 
    user && video.userId === user.id && user.isBusinessAccount
  );

  useEffect(() => {
    if (visible && user?.isBusinessAccount) {
      // Fetch requests for all business events
      const fetchAllRequests = async () => {
        const requests: any[] = [];
        
        for (const event of businessEvents) {
          await fetchGuestListRequests(event.id);
          const eventRequests = getGuestListRequestsForEvent(event.id)
            .filter(r => r.status === GuestListRequestStatus.PENDING)
            .map(r => ({ ...r, eventName: event.eventName, eventThumbnail: event.thumbnail }));
          
          requests.push(...eventRequests);
        }
        
        // Sort by most recent
        requests.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        setAllRequests(requests);
      };

      fetchAllRequests();
    }
  }, [visible, businessEvents.length]);

  const handleApprove = async (eventId: string, requestId: string) => {
    try {
      await approveGuestListRequest(eventId, requestId);
      // Remove from local state
      setAllRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (error) {
      logger.error('Failed to approve request:', error);
    }
  };

  const handleReject = async (eventId: string, requestId: string) => {
    try {
      await rejectGuestListRequest(eventId, requestId);
      // Remove from local state
      setAllRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (error) {
      logger.error('Failed to reject request:', error);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  };

  if (!visible || !user?.isBusinessAccount) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Bell size={20} color={Colors.dark.primary} />
            <Text style={styles.title}>Guest List Requests</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <X size={20} color={Colors.dark.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {allRequests.length === 0 ? (
            <View style={styles.emptyContainer}>
              <UserPlus size={40} color={Colors.dark.subtext} />
              <Text style={styles.emptyText}>No pending requests</Text>
              <Text style={styles.emptySubtext}>
                Guest list requests will appear here
              </Text>
            </View>
          ) : (
            allRequests.map(request => (
              <View key={request.id} style={styles.requestItem}>
                <AvatarImage
                  uri={request.user.avatar} userId={request.user?.id}
                  style={styles.userAvatar}
                  contentFit="cover"
                  transition={300}
                />
                
                <View style={styles.requestContent}>
                  <View style={styles.requestHeader}>
                    <Text style={styles.userName}>
                      {request.user.displayName || request.user.name}
                    </Text>
                    <Text style={styles.timeAgo}>
                      {formatTimeAgo(request.requestedAt)}
                    </Text>
                  </View>
                  
                  <Text style={styles.requestText}>
                    wants to join the guest list for{' '}
                    <Text style={styles.eventName}>{request.eventName}</Text>
                  </Text>
                  
                  {request.message && (
                    <Text style={styles.requestMessage} numberOfLines={2}>
                      "{request.message}"
                    </Text>
                  )}
                  
                  <View style={styles.requestActions}>
                    <TouchableOpacity
                      style={styles.approveButton}
                      onPress={() => handleApprove(request.eventId, request.id)}
                    >
                      <CheckCircle size={16} color="#4CAF50" />
                      <Text style={styles.approveButtonText}>Approve</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.rejectButton}
                      onPress={() => handleReject(request.eventId, request.id)}
                    >
                      <XCircle size={16} color="#FF5252" />
                      <Text style={styles.rejectButtonText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                
                <Image
                  source={{ uri: request.eventThumbnail }}
                  style={styles.eventThumbnail}
                  contentFit="cover"
                  transition={300}
                />
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
  },
  container: {
    position: 'absolute',
    top: 100,
    right: 16,
    width: 350,
    maxHeight: 500,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    maxHeight: 400,
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
  },
  requestItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  requestContent: {
    flex: 1,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  userName: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '600',
  },
  timeAgo: {
    color: Colors.dark.subtext,
    fontSize: 12,
  },
  requestText: {
    color: Colors.dark.text,
    fontSize: 14,
    marginBottom: 8,
  },
  eventName: {
    color: Colors.dark.primary,
    fontWeight: '500',
  },
  requestMessage: {
    color: Colors.dark.subtext,
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  approveButtonText: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  rejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  rejectButtonText: {
    color: '#FF5252',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  eventThumbnail: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginLeft: 8,
  },
});