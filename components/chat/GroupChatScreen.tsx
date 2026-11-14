import AvatarImage from '@/components/AvatarImage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { Calendar, MoreVertical, Paperclip, Search, Send, Settings, Share2, UserPlus, Video as VideoIcon, X } from 'lucide-react-native';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import {
  addGroupMembers,
  fetchGroupChatDetails,
  fetchGroupChatMessages,
  fetchMyShareableEvents,
  fetchMyShareableVideos,
  getGroupInitials,
  GroupChatDetails,
  GroupChatMember,
  GroupChatMessage,
  GroupChatProfile,
  GroupSharedEvent,
  GroupSharedVideo,
  leaveGroupChat,
  markGroupChatRead,
  removeGroupMember,
  renameGroupChat,
  searchProfilesForGroup,
  updateGroupTextMessage,
  deleteGroupMessage,
  sendGroupEventMessage,
  sendGroupTextMessage,
  sendGroupVideoMessage,
} from '@/lib/group-chat-service';
import { supabase } from '@/lib/supabase';

type GroupChatAttachment = {
  type: 'image' | 'video';
  url: string;
  name?: string;
};

const ATTACHMENT_PREFIX = '__ATTACHMENT__:';

function formatDay(dateString: string) {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

function formatClock(dateString: string) {
  return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function buildFallbackProfile(id: string, email?: string | null): GroupChatProfile {
  const fallbackName = email?.split('@')[0] || 'You';
  return {
    id,
    fullName: fallbackName,
    username: fallbackName.toLowerCase(),
  };
}

function normalizeGroupError(error: any) {
  const message = error?.message || String(error) || '';
  if (message.includes('relation') && message.includes('does not exist')) {
    return 'Group chat tables are missing in Supabase. Run sql_commands_for_supabase_tables/create-group-chat-tables.sql first.';
  }

  if (message.includes('permission denied') || message.includes('row-level security')) {
    return 'Group chat permissions blocked this action. Run sql_commands_for_supabase_tables/enable-chat-message-edit-delete.sql in Supabase, then try again.';
  }

  return message || 'Something went wrong.';
}

function parseAttachmentPayload(messageText: string): {
  attachment: GroupChatAttachment | null;
  caption: string;
} {
  if (!messageText.startsWith(ATTACHMENT_PREFIX)) {
    return { attachment: null, caption: messageText };
  }

  const payloadRaw = messageText.slice(ATTACHMENT_PREFIX.length);
  const splitAt = payloadRaw.indexOf('\n');
  const jsonPart = splitAt === -1 ? payloadRaw : payloadRaw.slice(0, splitAt);
  const captionPart = splitAt === -1 ? '' : payloadRaw.slice(splitAt + 1);

  try {
    const parsed = JSON.parse(jsonPart);
    if (
      parsed &&
      (parsed.type === 'image' || parsed.type === 'video') &&
      typeof parsed.url === 'string'
    ) {
      return {
        attachment: {
          type: parsed.type,
          url: parsed.url,
          name: typeof parsed.name === 'string' ? parsed.name : undefined,
        },
        caption: captionPart,
      };
    }
  } catch {
    return { attachment: null, caption: messageText };
  }

  return { attachment: null, caption: messageText };
}

export default function GroupChatScreen({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<GroupChatMessage>>(null);

  const [group, setGroup] = useState<GroupChatDetails | null>(null);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [memberModalVisible, setMemberModalVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [shareTab, setShareTab] = useState<'videos' | 'events'>('videos');
  const [shareCaption, setShareCaption] = useState('');
  const [isSearchingMembers, setIsSearchingMembers] = useState(false);
  const [isLoadingShareItems, setIsLoadingShareItems] = useState(false);
  const [memberResults, setMemberResults] = useState<GroupChatProfile[]>([]);
  const [pendingMembers, setPendingMembers] = useState<GroupChatProfile[]>([]);
  const [videoItems, setVideoItems] = useState<GroupSharedVideo[]>([]);
  const [eventItems, setEventItems] = useState<GroupSharedEvent[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<GroupChatMessage | null>(null);

  const currentUserId = user?.id ?? null;

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const currentMember = useMemo(() => {
    if (!currentUserId) {
      return null;
    }

    const existing = group?.members.find((member) => member.id === currentUserId);
    return existing || buildFallbackProfile(currentUserId, user?.email);
  }, [currentUserId, group?.members, user?.email]);

  const currentRole = (currentMember as GroupChatMember | null)?.role ?? 'member';
  const isAdminOrOwner = currentRole === 'admin' || currentRole === 'owner';
  const existingMemberIds = useMemo(
    () => group?.members.map((member) => member.id) ?? [],
    [group?.members]
  );

  const loadGroupData = useCallback(async () => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    try {
      const [details, nextMessages] = await Promise.all([
        fetchGroupChatDetails(groupId, currentUserId),
        fetchGroupChatMessages(groupId),
      ]);

      setGroup(details);
      setMessages(nextMessages);
      setError(null);

      try {
        await markGroupChatRead(groupId, currentUserId);
      } catch {
        // Ignore read-state write failures and keep chat usable.
      }
    } catch (nextError: any) {
      setError(normalizeGroupError(nextError));
    } finally {
      setLoading(false);
    }
  }, [currentUserId, groupId]);

  useEffect(() => {
    setLoading(true);
    loadGroupData();
  }, [loadGroupData]);

  useEffect(() => {
    scrollToBottom(false);
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (!groupId) {
      return;
    }

    const channel = supabase.channel(`group_chat_${groupId}`);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'group_chat_messages', filter: `group_chat_id=eq.${groupId}` },
      async () => {
        await loadGroupData();
      }
    );
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'group_chat_members', filter: `group_chat_id=eq.${groupId}` },
      async () => {
        await loadGroupData();
      }
    );
    channel.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'group_chat_members', filter: `group_chat_id=eq.${groupId}` },
      async () => {
        await loadGroupData();
      }
    );
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'group_chats', filter: `id=eq.${groupId}` },
      async () => {
        await loadGroupData();
      }
    );
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, loadGroupData]);

  useEffect(() => {
    if (!memberModalVisible || !memberSearch.trim() || !currentUserId) {
      setMemberResults([]);
      setIsSearchingMembers(false);
      return;
    }

    let cancelled = false;
    setIsSearchingMembers(true);
    const excludeIds = [...existingMemberIds, ...pendingMembers.map((member) => member.id)];

    const runSearch = async () => {
      try {
        const results = await searchProfilesForGroup(memberSearch, currentUserId, excludeIds);

        if (!cancelled) {
          setMemberResults(results);
          setIsSearchingMembers(false);
        }
      } catch {
        if (!cancelled) {
          setMemberResults([]);
          setIsSearchingMembers(false);
        }
      }
    };

    const timer = setTimeout(runSearch, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentUserId, existingMemberIds, memberModalVisible, memberSearch, pendingMembers]);

  useEffect(() => {
    if (!shareModalVisible || !currentUserId) {
      return;
    }

    let cancelled = false;
    setIsLoadingShareItems(true);

    const loadShareableContent = async () => {
      try {
        const [videos, events] = await Promise.all([
          fetchMyShareableVideos(currentUserId),
          fetchMyShareableEvents(currentUserId),
        ]);

        if (!cancelled) {
          setVideoItems(videos);
          setEventItems(events);
          setIsLoadingShareItems(false);
        }
      } catch {
        if (!cancelled) {
          setVideoItems([]);
          setEventItems([]);
          setIsLoadingShareItems(false);
        }
      }
    };

    loadShareableContent();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, shareModalVisible]);

  const handleOpenSettings = () => {
    setRenameText(group?.name ?? '');
    setSettingsModalVisible(true);
  };

  const handleRenameGroup = async () => {
    if (!group || !renameText.trim() || renameText.trim() === group.name) {
      return;
    }

    try {
      setIsRenaming(true);
      await renameGroupChat(group.id, renameText.trim());
      await loadGroupData();
    } catch (nextError: any) {
      Alert.alert('Unable to rename group', normalizeGroupError(nextError));
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRemoveMember = (member: GroupChatMember) => {
    if (!group || !currentUserId) {
      return;
    }

    Alert.alert(
      'Remove member',
      `Remove ${member.fullName} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeGroupMember(group.id, member.id);
              await loadGroupData();
            } catch (nextError: any) {
              Alert.alert('Unable to remove member', normalizeGroupError(nextError));
            }
          },
        },
      ]
    );
  };

  const handleLeaveGroup = () => {
    if (!group || !currentUserId) {
      return;
    }

    const message =
      currentRole === 'owner'
        ? 'You are the owner. Leaving will remove you from the group. Are you sure?'
        : 'You will no longer be able to see or send messages in this group.';

    Alert.alert('Leave group', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveGroupChat(group.id, currentUserId);
            setSettingsModalVisible(false);
            router.replace('/(tabs)/messages' as any);
          } catch (nextError: any) {
            Alert.alert('Unable to leave group', normalizeGroupError(nextError));
          }
        },
      },
    ]);
  };

  const handleSendText = async () => {
    if (!group || !currentUserId || !composerText.trim() || sending) {
      return;
    }

    try {
      setSending(true);
      if (editingMessageId) {
        await updateGroupTextMessage({
          messageId: editingMessageId,
          senderId: currentUserId,
          text: composerText,
        });
      } else {
        await sendGroupTextMessage({
          groupId: group.id,
          senderId: currentUserId,
          text: composerText,
        });
      }
      setComposerText('');
      setEditingMessageId(null);
      await loadGroupData();
      scrollToBottom(true);
    } catch (nextError: any) {
      Alert.alert(editingMessageId ? 'Unable to update message' : 'Unable to send message', normalizeGroupError(nextError));
    } finally {
      setSending(false);
    }
  };

  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null);
    setComposerText('');
  }, []);

  const closeMessageSheet = useCallback(() => {
    setSelectedMessage(null);
  }, []);

  const handleDeleteMessage = useCallback(
    async (message: GroupChatMessage) => {
      if (!currentUserId) {
        return;
      }

      try {
        await deleteGroupMessage({
          messageId: message.id,
          senderId: currentUserId,
        });

        if (editingMessageId === message.id) {
          cancelEditingMessage();
        }

        await loadGroupData();
      } catch (nextError: any) {
        Alert.alert('Unable to delete message', normalizeGroupError(nextError));
      }
    },
    [cancelEditingMessage, currentUserId, editingMessageId, loadGroupData]
  );

  const handleMessageActions = useCallback(
    (message: GroupChatMessage) => {
      if (!currentUserId || message.sender.id !== currentUserId) {
        return;
      }

      setSelectedMessage(message);
    },
    [currentUserId]
  );

  const getFileExtension = (uri: string, fileName?: string | null, type?: 'image' | 'video') => {
    const nameSource = fileName || uri;
    const dotIndex = nameSource.lastIndexOf('.');
    if (dotIndex !== -1) {
      const ext = nameSource.slice(dotIndex + 1).toLowerCase();
      if (ext) {
        return ext;
      }
    }

    return type === 'video' ? 'mp4' : 'jpg';
  };

  const getContentType = (ext: string, type: 'image' | 'video', mimeType?: string | null) => {
    if (mimeType) {
      return mimeType;
    }

    const imageMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      heic: 'image/heic',
      gif: 'image/gif',
    };

    const videoMap: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      m4v: 'video/x-m4v',
      webm: 'video/webm',
    };

    return type === 'video' ? videoMap[ext] || 'video/mp4' : imageMap[ext] || 'image/jpeg';
  };

  const uploadAttachment = useCallback(
    async (asset: ImagePicker.ImagePickerAsset): Promise<GroupChatAttachment> => {
      if (!currentUserId) {
        throw new Error('You must be logged in to send attachments.');
      }

      const mediaType: 'image' | 'video' = asset.type === 'video' ? 'video' : 'image';
      const extension = getFileExtension(asset.uri, asset.fileName, mediaType);
      const contentType = getContentType(extension, mediaType, asset.mimeType);
      const bucket = mediaType === 'video' ? 'videos' : 'images';

      const safeName = (asset.fileName || `group_${Date.now()}.${extension}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `group-chat/${currentUserId}/${Date.now()}_${safeName}`;

      const response = await fetch(asset.uri);
      if (!response.ok) {
        throw new Error('Failed to read selected file.');
      }

      const arrayBuffer = await response.arrayBuffer();
      const { error } = await supabase.storage.from(bucket).upload(filePath, arrayBuffer, {
        contentType,
        upsert: false,
      });

      if (error) {
        throw error;
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
      return {
        type: mediaType,
        url: data.publicUrl,
        name: asset.fileName || undefined,
      };
    },
    [currentUserId]
  );

  const handleAttachPress = async () => {
    if (uploadingAttachment || !group || !currentUserId) {
      return;
    }

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync(
      Platform.select({
        web: {
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          allowsEditing: false,
          quality: 0.9,
        },
        default: {
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          allowsEditing: false,
          quality: 0.9,
        },
      }) as ImagePicker.ImagePickerOptions
    );

    if (result.canceled || !result.assets?.length) {
      return;
    }

    try {
      setUploadingAttachment(true);
      const uploaded = await uploadAttachment(result.assets[0]);
      const payload = `${ATTACHMENT_PREFIX}${JSON.stringify(uploaded)}`;

      await sendGroupTextMessage({
        groupId: group.id,
        senderId: currentUserId,
        text: payload,
      });

      await loadGroupData();
      scrollToBottom(true);
    } catch (nextError: any) {
      Alert.alert('Attachment error', normalizeGroupError(nextError));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleAddPendingMember = (member: GroupChatProfile) => {
    setPendingMembers((current) => [...current, member]);
    setMemberSearch('');
    setMemberResults([]);
  };

  const handleCommitMembers = async () => {
    if (!group || pendingMembers.length === 0) {
      setMemberModalVisible(false);
      return;
    }

    try {
      await addGroupMembers({
        groupId: group.id,
        memberIds: pendingMembers.map((member) => member.id),
      });
      setPendingMembers([]);
      setMemberSearch('');
      setMemberResults([]);
      setMemberModalVisible(false);
      await loadGroupData();
    } catch (nextError: any) {
      Alert.alert('Unable to add members', normalizeGroupError(nextError));
    }
  };

  const handleShareVideo = async (video: GroupSharedVideo) => {
    if (!group || !currentUserId) {
      return;
    }

    try {
      await sendGroupVideoMessage({
        groupId: group.id,
        senderId: currentUserId,
        videoId: video.id,
        text: shareCaption,
      });
      setShareCaption('');
      setShareModalVisible(false);
      await loadGroupData();
      scrollToBottom(true);
    } catch (nextError: any) {
      Alert.alert('Unable to share video', normalizeGroupError(nextError));
    }
  };

  const handleShareEvent = async (event: GroupSharedEvent) => {
    if (!group || !currentUserId) {
      return;
    }

    try {
      await sendGroupEventMessage({
        groupId: group.id,
        senderId: currentUserId,
        eventId: event.id,
        text: shareCaption,
      });
      setShareCaption('');
      setShareModalVisible(false);
      await loadGroupData();
      scrollToBottom(true);
    } catch (nextError: any) {
      Alert.alert('Unable to share event', normalizeGroupError(nextError));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
          <Text style={styles.loadingText}>Loading group chat...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!group || !currentMember) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.missingContainer}>
          <Text style={styles.missingTitle}>Group unavailable</Text>
          <Text style={styles.missingText}>{error || 'You may no longer be a member of this group.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.headerTitleWrap}>
              <View style={[styles.headerAvatar, { backgroundColor: group.avatarColor }]}> 
                <Text style={styles.headerAvatarText}>{getGroupInitials(group.name)}</Text>
              </View>
              <View>
                <Text style={styles.headerTitle}>{group.name}</Text>
                <Text style={styles.headerSubtitle}>{group.memberCount} members</Text>
              </View>
            </View>
          ),
          headerRight: () => (
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.headerAction} onPress={() => setMemberModalVisible(true)}>
                <UserPlus size={20} color={Colors.dark.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerAction} onPress={handleOpenSettings}>
                <Settings size={20} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>
          ),
          headerStyle: { backgroundColor: Colors.dark.background },
          headerShadowVisible: false,
        }}
      />

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight + insets.top : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.messagesList, { paddingBottom: 96 + Math.max(insets.bottom, 10) }]}
          keyboardShouldPersistTaps="handled"
          onLayout={() => scrollToBottom(false)}
          onContentSizeChange={() => scrollToBottom(false)}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>This group is ready</Text>
              <Text style={styles.emptyStateText}>Send a text message or share one of your videos or events.</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const isCurrentUser = item.sender.id === currentUserId;
            const showDay = index === 0 || formatDay(messages[index - 1].createdAt) !== formatDay(item.createdAt);
            const { attachment, caption } =
              item.type === 'text'
                ? parseAttachmentPayload(item.text || '')
                : { attachment: null, caption: item.text || '' };

            return (
              <>
                {showDay ? (
                  <View style={styles.dayWrap}>
                    <Text style={styles.dayLabel}>{formatDay(item.createdAt)}</Text>
                  </View>
                ) : null}

                <View style={[styles.messageRow, isCurrentUser ? styles.messageRowCurrent : styles.messageRowOther]}>
                  {!isCurrentUser ? (
                    <AvatarImage uri={item.sender.avatarUrl} userId={item.sender?.id} style={styles.senderAvatar} contentFit="cover" />
                  ) : null}

                  <TouchableOpacity
                    activeOpacity={0.92}
                    disabled={!isCurrentUser}
                    onLongPress={() => handleMessageActions(item)}
                    style={[styles.bubble, isCurrentUser ? styles.bubbleCurrent : styles.bubbleOther]}
                  >
                    {isCurrentUser ? (
                      <TouchableOpacity
                        style={styles.messageMenuButton}
                        onPress={() => handleMessageActions(item)}
                        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                      >
                        <MoreVertical size={16} color={Colors.dark.text} />
                      </TouchableOpacity>
                    ) : null}
                    {!isCurrentUser ? <Text style={styles.senderName}>{item.sender.fullName}</Text> : null}
                    {item.type === 'text' && caption ? <Text style={styles.messageText}>{caption}</Text> : null}

                    {item.type === 'text' && attachment?.type === 'image' ? (
                      <Image source={{ uri: attachment.url }} style={styles.messageImage} contentFit="cover" transition={200} />
                    ) : null}

                    {item.type === 'text' && attachment?.type === 'video' ? (
                      <View style={styles.messageVideoWrap}>
                        <Video
                          source={{ uri: attachment.url }}
                          style={styles.messageVideo}
                          useNativeControls
                          resizeMode={ResizeMode.CONTAIN}
                          isLooping={false}
                        />
                      </View>
                    ) : null}

                    {item.type === 'video' && item.video ? (
                      <View style={styles.richCard}>
                        <Text style={styles.richLabel}>Shared video</Text>
                        <View style={styles.videoWrap}>
                          <Video
                            source={{ uri: item.video.videoUrl }}
                            style={styles.videoPlayer}
                            useNativeControls
                            resizeMode={ResizeMode.CONTAIN}
                          />
                        </View>
                        <Text style={styles.richTitle}>{item.video.title}</Text>
                        {item.text ? <Text style={styles.richCaption}>{item.text}</Text> : null}
                      </View>
                    ) : null}

                    {item.type === 'event' && item.event ? (
                      <TouchableOpacity
                        style={styles.richCard}
                        activeOpacity={0.85}
                        onPress={() => {
                          if (item.event) {
                            router.push({ pathname: '/event/[id]', params: { id: item.event.id } });
                          }
                        }}
                      >
                        <Text style={styles.richLabel}>Shared event</Text>
                        {item.event.imageUrl ? (
                          <Image source={{ uri: item.event.imageUrl }} style={styles.eventImage} contentFit="cover" />
                        ) : null}
                        <Text style={styles.richTitle}>{item.event.eventName}</Text>
                        <Text style={styles.richMeta}>{new Date(item.event.startDate).toLocaleString()}</Text>
                        {item.event.locationName ? <Text style={styles.richMeta}>{item.event.locationName}</Text> : null}
                        {item.text ? <Text style={styles.richCaption}>{item.text}</Text> : null}
                      </TouchableOpacity>
                    ) : null}

                    <Text style={styles.messageTime}>{formatClock(item.createdAt)}</Text>
                  </TouchableOpacity>
                </View>
              </>
            );
          }}
        />

        <SafeAreaView edges={['bottom']} style={styles.composerSafe}>
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}> 
            {editingMessageId ? (
              <View style={styles.editBanner}>
                <Text style={styles.editBannerText}>Editing message</Text>
                <TouchableOpacity onPress={cancelEditingMessage}>
                  <Text style={styles.editBannerCancel}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity style={styles.shareButton} onPress={() => setShareModalVisible(true)}>
              <Share2 size={20} color={Colors.dark.text} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.attachButton}
              onPress={handleAttachPress}
              disabled={uploadingAttachment || sending || !!editingMessageId}
              activeOpacity={0.85}
            >
              {uploadingAttachment ? (
                <ActivityIndicator size="small" color={Colors.dark.text} />
              ) : (
                <Paperclip size={20} color={Colors.dark.text} />
              )}
            </TouchableOpacity>

            <TextInput
              style={styles.composerInput}
              placeholder="Message this group"
              placeholderTextColor={Colors.dark.subtext}
              value={composerText}
              onChangeText={setComposerText}
              onFocus={() => setTimeout(() => scrollToBottom(true), 150)}
              multiline
            />

            <TouchableOpacity style={[styles.sendButton, (!composerText.trim() || sending) && styles.sendButtonDisabled]} onPress={handleSendText} disabled={!composerText.trim() || sending}>
              {sending ? <ActivityIndicator size="small" color={Colors.dark.text} /> : <Send size={18} color={Colors.dark.text} />}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <Modal
        visible={memberModalVisible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setMemberModalVisible(false)}
      >
        <View
          style={[
            styles.modalBackdrop,
            {
              paddingTop: Math.max(insets.top, 12),
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <KeyboardAvoidingView
            style={styles.modalKeyboardWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
          >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add members</Text>
              <TouchableOpacity onPress={() => setMemberModalVisible(false)}>
                <X size={22} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchInputWrap}>
              <Search size={18} color={Colors.dark.subtext} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search registered users"
                placeholderTextColor={Colors.dark.subtext}
                value={memberSearch}
                onChangeText={setMemberSearch}
                autoCapitalize="none"
              />
            </View>

            {pendingMembers.length > 0 ? (
              <View style={styles.pendingWrap}>
                {pendingMembers.map((member) => (
                  <View key={member.id} style={styles.pendingChip}>
                    <Text style={styles.pendingChipText}>{member.fullName}</Text>
                    <TouchableOpacity onPress={() => setPendingMembers((current) => current.filter((item) => item.id !== member.id))}>
                      <X size={14} color={Colors.dark.text} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.memberResultsPanel}>
              {isSearchingMembers ? (
                <View style={styles.loaderPanelLarge}>
                  <ActivityIndicator size="small" color={Colors.dark.primary} />
                </View>
              ) : (
                <FlatList
                  data={memberResults}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="always"
                  keyboardDismissMode="on-drag"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.memberResultsContent}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.resultRow} onPress={() => handleAddPendingMember(item)}>
                      {<AvatarImage uri={item.avatarUrl} userId={item?.id} style={styles.resultAvatar} contentFit="cover" />}
                      <View style={styles.resultInfo}>
                        <Text style={styles.resultName}>{item.fullName}</Text>
                        <Text style={styles.resultHandle}>@{item.username}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <View style={styles.emptyModalState}>
                      <Text style={styles.emptyModalText}>Search for registered users to add.</Text>
                    </View>
                  }
                />
              )}
            </View>

            <TouchableOpacity style={styles.primaryModalButton} onPress={handleCommitMembers} activeOpacity={0.85}>
              <Text style={styles.primaryModalButtonText}>Add to group</Text>
            </TouchableOpacity>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={shareModalVisible} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setShareModalVisible(false)}>
        <View
          style={[
            styles.modalBackdrop,
            {
              paddingTop: Math.max(insets.top, 12),
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.modalCardLarge}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share to group</Text>
              <TouchableOpacity onPress={() => setShareModalVisible(false)}>
                <X size={22} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.tabRow}>
              <TouchableOpacity style={[styles.tabButton, shareTab === 'videos' && styles.tabButtonActive]} onPress={() => setShareTab('videos')}>
                <VideoIcon size={16} color={Colors.dark.text} />
                <Text style={styles.tabButtonText}>My videos</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.tabButton, shareTab === 'events' && styles.tabButtonActive]} onPress={() => setShareTab('events')}>
                <Calendar size={16} color={Colors.dark.text} />
                <Text style={styles.tabButtonText}>My events</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.captionInput}
              placeholder="Add a note"
              placeholderTextColor={Colors.dark.subtext}
              value={shareCaption}
              onChangeText={setShareCaption}
            />

            {isLoadingShareItems ? (
              <View style={styles.loaderPanel}>
                <ActivityIndicator size="small" color={Colors.dark.primary} />
              </View>
            ) : shareTab === 'videos' ? (
              <FlatList
                data={videoItems}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <View style={styles.shareRow}>
                    {item.thumbnailUrl ? (
                      <Image source={{ uri: item.thumbnailUrl }} style={styles.shareThumbnail} contentFit="cover" />
                    ) : (
                      <View style={styles.shareThumbnailFallback}>
                        <VideoIcon size={18} color={Colors.dark.text} />
                      </View>
                    )}

                    <View style={styles.shareInfo}>
                      <Text style={styles.shareTitle}>{item.title}</Text>
                      {item.eventName ? <Text style={styles.shareMeta}>{item.eventName}</Text> : null}
                    </View>

                    <TouchableOpacity style={styles.shareAction} onPress={() => handleShareVideo(item)}>
                      <Text style={styles.shareActionText}>Share</Text>
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyModalState}>
                    <Text style={styles.emptyModalText}>No uploaded videos found for this account.</Text>
                  </View>
                }
              />
            ) : (
              <FlatList
                data={eventItems}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <View style={styles.shareRow}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.shareThumbnail} contentFit="cover" />
                    ) : (
                      <View style={styles.shareThumbnailFallback}>
                        <Calendar size={18} color={Colors.dark.text} />
                      </View>
                    )}

                    <View style={styles.shareInfo}>
                      <Text style={styles.shareTitle}>{item.eventName}</Text>
                      <Text style={styles.shareMeta}>{new Date(item.startDate).toLocaleString()}</Text>
                    </View>

                    <TouchableOpacity style={styles.shareAction} onPress={() => handleShareEvent(item)}>
                      <Text style={styles.shareActionText}>Share</Text>
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyModalState}>
                    <Text style={styles.emptyModalText}>No created events found for this account.</Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>
      <Modal visible={settingsModalVisible} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setSettingsModalVisible(false)}>
        <View
          style={[
            styles.modalBackdrop,
            {
              paddingTop: Math.max(insets.top, 12),
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Group settings</Text>
              <TouchableOpacity onPress={() => setSettingsModalVisible(false)}>
                <X size={22} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>

            {isAdminOrOwner ? (
              <View style={styles.renameSection}>
                <Text style={styles.sectionLabel}>Group name</Text>
                <View style={styles.renameRow}>
                  <TextInput
                    style={styles.renameInput}
                    value={renameText}
                    onChangeText={setRenameText}
                    placeholder="Enter group name"
                    placeholderTextColor={Colors.dark.subtext}
                    returnKeyType="done"
                    onSubmitEditing={handleRenameGroup}
                  />
                  <TouchableOpacity
                    style={[styles.renameButton, (!renameText.trim() || renameText.trim() === group?.name || isRenaming) && styles.renameButtonDisabled]}
                    onPress={handleRenameGroup}
                    disabled={!renameText.trim() || renameText.trim() === group?.name || isRenaming}
                  >
                    {isRenaming ? (
                      <ActivityIndicator size="small" color={Colors.dark.text} />
                    ) : (
                      <Text style={styles.renameButtonText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <Text style={[styles.sectionLabel, { marginTop: 16, marginBottom: 8 }]}>Members ({group?.memberCount ?? 0})</Text>

            <FlatList
              data={group?.members ?? []}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelf = item.id === currentUserId;
                const isItemOwner = (item as GroupChatMember).role === 'owner';
                const canRemove = isAdminOrOwner && !isSelf && !isItemOwner;

                return (
                  <View style={styles.memberRow}>
                    {<AvatarImage uri={item.avatarUrl} userId={item?.id} style={styles.resultAvatar} contentFit="cover" />}
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{item.fullName}{isSelf ? ' (you)' : ''}</Text>
                      <Text style={styles.resultHandle}>{(item as GroupChatMember).role ?? 'member'}</Text>
                    </View>
                    {canRemove ? (
                      <TouchableOpacity style={styles.removeMemberButton} onPress={() => handleRemoveMember(item as GroupChatMember)}>
                        <X size={16} color={Colors.dark.text} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              }}
            />

            <TouchableOpacity style={styles.leaveButton} onPress={handleLeaveGroup}>
              <Text style={styles.leaveButtonText}>Leave group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!selectedMessage} animationType="slide" transparent statusBarTranslucent onRequestClose={closeMessageSheet}>
        <View
          style={[
            styles.modalBackdrop,
            {
              paddingTop: Math.max(insets.top, 12),
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.messageSheetCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Message options</Text>
              <TouchableOpacity onPress={closeMessageSheet}>
                <X size={22} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>

            {selectedMessage && (() => {
              const { attachment, caption } =
                selectedMessage.type === 'text'
                  ? parseAttachmentPayload(selectedMessage.text || '')
                  : { attachment: null, caption: selectedMessage.text || '' };
              const canEdit = selectedMessage.type === 'text' && !attachment && !!caption.trim();

              return (
                <>
                  {canEdit ? (
                    <TouchableOpacity
                      style={styles.sheetAction}
                      onPress={() => {
                        setEditingMessageId(selectedMessage.id);
                        setComposerText(caption);
                        closeMessageSheet();
                      }}
                    >
                      <Text style={styles.sheetActionText}>Edit message</Text>
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={styles.sheetAction}
                    onPress={() => {
                      const messageToDelete = selectedMessage;
                      closeMessageSheet();
                      Alert.alert('Delete message', 'This will remove the message for everyone in the group.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => {
                            void handleDeleteMessage(messageToDelete);
                          },
                        },
                      ]);
                    }}
                  >
                    <Text style={styles.sheetActionDelete}>Delete message</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.sheetCancel} onPress={closeMessageSheet}>
                    <Text style={styles.sheetCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.dark.background },
  container: { flex: 1, backgroundColor: Colors.dark.background },
  errorBanner: {
    backgroundColor: 'rgba(255,0,0,0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,0,0,0.25)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorBannerText: { color: Colors.dark.text, fontSize: 13, lineHeight: 18 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: Colors.dark.text },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: { color: Colors.dark.text, fontWeight: '800' },
  headerTitle: { color: Colors.dark.text, fontSize: 16, fontWeight: '700' },
  headerSubtitle: { color: Colors.dark.subtext, fontSize: 12 },
  headerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesList: { paddingHorizontal: 12, paddingVertical: 18 },
  dayWrap: { alignItems: 'center', marginVertical: 10 },
  dayLabel: {
    color: Colors.dark.subtext,
    backgroundColor: Colors.dark.card,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 13,
  },
  messageRow: { flexDirection: 'row', marginBottom: 14, maxWidth: '88%' },
  messageRowCurrent: { alignSelf: 'flex-end' },
  messageRowOther: { alignSelf: 'flex-start' },
  senderAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8, alignSelf: 'flex-end' },
  senderFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.surface,
  },
  senderFallbackText: { color: Colors.dark.text, fontWeight: '700', fontSize: 12 },
  bubble: { minWidth: 90, borderRadius: 18, padding: 12, position: 'relative' },
  bubbleCurrent: { backgroundColor: Colors.dark.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: Colors.dark.card, borderBottomLeftRadius: 4 },
  messageMenuButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
    zIndex: 2,
  },
  senderName: { color: Colors.dark.subtext, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  messageText: { color: Colors.dark.text, fontSize: 16, lineHeight: 22 },
  messageImage: { width: 220, height: 220, borderRadius: 12, marginTop: 8 },
  messageVideoWrap: {
    width: 220,
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.dark.background,
    marginTop: 8,
  },
  messageVideo: { width: '100%', height: '100%' },
  richCard: { gap: 8 },
  richLabel: { color: Colors.dark.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  videoWrap: {
    width: 220,
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.dark.background,
  },
  videoPlayer: { width: '100%', height: '100%' },
  eventImage: { width: 220, height: 140, borderRadius: 12 },
  richTitle: { color: Colors.dark.text, fontSize: 16, fontWeight: '700' },
  richMeta: { color: Colors.dark.subtext, fontSize: 13 },
  richCaption: { color: Colors.dark.text, fontSize: 14, lineHeight: 20 },
  messageTime: { color: Colors.dark.subtext, fontSize: 12, alignSelf: 'flex-end', marginTop: 6 },
  composerSafe: { backgroundColor: Colors.dark.card },
  composer: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  editBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  editBannerText: { color: Colors.dark.text, fontSize: 13, fontWeight: '600' },
  editBannerCancel: { color: Colors.dark.primary, fontSize: 13, fontWeight: '700' },
  shareButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderRadius: 18,
    backgroundColor: Colors.dark.surface,
    color: Colors.dark.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  emptyState: { paddingTop: 100, alignItems: 'center', paddingHorizontal: 24 },
  emptyStateTitle: { color: Colors.dark.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptyStateText: { color: Colors.dark.subtext, textAlign: 'center', lineHeight: 22 },
  missingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  missingTitle: { color: Colors.dark.text, fontSize: 24, fontWeight: '800', marginBottom: 10 },
  missingText: { color: Colors.dark.subtext, lineHeight: 22, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalKeyboardWrap: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    minHeight: '70%',
    maxHeight: '86%',
  },
  modalCardLarge: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    minHeight: '78%',
    maxHeight: '92%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  messageSheetCard: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
  },
  modalTitle: { color: Colors.dark.text, fontSize: 20, fontWeight: '700' },
  sheetAction: {
    minHeight: 52,
    justifyContent: 'center',
    borderRadius: 16,
    paddingHorizontal: 16,
    backgroundColor: Colors.dark.card,
    marginTop: 12,
  },
  sheetActionText: { color: Colors.dark.text, fontSize: 16, fontWeight: '600' },
  sheetActionDelete: { color: '#ff6b6b', fontSize: 16, fontWeight: '600' },
  sheetCancel: {
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 16,
    marginTop: 12,
    backgroundColor: Colors.dark.surface,
  },
  sheetCancelText: { color: Colors.dark.text, fontSize: 16, fontWeight: '600' },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.dark.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  modalSearchInput: { flex: 1, color: Colors.dark.text, paddingVertical: 14, fontSize: 15 },
  pendingWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.dark.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pendingChipText: { color: Colors.dark.text, fontWeight: '600' },
  loaderPanel: { paddingVertical: 20, alignItems: 'center' },
  loaderPanelLarge: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  memberResultsPanel: {
    flex: 1,
    minHeight: 220,
  },
  memberResultsContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  resultAvatar: { width: 42, height: 42, borderRadius: 21 },
  resultAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
  },
  resultAvatarFallbackText: { color: Colors.dark.text, fontWeight: '800' },
  resultInfo: { flex: 1 },
  resultName: { color: Colors.dark.text, fontWeight: '600', fontSize: 15 },
  resultHandle: { color: Colors.dark.subtext, fontSize: 13, marginTop: 2 },
  emptyModalState: { paddingTop: 40, alignItems: 'center' },
  emptyModalText: { color: Colors.dark.subtext, textAlign: 'center' },
  primaryModalButton: {
    marginTop: 14,
    backgroundColor: Colors.dark.primary,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryModalButtonText: { color: Colors.dark.text, fontWeight: '700', fontSize: 15 },
  tabRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: Colors.dark.card,
  },
  tabButtonActive: { backgroundColor: Colors.dark.primary },
  tabButtonText: { color: Colors.dark.text, fontWeight: '600' },
  captionInput: {
    borderRadius: 14,
    backgroundColor: Colors.dark.card,
    color: Colors.dark.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  shareThumbnail: { width: 72, height: 72, borderRadius: 14 },
  shareThumbnailFallback: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareInfo: { flex: 1 },
  shareTitle: { color: Colors.dark.text, fontSize: 15, fontWeight: '700' },
  shareMeta: { color: Colors.dark.subtext, fontSize: 13, marginTop: 4 },
  shareAction: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shareActionText: { color: Colors.dark.text, fontWeight: '700' },
  headerActions: { flexDirection: 'row', gap: 8, marginRight: 4 },
  renameSection: { marginBottom: 4 },
  sectionLabel: { color: Colors.dark.subtext, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  renameInput: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderRadius: 14,
    color: Colors.dark.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  renameButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  renameButtonDisabled: { opacity: 0.4 },
  renameButtonText: { color: Colors.dark.text, fontWeight: '700' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  removeMemberButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveButton: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  leaveButtonText: { color: '#EF4444', fontWeight: '700', fontSize: 15 },
});
