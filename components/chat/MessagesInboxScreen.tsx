import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Plus, Users } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { fetchMyGroupChats, getGroupInitials, getGroupLastLine, GroupChatListItem } from '@/lib/group-chat-service';
import { useMessageUnreadStore } from '@/store/message-unread-store';

type ProfileRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

type ChatRow = {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string | null;
};

type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string | null;
  created_at: string;
};

type RpcRow = {
  chat_id: string;
  other_user_id: string;
  last_message_text: string | null;
  last_activity_at: string | null;
};

type DirectChatItem = {
  kind: 'direct';
  id: string;
  chatId: string;
  otherUserId: string;
  otherProfile: ProfileRow | null;
  lastMessageText: string | null;
  lastActivityAt: string;
  unreadCount: number;
};

type GroupChatItem = {
  kind: 'group';
  id: string;
  group: GroupChatListItem;
};

type SectionItem = {
  kind: 'section';
  id: string;
  title: string;
};

type InboxItem = DirectChatItem | GroupChatItem | SectionItem;

const AVATAR_PLACEHOLDER = require('../../assets/images/avatar-placeholder.png');

function normalizeGroupError(error: any) {
  const message = error?.message || String(error) || 'Unknown error';
  return message;
}

function logInboxError(source: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  console.warn(`[MessagesInboxScreen] ${source}: ${message}`);
}

export default function MessagesInboxScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    createdGroupId?: string;
    createdGroupName?: string;
    createdGroupMemberCount?: string;
    createdAt?: string;
  }>();
  const clearUnread = useMessageUnreadStore((state) => state.clearUnread);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [directItems, setDirectItems] = useState<DirectChatItem[]>([]);
  const [groupItems, setGroupItems] = useState<GroupChatListItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      clearUnread();
    }, [clearUnread])
  );

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const sortByLastActivity = useCallback(
    (list: DirectChatItem[]) =>
      [...list].sort(
        (a, b) =>
          new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
      ),
    []
  );

  const getOtherUserId = (chat: ChatRow, myId: string) =>
    chat.user1_id === myId ? chat.user2_id : chat.user1_id;

  const openDirectChat = useCallback(
    (item: DirectChatItem) => {
      router.push({
        pathname: '/chat/[chatId]',
        params: {
          chatId: item.chatId,
          otherUserId: item.otherUserId,
          full_name: item.otherProfile?.full_name ?? '',
          username: item.otherProfile?.username ?? '',
          avatar_url: item.otherProfile?.avatar_url ?? '',
        },
      });
    },
    [router]
  );

  const openGroupChat = useCallback(
    (group: GroupChatListItem) => {
      router.push({
        pathname: '/chat/[chatId]',
        params: {
          chatId: group.id,
          type: 'group',
        },
      });
    },
    [router]
  );

  const loadChatsFallback = useCallback(async (myId: string) => {
    const { data: chats, error: chatsErr } = await supabase
      .from('chats')
      .select('id,user1_id,user2_id,created_at')
      .or(`user1_id.eq.${myId},user2_id.eq.${myId}`);

    if (chatsErr) throw chatsErr;

    const chatRows = (chats ?? []) as ChatRow[];
    if (chatRows.length === 0) return [];

    const chatIds = chatRows.map((chat) => chat.id);
    const { data: msgs, error: msgErr } = await supabase
      .from('messages')
      .select('id,chat_id,sender_id,text,created_at')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false });

    if (msgErr) throw msgErr;

    const lastMessageByChat = new Map<string, MessageRow>();
    (msgs ?? []).forEach((message) => {
      const row = message as MessageRow;
      if (!lastMessageByChat.has(row.chat_id)) {
        lastMessageByChat.set(row.chat_id, row);
      }
    });

    const otherIds = Array.from(new Set(chatRows.map((chat) => getOtherUserId(chat, myId))));
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id,full_name,username,avatar_url')
      .in('id', otherIds);

    if (profErr) throw profErr;

    const profileMap = new Map<string, ProfileRow>();
    (profiles ?? []).forEach((profile) => {
      const row = profile as ProfileRow;
      profileMap.set(row.id, row);
    });

    return chatRows.map((chat) => {
      const otherUserId = getOtherUserId(chat, myId);
      const lastMessage = lastMessageByChat.get(chat.id) ?? null;
      const lastActivityAt = lastMessage?.created_at ?? chat.created_at ?? new Date().toISOString();

      return {
        kind: 'direct' as const,
        id: `direct-${chat.id}`,
        chatId: chat.id,
        otherUserId,
        otherProfile: profileMap.get(otherUserId) ?? null,
        lastMessageText: lastMessage?.text ?? null,
        lastActivityAt,
        unreadCount: 0,
      };
    });
  }, []);

  const loadDirectChats = useCallback(async (myId: string) => {
    const { data: rows, error: rpcErr } = await supabase.rpc('get_my_chat_list');

    if (!rpcErr && rows && Array.isArray(rows) && rows.length > 0) {
      const rpcRows = rows as RpcRow[];
      const otherIds = Array.from(new Set(rpcRows.map((row) => row.other_user_id)));
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id,full_name,username,avatar_url')
        .in('id', otherIds);

      if (profErr) throw profErr;

      const profileMap = new Map<string, ProfileRow>();
      (profiles ?? []).forEach((profile) => {
        const row = profile as ProfileRow;
        profileMap.set(row.id, row);
      });

      return sortByLastActivity(
        rpcRows.map((row) => ({
          kind: 'direct' as const,
          id: `direct-${row.chat_id}`,
          chatId: row.chat_id,
          otherUserId: row.other_user_id,
          otherProfile: profileMap.get(row.other_user_id) ?? null,
          lastMessageText: row.last_message_text ?? null,
          lastActivityAt: row.last_activity_at ?? new Date().toISOString(),
          unreadCount: 0,
        }))
      );
    }

    return sortByLastActivity(await loadChatsFallback(myId));
  }, [loadChatsFallback, sortByLastActivity]);

  const loadChats = useCallback(async () => {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      setDirectItems([]);
      setGroupItems([]);
      logInboxError('auth.getUser', authErr);
      setIsLoading(false);
      return;
    }

    const myId = authData.user?.id ?? null;
    setCurrentUserId(myId);

    if (!myId) {
      setDirectItems([]);
      setGroupItems([]);
      setIsLoading(false);
      return;
    }

    const [directResult, groupResult] = await Promise.allSettled([
      loadDirectChats(myId),
      fetchMyGroupChats(myId),
    ]);

    if (directResult.status === 'fulfilled') {
      setDirectItems(directResult.value);
    } else {
      setDirectItems([]);
      logInboxError('loadDirectChats', directResult.reason);
    }

    if (groupResult.status === 'fulfilled') {
      setGroupItems(groupResult.value);
    } else {
      setGroupItems([]);
      logInboxError('fetchMyGroupChats', groupResult.reason);
    }

    if (groupResult.status === 'rejected') {
      normalizeGroupError(groupResult.reason);
    }

    setIsLoading(false);
  }, [loadDirectChats]);

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      const { data } = await supabase.auth.getUser();
      const myId = data.user?.id;
      if (!mounted || !myId) {
        return undefined;
      }

      const channel = supabase.channel(`messages_screen_${myId}`);
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async () => {
        await loadChats();
      });
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chats' }, async () => {
        await loadChats();
      });
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'group_chats' }, async () => {
        await loadChats();
      });
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'group_chat_members' }, async () => {
        await loadChats();
      });
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'group_chat_messages' }, async () => {
        await loadChats();
      });
      channel.subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    const cleanupPromise = setup();
    return () => {
      mounted = false;
      cleanupPromise.then((cleanup) => cleanup && cleanup());
    };
  }, [loadChats]);

  useEffect(() => {
    setIsLoading(true);
    loadChats();
  }, [loadChats]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadChats();
    setIsRefreshing(false);
  }, [loadChats]);

  const inboxItems = useMemo(() => {
    const nextItems: InboxItem[] = [];
    const createdGroupId = typeof params.createdGroupId === 'string' ? params.createdGroupId : '';
    const createdGroupName = typeof params.createdGroupName === 'string' ? params.createdGroupName : 'New group';
    const createdMemberCount = Number(params.createdGroupMemberCount || 0);
    const createdAt = typeof params.createdAt === 'string' && params.createdAt ? params.createdAt : new Date().toISOString();

    const hasOptimisticCreatedGroup =
      createdGroupId.length > 0 && !groupItems.some((group) => group.id === createdGroupId);

    const optimisticGroup: GroupChatListItem | null = hasOptimisticCreatedGroup
      ? {
          id: createdGroupId,
          name: createdGroupName,
          avatarColor: '#6366f1',
          createdBy: currentUserId || '',
          createdAt,
          updatedAt: createdAt,
          members: [],
          memberCount: createdMemberCount > 0 ? createdMemberCount : 1,
          lastMessage: null,
          unreadCount: 0,
          role: 'owner',
        }
      : null;

    if (groupItems.length > 0 || optimisticGroup) {
      nextItems.push({ kind: 'section', id: 'section-groups', title: 'Groups' });
      if (optimisticGroup) {
        nextItems.push({ kind: 'group', id: `group-${optimisticGroup.id}`, group: optimisticGroup });
      }
      groupItems.forEach((group) => {
        nextItems.push({ kind: 'group', id: `group-${group.id}`, group });
      });
    }

    if (directItems.length > 0) {
      nextItems.push({ kind: 'section', id: 'section-direct', title: 'Direct messages' });
      nextItems.push(...directItems);
    }

    return nextItems;
  }, [currentUserId, directItems, groupItems, params.createdAt, params.createdGroupId, params.createdGroupMemberCount, params.createdGroupName]);

  const renderInboxItem = useCallback(
    ({ item }: { item: InboxItem }) => {
      if (item.kind === 'section') {
        return <Text style={styles.sectionTitle}>{item.title}</Text>;
      }

      if (item.kind === 'group') {
        return (
          <TouchableOpacity style={styles.chatItem} onPress={() => openGroupChat(item.group)} activeOpacity={0.85}>
            <View style={[styles.groupAvatar, { backgroundColor: item.group.avatarColor }]}>
              <Text style={styles.groupInitials}>{getGroupInitials(item.group.name)}</Text>
            </View>

            <View style={styles.chatInfo}>
              <View style={styles.chatHeader}>
                <Text style={styles.username} numberOfLines={1}>
                  {item.group.name}
                </Text>
                <Text style={styles.timestamp}>{formatTimeAgo(item.group.updatedAt)}</Text>
              </View>

              <View style={styles.groupMetaRow}>
                <Users size={14} color={Colors.dark.subtext} />
                <Text style={styles.groupMetaText}>{item.group.memberCount} members</Text>
                {item.group.unreadCount > 0 ? <Text style={styles.groupUnread}>• {item.group.unreadCount} new</Text> : null}
              </View>

              <Text style={styles.lastMessage} numberOfLines={1}>
                {getGroupLastLine(item.group.lastMessage, currentUserId)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }

      const displayName = item.otherProfile?.full_name || item.otherProfile?.username || 'Unknown User';
      const avatarSource =
        item.otherProfile?.avatar_url && item.otherProfile.avatar_url.trim().length > 0
          ? { uri: item.otherProfile.avatar_url }
          : AVATAR_PLACEHOLDER;

      return (
        <TouchableOpacity style={styles.chatItem} onPress={() => openDirectChat(item)} activeOpacity={0.85}>
          <View style={styles.avatarContainer}>
            <Image source={avatarSource} style={styles.avatar} contentFit="cover" transition={200} />
          </View>

          <View style={styles.chatInfo}>
            <View style={styles.chatHeader}>
              <Text style={styles.username} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.timestamp}>{formatTimeAgo(item.lastActivityAt)}</Text>
            </View>

            <Text style={styles.lastMessage} numberOfLines={1}>
              {item.lastMessageText?.trim() || 'Say hi'}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    [currentUserId, openDirectChat, openGroupChat]
  );

  const listEmpty = useMemo(() => {
    if (isLoading) {
      return null;
    }

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No messages yet</Text>
        <Text style={styles.emptyText}>
          Start a new chat or create a group when you're ready.
        </Text>
      </View>
    );
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
        <Text style={styles.loadingText}>Loading conversations...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Messages</Text>
          <Text style={styles.subtitle}>Direct chats and synced groups</Text>
        </View>

        <TouchableOpacity style={styles.createButton} onPress={() => router.push('/chat/create-group')} activeOpacity={0.85}>
          <Plus size={18} color={Colors.dark.text} />
          <Text style={styles.createButtonText}>New group</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={inboxItems}
        renderItem={renderInboxItem}
        keyExtractor={(item) => item.id}
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={listEmpty}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={Colors.dark.text} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    backgroundColor: Colors.dark.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: Colors.dark.text },
  subtitle: { marginTop: 4, fontSize: 13, color: Colors.dark.subtext },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  createButtonText: { color: Colors.dark.text, fontWeight: '600' },
  listContent: { flexGrow: 1, paddingBottom: 24 },
  sectionTitle: {
    color: Colors.dark.subtext,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
  },
  chatItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    alignItems: 'center',
  },
  avatarContainer: { marginRight: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  groupAvatar: {
    width: 56,
    height: 56,
    borderRadius: 20,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupInitials: { color: Colors.dark.text, fontSize: 18, fontWeight: '800' },
  chatInfo: { flex: 1, justifyContent: 'center' },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  username: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  timestamp: { fontSize: 12, color: Colors.dark.subtext },
  groupMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  groupMetaText: { fontSize: 12, color: Colors.dark.subtext },
  groupUnread: { fontSize: 12, color: Colors.dark.primary, fontWeight: '700' },
  lastMessage: { fontSize: 14, color: Colors.dark.subtext },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  emptyTitle: { color: Colors.dark.text, fontSize: 20, fontWeight: '700', marginBottom: 10 },
  emptyText: { color: Colors.dark.subtext, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
    padding: 20,
  },
  loadingText: { marginTop: 12, color: Colors.dark.text },
});
