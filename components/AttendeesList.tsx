import AvatarImage from '@/components/AvatarImage';
import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { UserCheck, UserX, UserCog, UserCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Attendee, AttendanceStatus } from '@/types';
import { useAuthStore } from '@/store/auth-store';

interface AttendeesListProps {
  attendees: Attendee[];
  isLoading?: boolean;
  isBusinessOwner?: boolean;
  onRemoveAttendee?: (userId: string) => void;
}

export default function AttendeesList({ 
  attendees, 
  isLoading = false, 
  isBusinessOwner = false,
  onRemoveAttendee
}: AttendeesListProps) {
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  
  // Group attendees by status
  const goingAttendees = attendees.filter(a => a.status === AttendanceStatus.GOING);
  const maybeAttendees = attendees.filter(a => a.status === AttendanceStatus.MAYBE);
  const interestedAttendees = attendees.filter(a => a.status === AttendanceStatus.INTERESTED);
  
  const handleUserPress = (userId: string) => {
    router.push({
      pathname: '/profile',
      params: { userId }
    });
  };
  
  const getStatusIcon = (status: AttendanceStatus) => {
    switch (status) {
      case AttendanceStatus.GOING:
        return <UserCheck size={16} color={Colors.dark.primary} />;
      case AttendanceStatus.MAYBE:
        return <UserCog size={16} color="#FFA500" />;
      case AttendanceStatus.INTERESTED:
        return <UserCircle size={16} color="#4CAF50" />;
      default:
        return <UserCircle size={16} color={Colors.dark.subtext} />;
    }
  };
  
  const getStatusText = (status: AttendanceStatus) => {
    switch (status) {
      case AttendanceStatus.GOING:
        return 'Going';
      case AttendanceStatus.MAYBE:
        return 'Maybe';
      case AttendanceStatus.INTERESTED:
        return 'Interested';
      case AttendanceStatus.INVITED:
        return 'Invited';
      default:
        return '';
    }
  };
  
  const renderAttendeeItem = ({ item }: { item: Attendee }) => {
    const isCurrentUser = currentUser && item.userId === currentUser.id;
    
    return (
      <TouchableOpacity 
        style={[
          styles.attendeeItem,
          isCurrentUser && styles.currentUserItem
        ]}
        onPress={() => handleUserPress(item.userId)}
      >
        <AvatarImage
          uri={item.user.avatar} userId={item.user?.id}
          style={styles.avatar}
          contentFit="cover"
          transition={300}
        />
        
        <View style={styles.attendeeInfo}>
          <Text style={styles.attendeeName}>
            {item.user.displayName || item.user.name}
            {isCurrentUser && ' (You)'}
          </Text>
          <Text style={styles.attendeeUsername}>@{item.user.username}</Text>
          
          {item.notes && (
            <Text style={styles.attendeeNotes} numberOfLines={1}>
              "{item.notes}"
            </Text>
          )}
        </View>
        
        <View style={styles.statusContainer}>
          {getStatusIcon(item.status)}
          <Text style={styles.statusText}>{getStatusText(item.status)}</Text>
        </View>
        
        {isBusinessOwner && onRemoveAttendee && !isCurrentUser && (
          <TouchableOpacity 
            style={styles.removeButton}
            onPress={() => onRemoveAttendee(item.userId)}
          >
            <UserX size={16} color="#FF5252" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };
  
  const renderSectionHeader = (title: string, count: number) => {
    if (count === 0) return null;
    
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
    );
  };
  
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
        <Text style={styles.loadingText}>Loading attendees...</Text>
      </View>
    );
  }
  
  if (attendees.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <UserCircle size={40} color={Colors.dark.subtext} />
        <Text style={styles.emptyText}>No attendees yet</Text>
        <Text style={styles.emptySubtext}>Be the first to attend this event!</Text>
      </View>
    );
  }
  
  return (
    <View style={styles.container}>
      {renderSectionHeader('Going', goingAttendees.length)}
      {goingAttendees.map(attendee => renderAttendeeItem({ item: attendee }))}
      
      {renderSectionHeader('Maybe', maybeAttendees.length)}
      {maybeAttendees.map(attendee => renderAttendeeItem({ item: attendee }))}
      
      {renderSectionHeader('Interested', interestedAttendees.length)}
      {interestedAttendees.map(attendee => renderAttendeeItem({ item: attendee }))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: Colors.dark.text,
    fontSize: 14,
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.dark.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  sectionTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  sectionCount: {
    marginLeft: 8,
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: 'bold',
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  attendeeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  currentUserItem: {
    backgroundColor: 'rgba(138, 43, 226, 0.05)',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  attendeeInfo: {
    flex: 1,
  },
  attendeeName: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '500',
  },
  attendeeUsername: {
    color: Colors.dark.subtext,
    fontSize: 14,
    marginTop: 2,
  },
  attendeeNotes: {
    color: Colors.dark.text,
    fontSize: 14,
    marginTop: 4,
    fontStyle: 'italic',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginRight: 8,
  },
  statusText: {
    color: Colors.dark.text,
    fontSize: 12,
    marginLeft: 4,
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});