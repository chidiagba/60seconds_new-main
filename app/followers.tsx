import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, UserPlus, UserCheck } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuthStore } from '@/store/auth-store';
import { useAuth } from '@/lib/auth';
import { followService, FollowProfile } from '@/lib/database';

export default function FollowersScreen() {
  const { userId: routeUserId } = useLocalSearchParams<{ userId?: string }>();
  const router = useRouter();
  const { user: authUser } = useAuth();
  const { isFollowing, followUser, unfollowUser, refreshFollowedUsers, followVersion } = useAuthStore();

  const userId = useMemo(() => (routeUserId || authUser?.id || '').toString(), [routeUserId, authUser?.id]);
  const isOwnFollowers = !!authUser?.id && userId === authUser.id;

  const [followers, setFollowers] = useState<FollowProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFollowers = async () => {
    if (!userId) {
      setFollowers([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await followService.getFollowers(userId);
      setFollowers(data);
      await refreshFollowedUsers();
    } catch (error) {
      console.error('Error loading followers:', error);
      setFollowers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFollowers();
  }, [userId, followVersion]);

  const handleFollowPress = async (followerId: string) => {
    if (isFollowing(followerId)) {
      await unfollowUser(followerId);
    } else {
      await followUser(followerId);
    }
    await refreshFollowedUsers();
  };

  const handleUserPress = (followerId: string) => {
    if (followerId === authUser?.id) {
      router.push('/profile');
      return;
    }
    router.push({ pathname: '/ProfileUserScreen' as any, params: { userId: followerId } });
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/profile');
  };

  const renderFollower = ({ item }: { item: FollowProfile }) => {
    const isFollowingUser = isFollowing(item.id);
    const isCurrentUser = item.id === authUser?.id;

    return (
      <TouchableOpacity style={styles.followerItem} onPress={() => handleUserPress(item.id)}>
        <Image
          source={{ uri: item.avatar_url || 'https://via.placeholder.com/150' }}
          style={styles.avatar}
          contentFit="cover"
          transition={300}
        />

        <View style={styles.followerInfo}>
          <Text style={styles.displayName}>{item.full_name || 'User'}</Text>
          <Text style={styles.username}>@{item.username || 'user'}</Text>
        </View>

        {!isCurrentUser && (
          <TouchableOpacity
            style={[styles.followButton, isFollowingUser ? styles.followingButton : null]}
            onPress={() => handleFollowPress(item.id)}
          >
            {isFollowingUser ? (
              <>
                <UserCheck size={14} color={Colors.dark.primary} />
                <Text style={[styles.followButtonText, styles.followingButtonText]}>Following</Text>
              </>
            ) : (
              <>
                <UserPlus size={14} color={Colors.dark.text} />
                <Text style={styles.followButtonText}>Follow</Text>
              </>
            )}
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
        <Text style={styles.headerTitle}>{isOwnFollowers ? 'Your Followers' : 'Followers'}</Text>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator color={Colors.dark.primary} />
        </View>
      ) : (
        <FlatList
          data={followers}
          renderItem={renderFollower}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No followers yet</Text>
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
  followerItem: {
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
  followerInfo: {
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
  followButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  followingButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  followButtonText: {
    color: Colors.dark.text,
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '500',
  },
  followingButtonText: {
    color: Colors.dark.primary,
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