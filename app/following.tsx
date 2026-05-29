import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, UserCheck } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuthStore } from '@/store/auth-store';
import { useAuth } from '@/lib/auth';
import { followService, FollowProfile } from '@/lib/database';

export default function FollowingScreen() {
  const { userId: routeUserId } = useLocalSearchParams<{ userId?: string }>();
  const router = useRouter();
  const { user: authUser } = useAuth();
  const { unfollowUser, refreshFollowedUsers, followVersion } = useAuthStore();

  const userId = useMemo(() => (routeUserId || authUser?.id || '').toString(), [routeUserId, authUser?.id]);
  const isOwnFollowing = !!authUser?.id && userId === authUser.id;

  const [followedUsersData, setFollowedUsersData] = useState<FollowProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFollowing = async () => {
    if (!userId) {
      setFollowedUsersData([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await followService.getFollowing(userId);
      setFollowedUsersData(data);
      await refreshFollowedUsers();
    } catch (error) {
      console.error('Error loading following list:', error);
      setFollowedUsersData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFollowing();
  }, [userId, followVersion]);

  const handleUnfollowPress = async (followedUserId: string) => {
    await unfollowUser(followedUserId);
    await loadFollowing();
  };

  const handleUserPress = (followedUserId: string) => {
    if (followedUserId === authUser?.id) {
      router.push('/profile');
      return;
    }
    router.push({ pathname: '/ProfileUserScreen' as any, params: { userId: followedUserId } });
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/profile');
  };

  const renderFollowedUser = ({ item }: { item: FollowProfile }) => {
    return (
      <TouchableOpacity 
        style={styles.followedUserItem}
        onPress={() => handleUserPress(item.id)}
      >
        <Image
          source={{ uri: item.avatar_url || 'https://via.placeholder.com/150' }}
          style={styles.avatar}
          contentFit="cover"
          transition={300}
        />
        
        <View style={styles.followedUserInfo}>
          <Text style={styles.displayName}>{item.full_name || 'User'}</Text>
          <Text style={styles.username}>@{item.username || 'user'}</Text>
        </View>
        
        {isOwnFollowing && (
          <TouchableOpacity 
            style={styles.unfollowButton}
            onPress={() => handleUnfollowPress(item.id)}
          >
            <UserCheck size={14} color={Colors.dark.primary} />
            <Text style={styles.unfollowButtonText}>Following</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isOwnFollowing ? 'Following' : 'Following'}
        </Text>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator color={Colors.dark.primary} />
        </View>
      ) : (
        <FlatList
          data={followedUsersData}
          renderItem={renderFollowedUser}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {isOwnFollowing ? "You're not following anyone yet" : "Not following anyone yet"}
              </Text>
            </View>
          }
        />
      )}
    </View>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  headerRight: {
    width: 40,
  },
  listContent: {
    padding: 16,
  },
  followedUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  followedUserInfo: {
    flex: 1,
    marginLeft: 16,
  },
  displayName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 2,
  },
  username: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  unfollowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  unfollowButtonText: {
    color: Colors.dark.primary,
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.dark.subtext,
  },
});