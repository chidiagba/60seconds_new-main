import { setCurrentPushToken } from '@/utils/push-device';
import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useMessageUnreadStore } from '@/store/message-unread-store';

let NotificationsModule: any = null;
try {
  NotificationsModule = require('expo-notifications');
} catch {
  NotificationsModule = null;
}

if (NotificationsModule?.setNotificationHandler) {
  NotificationsModule.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function getProfileDisplayName(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name,username')
    .eq('id', userId)
    .maybeSingle<{ full_name: string | null; username: string | null }>();

  return data?.full_name || (data?.username ? `@${data.username}` : 'New message');
}

async function isDirectMessageForUser(chatId: string, userId: string) {
  const { data } = await supabase
    .from('chats')
    .select('id,user1_id,user2_id')
    .eq('id', chatId)
    .maybeSingle<{ id: string; user1_id: string; user2_id: string }>();

  if (!data) {
    return { isForUser: false, otherUserId: '' };
  }

  if (data.user1_id === userId) {
    return { isForUser: true, otherUserId: data.user2_id };
  }

  if (data.user2_id === userId) {
    return { isForUser: true, otherUserId: data.user1_id };
  }

  return { isForUser: false, otherUserId: '' };
}

async function isGroupMessageForUser(groupId: string, userId: string) {
  const { data } = await supabase
    .from('group_chat_members')
    .select('id')
    .eq('group_chat_id', groupId)
    .eq('user_id', userId)
    .maybeSingle<{ id: string }>();

  return !!data;
}

export default function MessageNotificationBridge() {
  const { user } = useAuth();
  const registeredToken = useRef<string | null>(null);
  const handledResponse = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id || Platform.OS === 'web' || !NotificationsModule) return;
    let cancelled = false;
    let token: string | undefined;
    (async () => {
      if (Platform.OS === 'android') await NotificationsModule.setNotificationChannelAsync('default', { name: 'Messages and followers', importance: 4 });
      const permission = await NotificationsModule.requestPermissionsAsync();
      if (permission.status !== 'granted' || cancelled) return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      if (!projectId) return;
      token = (await NotificationsModule.getExpoPushTokenAsync({ projectId })).data;
      if (cancelled || !token) return;
      const { error } = await supabase.from('push_devices').upsert({ token, user_id: user.id, updated_at: new Date().toISOString() });
      if (error) throw error;
      registeredToken.current = token;
      await setCurrentPushToken(token);
    })().catch(error => console.warn('Push registration failed:', error));
    return () => {
      cancelled = true;
      registeredToken.current = null;
      if (token) void supabase.from('push_devices').delete().eq('token', token).then(() => {});
    };
  }, [user?.id]);
  const router = useRouter();
  const incrementUnread = useMessageUnreadStore((state) => state.incrementUnread);

  useEffect(() => {
    if (!user?.id || !NotificationsModule || Platform.OS === 'web') {
      return;
    }

    let active = true;
    const handleNotificationRoute = (data: any) => {
      if (!data) {
        return;
      }

      if (data.kind === 'follower' && data.userId) {
        router.push({ pathname: '/profile', params: { userId: String(data.userId) } });
        return;
      }
      if (data.kind === 'event') {
        router.push('/');
        return;
      }

      if (data.kind === 'message' && data.chatId) {
        if (data.chatType === 'group') {
          router.push({
            pathname: '/chat/[chatId]',
            params: { chatId: String(data.chatId), type: 'group' },
          });
          return;
        }

        router.push({
          pathname: '/chat/[chatId]',
          params: {
            chatId: String(data.chatId),
            otherUserId: data.otherUserId ? String(data.otherUserId) : '',
          },
        });
      }
    };

    const routeResponse = (response: any) => {
      const request = response?.notification?.request;
      if (!active || !request || request.identifier === handledResponse.current) return;
      handledResponse.current = request.identifier;
      handleNotificationRoute(request.content?.data);
      NotificationsModule.clearLastNotificationResponse?.();
    };
    NotificationsModule.getLastNotificationResponseAsync?.().then(routeResponse).catch((error: any) => console.warn('Unable to read notification:', error));
    const responseSub = NotificationsModule.addNotificationResponseReceivedListener(routeResponse);

    return () => {
      active = false;
      responseSub.remove();
    };
  }, [router, user?.id]);

  useEffect(() => {
    if (!user?.id || !NotificationsModule) {
      return;
    }

    const directChannel = supabase.channel(`notify_direct_${user.id}`);
    directChannel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      async (payload: any) => {
        const row = payload?.new;
        if (!row?.chat_id || !row?.sender_id) {
          return;
        }

        if (row.sender_id === user.id) {
          return;
        }

        const directCheck = await isDirectMessageForUser(String(row.chat_id), user.id);
        if (!directCheck.isForUser) {
          return;
        }

        incrementUnread();

        if (registeredToken.current) return;
        const senderName = await getProfileDisplayName(String(row.sender_id));
        await NotificationsModule.scheduleNotificationAsync({
          content: {
            title: senderName,
            body: row.text || 'You have a new message.',
            data: {
              kind: 'message',
              chatType: 'direct',
              chatId: String(row.chat_id),
              otherUserId: directCheck.otherUserId,
            },
          },
          trigger: null,
        });
      }
    );

    const groupChannel = supabase.channel(`notify_group_${user.id}`);
    groupChannel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'group_chat_messages' },
      async (payload: any) => {
        const row = payload?.new;
        if (!row?.group_chat_id || !row?.sender_id) {
          return;
        }

        if (row.sender_id === user.id) {
          return;
        }

        const isMember = await isGroupMessageForUser(String(row.group_chat_id), user.id);
        if (!isMember) {
          return;
        }

        incrementUnread();

        if (registeredToken.current) return;
        const [{ data: group }, senderName] = await Promise.all([
          supabase
            .from('group_chats')
            .select('name')
            .eq('id', row.group_chat_id)
            .maybeSingle<{ name: string }>(),
          getProfileDisplayName(String(row.sender_id)),
        ]);

        const body =
          row.message_type === 'video'
            ? `${senderName} shared a video`
            : row.message_type === 'event'
              ? `${senderName} shared an event`
              : row.text || 'New group message';

        await NotificationsModule.scheduleNotificationAsync({
          content: {
            title: group?.name || 'Group message',
            body,
            data: {
                  kind: 'message',
                  chatType: 'group',
                  chatId: String(row.group_chat_id),
                },
          },
          trigger: null,
        });
      }
    );

    directChannel.subscribe();
    groupChannel.subscribe();

    return () => {
      supabase.removeChannel(directChannel);
      supabase.removeChannel(groupChannel);
    };
  }, [incrementUnread, user?.id]);

  return null;
}
