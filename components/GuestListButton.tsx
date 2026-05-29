import React, { useState, useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { UserCheck, UserPlus, Clock } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useGuestListStore } from '@/store/guest-list-store';
import { useAuthStore } from '@/store/auth-store';
import GuestListModal from './GuestListModal';

interface GuestListButtonProps {
  eventId: string;
  isBusinessOwner: boolean;
}

export default function GuestListButton({ eventId, isBusinessOwner }: GuestListButtonProps) {
  const { user: currentUser } = useAuthStore();
  const {
    fetchGuestList,
    fetchGuestListRequests,
    getGuestListForEvent,
    getGuestListRequestsForEvent,
    isUserOnGuestList,
    hasUserRequestedAccess
  } = useGuestListStore();

  const [showModal, setShowModal] = useState(false);

  const guestList = getGuestListForEvent(eventId);
  const guestListRequests = getGuestListRequestsForEvent(eventId);
  const pendingRequestsCount = guestListRequests.filter(r => r.status === 'pending').length;

  const isOnGuestList = currentUser ? isUserOnGuestList(eventId, currentUser.id) : false;
  const hasRequested = currentUser ? hasUserRequestedAccess(eventId, currentUser.id) : false;

  useEffect(() => {
    fetchGuestList(eventId);
    if (isBusinessOwner) {
      fetchGuestListRequests(eventId);
    }
  }, [eventId, isBusinessOwner]);

  const getButtonContent = () => {
    if (isBusinessOwner) {
      return {
        icon: <UserCheck size={20} color={Colors.dark.text} />,
        text: `Guest List (${guestList.length})`,
        badge: pendingRequestsCount > 0 ? pendingRequestsCount : undefined
      };
    }

    if (isOnGuestList) {
      return {
        icon: <UserCheck size={20} color={Colors.dark.primary} />,
        text: "On Guest List",
        style: styles.onGuestListButton
      };
    }

    if (hasRequested) {
      return {
        icon: <Clock size={20} color="#FFA500" />,
        text: "Request Pending",
        style: styles.pendingButton
      };
    }

    return {
      icon: <UserPlus size={20} color={Colors.dark.text} />,
      text: "Guest List"
    };
  };

  const buttonContent = getButtonContent();

  return (
    <>
      <TouchableOpacity
        style={[styles.button, buttonContent.style]}
        onPress={() => setShowModal(true)}
      >
        {buttonContent.icon}
        <Text style={[styles.buttonText, buttonContent.style && styles.specialButtonText]}>
          {buttonContent.text}
        </Text>
        {buttonContent.badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{buttonContent.badge}</Text>
          </View>
        )}
      </TouchableOpacity>

      <GuestListModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        eventId={eventId}
        isBusinessOwner={isBusinessOwner}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 10,
    position: 'relative',
  },
  onGuestListButton: {
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  pendingButton: {
    backgroundColor: 'rgba(255, 165, 0, 0.1)',
    borderWidth: 1,
    borderColor: '#FFA500',
  },
  buttonText: {
    color: Colors.dark.text,
    fontSize: 16,
    marginLeft: 8,
  },
  specialButtonText: {
    color: Colors.dark.primary,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#FF5252',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
});