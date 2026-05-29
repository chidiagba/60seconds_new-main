import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  TextInput, 
  FlatList, 
  ActivityIndicator 
} from 'react-native';
import { Image } from 'expo-image';
import { X, Search, UserPlus, UserCheck } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { User } from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

interface UserSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectUser: (user: User) => void;
  selectedUsers: User[];
}

export default function UserSearchModal({ 
  visible, 
  onClose, 
  onSelectUser,
  selectedUsers
}: UserSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { user: currentUser } = useAuthStore();
  
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResults([]);
      return;
    }
    
    setIsLoading(true);
    
    const searchUsers = async () => {
      try {
        const { data: profiles, error } = await supabase
          .from('profiles')
          .select('*')
          .or(`full_name.ilike.%${searchQuery}%,username.ilike.%${searchQuery}%,business_name.ilike.%${searchQuery}%`)
          .neq('id', currentUser?.id || '') // Exclude current user
          .limit(20);

        if (error) {
          console.error('Error searching users:', error);
          setSearchResults([]);
          setIsLoading(false);
          return;
        }

        const users: User[] = profiles?.map(profile => ({
          id: profile.id,
          name: profile.full_name,
          username: profile.username,
          email: profile.email,
          avatar: profile.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&h=150&fit=crop&crop=face',
          bio: profile.bio,
          followers: profile.followers_count || 0,
          following: profile.following_count || 0,
          isBusinessAccount: profile.user_type === 'business',
          businessName: profile.business_name,
          businessType: profile.business_type,
          createdAt: profile.created_at
        })) || [];

        // Filter out already selected users
        const filteredUsers = users.filter(user => 
          !selectedUsers.some(selectedUser => selectedUser.id === user.id)
        );
        
        setSearchResults(filteredUsers);
        setIsLoading(false);
      } catch (error) {
        console.error('Error searching users:', error);
        setSearchResults([]);
        setIsLoading(false);
      }
    };
    
    const timer = setTimeout(searchUsers, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedUsers, currentUser?.id]);
  
  const handleSelectUser = (user: User) => {
    onSelectUser(user);
    setSearchQuery('');
  };
  
  const renderUserItem = ({ item }: { item: User }) => {
    const isSelected = selectedUsers.some(user => user.id === item.id);
    
    return (
      <TouchableOpacity 
        style={styles.userItem}
        onPress={() => handleSelectUser(item)}
        disabled={isSelected}
      >
        <Image
          source={{ uri: item.avatar }}
          style={styles.userAvatar}
          contentFit="cover"
          transition={300}
        />
        
        <View style={styles.userInfo}>
          <View style={styles.userNameContainer}>
            <Text style={styles.userName}>{item.name}</Text>
            {item.isBusinessAccount && (
              <View style={styles.businessBadge}>
                <Text style={styles.businessBadgeText}>Business</Text>
              </View>
            )}
          </View>
          <Text style={styles.userUsername}>@{item.username}</Text>
          {item.bio && (
            <Text style={styles.userBio} numberOfLines={1}>
              {item.bio}
            </Text>
          )}
        </View>
        
        <TouchableOpacity 
          style={[
            styles.addButton,
            isSelected ? styles.selectedButton : null
          ]}
          onPress={() => handleSelectUser(item)}
          disabled={isSelected}
        >
          {isSelected ? (
            <UserCheck size={16} color={Colors.dark.primary} />
          ) : (
            <UserPlus size={16} color={Colors.dark.text} />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };
  
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Tag People</Text>
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={onClose}
            >
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.searchContainer}>
            <Search size={20} color={Colors.dark.subtext} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search for people..."
              placeholderTextColor={Colors.dark.subtext}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity 
                style={styles.clearButton}
                onPress={() => setSearchQuery('')}
              >
                <X size={16} color={Colors.dark.subtext} />
              </TouchableOpacity>
            )}
          </View>
          
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.dark.primary} />
            </View>
          ) : searchResults.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              renderItem={renderUserItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.usersList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    height: 48,
    color: Colors.dark.text,
    marginLeft: 8,
    fontSize: 16,
  },
  clearButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  usersList: {
    paddingBottom: 20,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  userName: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginRight: 8,
  },
  businessBadge: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  businessBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  userUsername: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 2,
  },
  userBio: {
    fontSize: 12,
    color: Colors.dark.subtext,
    fontStyle: 'italic',
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.dark.subtext,
  },
});