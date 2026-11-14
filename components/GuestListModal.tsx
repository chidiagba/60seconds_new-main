import AvatarImage from '@/components/AvatarImage';
import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  ScrollView, 
  TextInput,
  Alert,
  ActivityIndicator
} from 'react-native';
import { Image } from 'expo-image';
import { X, Search, UserPlus, UserCheck, UserX, Clock, CheckCircle, XCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useGuestListStore } from '@/store/guest-list-store';
import { useAuthStore } from '@/store/auth-store';
import { GuestListEntry, GuestListRequest, GuestListRequestStatus, User } from '@/types';

interface GuestListModalProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  isBusinessOwner: boolean;
}

export default function GuestListModal({ 
  visible, 
  onClose, 
  eventId, 
  isBusinessOwner 
}: GuestListModalProps) {
  const { user: currentUser } = useAuthStore();
  const {
    fetchGuestList,
    fetchGuestListRequests,
    addUserToGuestList,
    removeUserFromGuestList,
    requestGuestListAccess,
    approveGuestListRequest,
    rejectGuestListRequest,
    searchUsers,
    getGuestListForEvent,
    getGuestListRequestsForEvent,
    isUserOnGuestList,
    hasUserRequestedAccess,
    isLoading
  } = useGuestListStore();

  const [activeTab, setActiveTab] = useState<'guestList' | 'requests' | 'search'>('guestList');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [requestMessage, setRequestMessage] = useState('');
  const [showRequestForm, setShowRequestForm] = useState(false);

  const guestList = getGuestListForEvent(eventId);
  const guestListRequests = getGuestListRequestsForEvent(eventId);
  const pendingRequests = guestListRequests.filter(r => r.status === GuestListRequestStatus.PENDING);

  useEffect(() => {
    if (visible) {
      fetchGuestList(eventId);
      if (isBusinessOwner) {
        fetchGuestListRequests(eventId);
      }
    }
  }, [visible, eventId, isBusinessOwner]);

  useEffect(() => {
    const performSearch = async () => {
      if (searchQuery.trim()) {
        const results = await searchUsers(searchQuery);
        // Filter out users already on guest list
        const filteredResults = results.filter(user => 
          !isUserOnGuestList(eventId, user.id) && 
          user.id !== currentUser?.id
        );
        setSearchResults(filteredResults);
      } else {
        setSearchResults([]);
      }
    };

    const debounceTimer = setTimeout(performSearch, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, eventId]);

  const handleAddToGuestList = async (userId: string) => {
    try {
      await addUserToGuestList(eventId, userId);
      Alert.alert('Success', 'User added to guest list');
      setSearchQuery('');
      setSearchResults([]);
    } catch (error) {
      Alert.alert('Error', 'Failed to add user to guest list');
    }
  };

  const handleRemoveFromGuestList = async (userId: string) => {
    Alert.alert(
      'Remove from Guest List',
      'Are you sure you want to remove this user from the guest list?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeUserFromGuestList(eventId, userId);
              Alert.alert('Success', 'User removed from guest list');
            } catch (error) {
              Alert.alert('Error', 'Failed to remove user from guest list');
            }
          }
        }
      ]
    );
  };

  const handleRequestAccess = async () => {
    if (!currentUser) return;
    
    try {
      await requestGuestListAccess(eventId, requestMessage);
      Alert.alert('Success', 'Your request has been sent to the event organizer');
      setRequestMessage('');
      setShowRequestForm(false);
      onClose();
    } catch (error) {
      Alert.alert('Error', 'Failed to send request');
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    try {
      await approveGuestListRequest(eventId, requestId);
      Alert.alert('Success', 'Request approved and user added to guest list');
    } catch (error) {
      Alert.alert('Error', 'Failed to approve request');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await rejectGuestListRequest(eventId, requestId);
      Alert.alert('Success', 'Request rejected');
    } catch (error) {
      Alert.alert('Error', 'Failed to reject request');
    }
  };

  const renderGuestListItem = (entry: GuestListEntry) => (
    <View key={entry.id} style={styles.listItem}>
      <AvatarImage
        uri={entry.user.avatar} userId={entry.user?.id}
        style={styles.avatar}
        contentFit="cover"
        transition={300}
      />
      
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{entry.user.displayName || entry.user.name}</Text>
        <Text style={styles.userUsername}>@{entry.user.username}</Text>
        {entry.notes && (
          <Text style={styles.notes} numberOfLines={1}>"{entry.notes}"</Text>
        )}
      </View>
      
      <View style={styles.statusContainer}>
        <UserCheck size={16} color={Colors.dark.primary} />
        <Text style={styles.statusText}>Confirmed</Text>
      </View>
      
      {isBusinessOwner && (
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => handleRemoveFromGuestList(entry.userId)}
        >
          <UserX size={16} color="#FF5252" />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderRequestItem = (request: GuestListRequest) => (
    <View key={request.id} style={styles.listItem}>
      <AvatarImage
        uri={request.user.avatar} userId={request.user?.id}
        style={styles.avatar}
        contentFit="cover"
        transition={300}
      />
      
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{request.user.displayName || request.user.name}</Text>
        <Text style={styles.userUsername}>@{request.user.username}</Text>
        {request.message && (
          <Text style={styles.requestMessage} numberOfLines={2}>"{request.message}"</Text>
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
  );

  const renderSearchResultItem = (user: User) => (
    <View key={user.id} style={styles.listItem}>
      <AvatarImage
        uri={user.avatar} userId={user?.id}
        style={styles.avatar}
        contentFit="cover"
        transition={300}
      />
      
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{user.displayName || user.name}</Text>
        <Text style={styles.userUsername}>@{user.username}</Text>
        {user.bio && (
          <Text style={styles.userBio} numberOfLines={1}>{user.bio}</Text>
        )}
      </View>
      
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => handleAddToGuestList(user.id)}
      >
        <UserPlus size={20} color={Colors.dark.primary} />
      </TouchableOpacity>
    </View>
  );

  const canRequestAccess = currentUser && 
    !isBusinessOwner && 
    !isUserOnGuestList(eventId, currentUser.id) && 
    !hasUserRequestedAccess(eventId, currentUser.id);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Guest List</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <X size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'guestList' && styles.activeTab]}
            onPress={() => setActiveTab('guestList')}
          >
            <Text style={[styles.tabText, activeTab === 'guestList' && styles.activeTabText]}>
              Guest List ({guestList.length})
            </Text>
          </TouchableOpacity>
          
          {isBusinessOwner && (
            <>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'requests' && styles.activeTab]}
                onPress={() => setActiveTab('requests')}
              >
                <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>
                  Requests ({pendingRequests.length})
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.tab, activeTab === 'search' && styles.activeTab]}
                onPress={() => setActiveTab('search')}
              >
                <Text style={[styles.tabText, activeTab === 'search' && styles.activeTabText]}>
                  Add Users
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {activeTab === 'search' && isBusinessOwner && (
          <View style={styles.searchContainer}>
            <View style={styles.searchInputContainer}>
              <Search size={20} color={Colors.dark.subtext} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search users to add..."
                placeholderTextColor={Colors.dark.subtext}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>
        )}

        <ScrollView style={styles.content}>
          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.dark.primary} />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          )}

          {activeTab === 'guestList' && (
            <>
              {guestList.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <UserCheck size={40} color={Colors.dark.subtext} />
                  <Text style={styles.emptyText}>No guests yet</Text>
                  <Text style={styles.emptySubtext}>
                    {isBusinessOwner 
                      ? "Add users to your guest list or wait for requests"
                      : "This event doesn't have any confirmed guests yet"
                    }
                  </Text>
                </View>
              ) : (
                guestList.map(renderGuestListItem)
              )}
            </>
          )}

          {activeTab === 'requests' && isBusinessOwner && (
            <>
              {pendingRequests.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Clock size={40} color={Colors.dark.subtext} />
                  <Text style={styles.emptyText}>No pending requests</Text>
                  <Text style={styles.emptySubtext}>
                    Users can request to be added to your guest list
                  </Text>
                </View>
              ) : (
                pendingRequests.map(renderRequestItem)
              )}
            </>
          )}

          {activeTab === 'search' && isBusinessOwner && (
            <>
              {searchResults.length === 0 && searchQuery.trim() ? (
                <View style={styles.emptyContainer}>
                  <Search size={40} color={Colors.dark.subtext} />
                  <Text style={styles.emptyText}>No users found</Text>
                  <Text style={styles.emptySubtext}>
                    Try searching with a different name or username
                  </Text>
                </View>
              ) : (
                searchResults.map(renderSearchResultItem)
              )}
            </>
          )}
        </ScrollView>

        {canRequestAccess && !showRequestForm && (
          <View style={styles.bottomAction}>
            <TouchableOpacity
              style={styles.requestButton}
              onPress={() => setShowRequestForm(true)}
            >
              <UserPlus size={20} color={Colors.dark.text} />
              <Text style={styles.requestButtonText}>Request to Join Guest List</Text>
            </TouchableOpacity>
          </View>
        )}

        {showRequestForm && (
          <View style={styles.requestForm}>
            <Text style={styles.requestFormTitle}>Request Guest List Access</Text>
            <TextInput
              style={styles.messageInput}
              placeholder="Add a message (optional)..."
              placeholderTextColor={Colors.dark.subtext}
              value={requestMessage}
              onChangeText={setRequestMessage}
              multiline
              numberOfLines={3}
            />
            <View style={styles.requestFormActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowRequestForm(false);
                  setRequestMessage('');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sendRequestButton}
                onPress={handleRequestAccess}
              >
                <Text style={styles.sendRequestButtonText}>Send Request</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
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
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.card,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.dark.primary,
  },
  tabText: {
    color: Colors.dark.subtext,
    fontSize: 14,
    fontWeight: '500',
  },
  activeTabText: {
    color: Colors.dark.primary,
  },
  searchContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    color: Colors.dark.text,
    fontSize: 16,
  },
  content: {
    flex: 1,
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
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 16,
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptySubtext: {
    marginTop: 8,
    color: Colors.dark.subtext,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  userInfo: {
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
  userBio: {
    color: Colors.dark.subtext,
    fontSize: 12,
    marginTop: 4,
  },
  notes: {
    color: Colors.dark.text,
    fontSize: 14,
    marginTop: 4,
    fontStyle: 'italic',
  },
  requestMessage: {
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
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginRight: 8,
  },
  statusText: {
    color: Colors.dark.primary,
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
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
  bottomAction: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  requestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  requestButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  requestForm: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
  },
  requestFormTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  messageInput: {
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  requestFormActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.dark.background,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '500',
  },
  sendRequestButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
  },
  sendRequestButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '500',
  },
});