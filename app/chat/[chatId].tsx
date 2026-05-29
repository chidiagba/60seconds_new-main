import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { Send, Paperclip } from "lucide-react-native";
import { useActionSheet } from "@expo/react-native-action-sheet";
import * as ImagePicker from "expo-image-picker";
import { Video, ResizeMode } from "expo-av";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import GroupChatScreen from "@/components/chat/GroupChatScreen";

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
};

type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  _optimistic?: boolean;
};

type ChatAttachment = {
  type: "image" | "video";
  url: string;
  name?: string;
};

const ATTACHMENT_PREFIX = "__ATTACHMENT__:";

function parseAttachmentPayload(messageText: string): {
  attachment: ChatAttachment | null;
  caption: string;
} {
  if (!messageText.startsWith(ATTACHMENT_PREFIX)) {
    return { attachment: null, caption: messageText };
  }

  const payloadRaw = messageText.slice(ATTACHMENT_PREFIX.length);
  const splitAt = payloadRaw.indexOf("\n");
  const jsonPart = splitAt === -1 ? payloadRaw : payloadRaw.slice(0, splitAt);
  const captionPart = splitAt === -1 ? "" : payloadRaw.slice(splitAt + 1);

  try {
    const parsed = JSON.parse(jsonPart);
    if (
      parsed &&
      (parsed.type === "image" || parsed.type === "video") &&
      typeof parsed.url === "string"
    ) {
      return {
        attachment: {
          type: parsed.type,
          url: parsed.url,
          name: typeof parsed.name === "string" ? parsed.name : undefined,
        },
        caption: captionPart,
      };
    }
  } catch {
    return { attachment: null, caption: messageText };
  }

  return { attachment: null, caption: messageText };
}

function safeStr(v: any) {
  return typeof v === "string" ? v : "";
}

function DirectChatScreen() {
  const router = useRouter();
  const { showActionSheetWithOptions } = useActionSheet();
  const params = useLocalSearchParams<{
    chatId?: string; // "new" or existing uuid
    otherUserId?: string;
    userId?: string;
    profileId?: string;
    id?: string;

    full_name?: string;
    username?: string;
    avatar_url?: string;
  }>();

  const { user: authUser, loading: authLoading } = useAuth();
  const currentUserId = authUser?.id ?? null;

  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<MessageRow>>(null);
  const lastRenderedMessageCountRef = useRef(0);

  const rawChatId = safeStr(params.chatId);
  const chatIdParam = rawChatId && rawChatId !== "new" ? rawChatId : null;

  const otherUserId =
    safeStr(params.otherUserId) ||
    safeStr(params.userId) ||
    safeStr(params.profileId) ||
    safeStr(params.id) ||
    null;

  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [otherUser, setOtherUser] = useState<ProfileRow | null>(() => {
    if (!otherUserId) return null;
    return {
      id: otherUserId,
      full_name: safeStr(params.full_name) || null,
      username: safeStr(params.username) || null,
      avatar_url: safeStr(params.avatar_url) || null,
    };
  });

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [optimistic, setOptimistic] = useState<MessageRow[]>([]);
  const [newMessage, setNewMessage] = useState("");

  const [resolvingChat, setResolvingChat] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [resolvingProfile, setResolvingProfile] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  // prevents infinite retry loop + alert blinking
  const didInitRef = useRef(false);

  const scrollToBottom = (animated = true) => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated });
    });
  };

  const otherDisplayName =
    otherUser?.full_name?.trim() ||
    (otherUser?.username ? `@${otherUser.username}` : otherUser ? "User" : "Chat");

  const otherAvatar =
    otherUser?.avatar_url ||
    "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61";

  const isPermissionError = (msg?: string) =>
    (msg || "").toLowerCase().includes("permission denied");

  /**
   * Find existing 1-to-1 chat OR create new
   */
  const ensureChatId = useCallback(async (): Promise<string | null> => {
    if (!currentUserId) return null;
    if (activeChatId) return activeChatId;
    if (!otherUserId) return null;

    if (otherUserId === currentUserId) {
      setFatalError("You cannot start a chat with yourself.");
      return null;
    }

    setResolvingChat(true);
    setFatalError(null);

    try {
      // 1) validate passed chat id
      if (chatIdParam) {
        const { data: okChat, error: okErr } = await supabase
          .from("chats")
          .select("id")
          .eq("id", chatIdParam)
          .maybeSingle<{ id: string }>();

        if (!okErr && okChat?.id) {
          setActiveChatId(okChat.id);
          return okChat.id;
        }
      }

      // 2) search existing chat between two users
      const { data: found, error: findErr } = await supabase
        .from("chats")
        .select("id,user1_id,user2_id")
        .or(
          `and(user1_id.eq.${currentUserId},user2_id.eq.${otherUserId}),and(user1_id.eq.${otherUserId},user2_id.eq.${currentUserId})`
        )
        .limit(1)
        .maybeSingle<ChatRow>();

      if (findErr) throw findErr;

      let resolvedId = found?.id ?? null;

      // 3) create if missing
      if (!resolvedId) {
        const { data: created, error: createErr } = await supabase
          .from("chats")
          .insert({ user1_id: currentUserId, user2_id: otherUserId })
          .select("id")
          .single<{ id: string }>();

        if (createErr) {
          // if unique/race, refetch once
          const { data: again, error: againErr } = await supabase
            .from("chats")
            .select("id,user1_id,user2_id")
            .or(
              `and(user1_id.eq.${currentUserId},user2_id.eq.${otherUserId}),and(user1_id.eq.${otherUserId},user2_id.eq.${currentUserId})`
            )
            .limit(1)
            .maybeSingle<ChatRow>();

          if (againErr) throw againErr;
          resolvedId = again?.id ?? null;
        } else {
          resolvedId = created?.id ?? null;
        }
      }

      if (resolvedId) setActiveChatId(resolvedId);
      return resolvedId;
    } catch (e: any) {
      const msg = e?.message || "Unable to open chat.";
      if (isPermissionError(msg)) {
        setFatalError(
          "Permission denied for chats. Fix Supabase RLS policies for chats/messages (authenticated users must be allowed)."
        );
      } else {
        setFatalError(msg);
      }
      return null;
    } finally {
      setResolvingChat(false);
    }
  }, [currentUserId, activeChatId, otherUserId, chatIdParam]);

  const loadMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true);
    setFatalError(null);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id,chat_id,sender_id,text,created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setMessages((data as MessageRow[]) ?? []);
      requestAnimationFrame(() => scrollToBottom(false));
    } catch (e: any) {
      const msg = e?.message || "Unable to load messages.";
      if (isPermissionError(msg)) {
        setFatalError(
          "Permission denied for messages. Fix Supabase RLS policy to allow participants to read messages."
        );
      } else {
        setFatalError(msg);
      }
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Load other user's profile
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (authLoading) return;
      if (!otherUserId) return;

      setResolvingProfile(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id,full_name,username,avatar_url")
          .eq("id", otherUserId)
          .maybeSingle<ProfileRow>();

        if (!cancelled && !error && data) setOtherUser(data);
      } finally {
        if (!cancelled) setResolvingProfile(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [authLoading, otherUserId]);

  // One-time init: resolve chat, load messages, subscribe realtime
  useEffect(() => {
    if (didInitRef.current) return;
    if (authLoading) return;

    didInitRef.current = true;

    let channel: any = null;

    const run = async () => {
      if (!currentUserId) return;

      const chatId = await ensureChatId();
      if (!chatId) return;

      await loadMessages(chatId);

      channel = supabase
        .channel(`messages:${chatId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const row = payload.new as MessageRow;
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              const next = [...prev, row];
              next.sort(
                (a, b) =>
                  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              return next;
            });
            requestAnimationFrame(() => scrollToBottom(false));
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const row = payload.new as MessageRow;
            setMessages((prev) => prev.map((message) => (message.id === row.id ? row : message)));
            setOptimistic((prev) => prev.filter((message) => message.id !== row.id));
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const row = payload.old as MessageRow;
            setMessages((prev) => prev.filter((message) => message.id !== row.id));
            setOptimistic((prev) => prev.filter((message) => message.id !== row.id));
          }
        )
        .subscribe();
    };

    run();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [authLoading, currentUserId, ensureChatId, loadMessages]);

  const mergedMessages: MessageRow[] = useMemo(() => {
    const map = new Map<string, MessageRow>();
    for (const m of messages) map.set(m.id, m);
    for (const m of optimistic) map.set(m.id, m);
    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [messages, optimistic]);

  useEffect(() => {
    if (!mergedMessages.length) {
      lastRenderedMessageCountRef.current = 0;
      return;
    }

    if (mergedMessages.length !== lastRenderedMessageCountRef.current) {
      lastRenderedMessageCountRef.current = mergedMessages.length;
      scrollToBottom(false);
    }
  }, [mergedMessages.length]);

  const formatTime = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatMessageDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    });
  };

  const closeEditMode = useCallback(() => {
    setEditingMessageId(null);
    setNewMessage("");
  }, []);

  const handleDeleteMessage = useCallback(
    async (message: MessageRow) => {
      if (!currentUserId || message._optimistic) {
        return;
      }

      try {
        const { error } = await supabase
          .from("messages")
          .delete()
          .eq("id", message.id)
          .eq("sender_id", currentUserId);

        if (error) {
          throw error;
        }

        setMessages((prev) => prev.filter((item) => item.id !== message.id));
        setOptimistic((prev) => prev.filter((item) => item.id !== message.id));

        if (editingMessageId === message.id) {
          closeEditMode();
        }
      } catch (error: any) {
        Alert.alert("Unable to delete", error?.message || "Please try again.");
      }
    },
    [closeEditMode, currentUserId, editingMessageId]
  );

  const handleOpenMessageActions = useCallback(
    (message: MessageRow) => {
      if (!currentUserId || message.sender_id !== currentUserId || message._optimistic) {
        return;
      }

      const { attachment, caption } = parseAttachmentPayload(message.text || "");
      const canEdit = !attachment && !!caption.trim();
      const options = [canEdit ? "Edit" : null, "Delete", "Cancel"].filter(Boolean) as string[];
      const cancelButtonIndex = options.length - 1;
      const destructiveButtonIndex = options.indexOf("Delete");

      showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          destructiveButtonIndex,
        },
        (buttonIndex) => {
          if (buttonIndex === undefined || buttonIndex === cancelButtonIndex) {
            return;
          }

          const action = options[buttonIndex];
          if (action === "Edit") {
            setEditingMessageId(message.id);
            setNewMessage(caption);
          }

          if (action === "Delete") {
            Alert.alert("Delete message", "This will remove the message for everyone in this chat.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  void handleDeleteMessage(message);
                },
              },
            ]);
          }
        }
      );
    },
    [currentUserId, handleDeleteMessage, showActionSheetWithOptions]
  );

  const renderMessageItem = ({ item, index }: { item: MessageRow; index: number }) => {
    const isCurrentUser = item.sender_id === currentUserId;
    const { attachment, caption } = parseAttachmentPayload(item.text || "");

    const showDateHeader =
      index === 0 ||
      formatMessageDate(mergedMessages[index - 1].created_at) !==
        formatMessageDate(item.created_at);

    return (
      <>
        {showDateHeader && (
          <View style={styles.dateHeaderContainer}>
            <Text style={styles.dateHeader}>{formatMessageDate(item.created_at)}</Text>
          </View>
        )}

        <View
          style={[
            styles.messageContainer,
            isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage,
            item._optimistic ? styles.optimisticContainer : null,
          ]}
        >
          {!isCurrentUser && (
            <Image source={{ uri: otherAvatar }} style={styles.messageAvatar} contentFit="cover" />
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            disabled={!isCurrentUser || !!item._optimistic}
            onLongPress={() => handleOpenMessageActions(item)}
            style={[
              styles.messageBubble,
              isCurrentUser ? styles.currentUserBubble : styles.otherUserBubble,
            ]}
          >
            {!!caption && <Text style={styles.messageText}>{caption}</Text>}

            {attachment?.type === "image" ? (
              <Image
                source={{ uri: attachment.url }}
                style={styles.messageImage}
                contentFit="cover"
                transition={200}
              />
            ) : null}

            {attachment?.type === "video" ? (
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

            <Text style={styles.messageTime}>{formatTime(item.created_at)}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const getFileExtension = (uri: string, fileName?: string | null, type?: "image" | "video") => {
    const nameSource = fileName || uri;
    const dotIndex = nameSource.lastIndexOf(".");
    if (dotIndex !== -1) {
      const ext = nameSource.slice(dotIndex + 1).toLowerCase();
      if (ext) return ext;
    }

    return type === "video" ? "mp4" : "jpg";
  };

  const getContentType = (ext: string, type: "image" | "video", mimeType?: string | null) => {
    if (mimeType) return mimeType;

    const imageMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
      gif: "image/gif",
    };

    const videoMap: Record<string, string> = {
      mp4: "video/mp4",
      mov: "video/quicktime",
      m4v: "video/x-m4v",
      webm: "video/webm",
    };

    return type === "video" ? videoMap[ext] || "video/mp4" : imageMap[ext] || "image/jpeg";
  };

  const uploadAttachment = useCallback(
    async (asset: ImagePicker.ImagePickerAsset): Promise<ChatAttachment> => {
      if (!currentUserId) {
        throw new Error("You must be logged in to send attachments.");
      }

      const mediaType: "image" | "video" = asset.type === "video" ? "video" : "image";
      const extension = getFileExtension(asset.uri, asset.fileName, mediaType);
      const contentType = getContentType(extension, mediaType, asset.mimeType);
      const bucket = mediaType === "video" ? "videos" : "images";

      const safeName = (asset.fileName || `chat_${Date.now()}.${extension}`).replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `chat/${currentUserId}/${Date.now()}_${safeName}`;

      const response = await fetch(asset.uri);
      if (!response.ok) {
        throw new Error("Failed to read selected file.");
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

  const sendAttachmentMessage = useCallback(
    async (attachment: ChatAttachment) => {
      if (authLoading) return;

      if (!currentUserId) {
        router.push("/signin");
        return;
      }

      const chatId = await ensureChatId();
      if (!chatId) return;

      const payload = `${ATTACHMENT_PREFIX}${JSON.stringify(attachment)}`;
      const tempId = `temp-attachment-${Date.now()}`;
      const nowIso = new Date().toISOString();

      setOptimistic((prev) => [
        ...prev,
        {
          id: tempId,
          chat_id: chatId,
          sender_id: currentUserId,
          text: payload,
          created_at: nowIso,
          _optimistic: true,
        },
      ]);
      scrollToBottom(true);

      try {
        const { error } = await supabase.from("messages").insert({
          chat_id: chatId,
          sender_id: currentUserId,
          text: payload,
        });

        if (error) throw error;

        setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
        await loadMessages(chatId);
      } catch (e: any) {
        setOptimistic((prev) => prev.filter((m) => m.id !== tempId));

        const msg = e?.message || "Unable to send attachment.";
        if (isPermissionError(msg)) {
          setFatalError(
            "Permission denied for messages insert. Fix Supabase RLS policy for messages insert (sender must be participant)."
          );
        } else {
          setFatalError(msg);
        }
      }
    },
    [authLoading, currentUserId, ensureChatId, loadMessages, router]
  );

  const handleSendMessage = async () => {
    if (authLoading) return;

    if (!currentUserId) {
      router.push("/signin");
      return;
    }

    const text = newMessage.trim();
    if (!text) return;

    if (editingMessageId) {
      try {
        const { error } = await supabase
          .from("messages")
          .update({ text })
          .eq("id", editingMessageId)
          .eq("sender_id", currentUserId);

        if (error) {
          throw error;
        }

        setMessages((prev) => prev.map((message) => (message.id === editingMessageId ? { ...message, text } : message)));
        const resolvedChatId = activeChatId || (await ensureChatId());
        closeEditMode();
        if (resolvedChatId) {
          await loadMessages(resolvedChatId);
        }
      } catch (e: any) {
        Alert.alert("Unable to update", e?.message || "Please try again.");
      }
      return;
    }

    const chatId = await ensureChatId();
    if (!chatId) return;

    const tempId = `temp-${Date.now()}`;
    const nowIso = new Date().toISOString();

    setOptimistic((prev) => [
      ...prev,
      { id: tempId, chat_id: chatId, sender_id: currentUserId, text, created_at: nowIso, _optimistic: true },
    ]);

    setNewMessage("");
    scrollToBottom(true);

    try {
      const { error } = await supabase.from("messages").insert({
        chat_id: chatId,
        sender_id: currentUserId,
        text,
      });

      if (error) throw error;

      setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
      await loadMessages(chatId);
    } catch (e: any) {
      setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
      setNewMessage(text);

      const msg = e?.message || "Unable to send message.";
      if (isPermissionError(msg)) {
        setFatalError(
          "Permission denied for messages insert. Fix Supabase RLS policy for messages insert (sender must be participant)."
        );
      } else {
        setFatalError(msg);
      }
    }
  };

  const handleAttachPress = async () => {
    if (uploadingAttachment) return;
    if (authLoading) return;

    if (!currentUserId) {
      router.push("/signin");
      return;
    }

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) return;

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
      await sendAttachmentMessage(uploaded);
    } catch (error: any) {
      Alert.alert("Attachment error", error?.message || "Unable to upload selected media.");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const inputBottomPadding = Math.max(insets.bottom, 10);
  const canSend =
    !!newMessage.trim() && !resolvingChat && !!currentUserId && !authLoading && !fatalError;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Image source={{ uri: otherAvatar }} style={styles.headerAvatar} contentFit="cover" />
              <View>
                <Text style={styles.headerUsername}>{otherDisplayName}</Text>
                {(resolvingChat || resolvingProfile) && (
                  <Text style={styles.headerSubtext}>
                    {resolvingChat ? "Opening chat..." : "Loading profile..."}
                  </Text>
                )}
              </View>
            </View>
          ),
          headerStyle: { backgroundColor: Colors.dark.background },
          headerShadowVisible: false,
        }}
      />

      {fatalError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{fatalError}</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight + insets.top : 0}
      >
        {loadingMessages && !mergedMessages.length ? (
          <View style={styles.loadingMessagesContainer}>
            <ActivityIndicator size="small" color={Colors.dark.primary} />
            <Text style={styles.loadingText}>Loading messages...</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={mergedMessages}
            renderItem={renderMessageItem}
            keyExtractor={(item) => item.id}
            initialNumToRender={18}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews={Platform.OS === "android"}
            contentContainerStyle={[
              styles.messagesList,
              { paddingBottom: 16 + 62 + inputBottomPadding },
            ]}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptyText}>Send a message to start the conversation.</Text>
              </View>
            }
          />
        )}

        <SafeAreaView edges={["bottom"]} style={styles.inputSafe}>
          <View style={[styles.inputContainer, { paddingBottom: inputBottomPadding }]}>
            {editingMessageId ? (
              <View style={styles.editingBanner}>
                <Text style={styles.editingBannerText}>Editing message</Text>
                <TouchableOpacity onPress={closeEditMode}>
                  <Text style={styles.editingCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.attachButton}
              onPress={handleAttachPress}
              activeOpacity={0.8}
              disabled={!currentUserId || !!fatalError || uploadingAttachment || !!editingMessageId}
            >
              {uploadingAttachment ? (
                <ActivityIndicator size="small" color={Colors.dark.subtext} />
              ) : (
                <Paperclip size={24} color={Colors.dark.subtext} />
              )}
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              placeholder={currentUserId ? `Message ${otherDisplayName}` : "Login to send messages"}
              placeholderTextColor={Colors.dark.subtext}
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
              editable={!!currentUserId && !fatalError}
              onFocus={() => setTimeout(() => scrollToBottom(true), 150)}
            />

            <TouchableOpacity
              style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
              onPress={handleSendMessage}
              disabled={!canSend}
              activeOpacity={0.8}
            >
              {resolvingChat ? (
                <ActivityIndicator size="small" color={Colors.dark.text} />
              ) : (
                <Send size={20} color={Colors.dark.text} />
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function ChatScreen() {
  const params = useLocalSearchParams<{ chatId?: string; type?: string }>();

  if (safeStr(params.type) === 'group' && safeStr(params.chatId)) {
    return <GroupChatScreen groupId={safeStr(params.chatId)} />;
  }

  return <DirectChatScreen />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.dark.background },
  container: { flex: 1, backgroundColor: Colors.dark.background },

  errorBanner: {
    backgroundColor: "rgba(255,0,0,0.12)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,0,0,0.25)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorBannerText: { color: Colors.dark.text, fontSize: 13, lineHeight: 18 },

  messagesList: { paddingVertical: 16, paddingHorizontal: 12 },

  dateHeaderContainer: { alignItems: "center", marginVertical: 12 },
  dateHeader: {
    fontSize: 14,
    color: Colors.dark.subtext,
    backgroundColor: Colors.dark.card,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },

  messageContainer: { flexDirection: "row", marginBottom: 14, maxWidth: "86%" },
  optimisticContainer: { opacity: 0.85 },
  currentUserMessage: { alignSelf: "flex-end" },
  otherUserMessage: { alignSelf: "flex-start" },

  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    alignSelf: "flex-end",
  },

  messageBubble: { padding: 12, borderRadius: 18, minWidth: 80 },
  currentUserBubble: { backgroundColor: Colors.dark.primary, borderBottomRightRadius: 4 },
  otherUserBubble: { backgroundColor: Colors.dark.card, borderBottomLeftRadius: 4 },

  messageText: { color: Colors.dark.text, fontSize: 16, marginBottom: 4 },
  messageImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: Colors.dark.background,
  },
  messageVideoWrap: {
    width: 220,
    height: 220,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 6,
    backgroundColor: Colors.dark.background,
  },
  messageVideo: {
    width: "100%",
    height: "100%",
  },
  messageTime: { fontSize: 12, color: Colors.dark.subtext, alignSelf: "flex-end" },

  inputSafe: { backgroundColor: Colors.dark.card },
  inputContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
  },

  attachButton: { marginRight: 8, paddingBottom: 6 },
  editingBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  editingBannerText: { color: Colors.dark.text, fontSize: 13, fontWeight: "600" },
  editingCancelText: { color: Colors.dark.primary, fontSize: 13, fontWeight: "700" },

  input: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    color: Colors.dark.text,
    maxHeight: 120,
  },

  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.dark.primary,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendButtonDisabled: { backgroundColor: Colors.dark.inactive },

  loadingMessagesContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 14, fontSize: 16, color: Colors.dark.text },

  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    marginTop: 100,
  },
  emptyTitle: { fontSize: 20, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
  emptyText: { fontSize: 16, color: Colors.dark.subtext, textAlign: "center", lineHeight: 24 },

  headerTitle: { flexDirection: "row", alignItems: "center" },
  headerAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  headerUsername: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text },
  headerSubtext: { fontSize: 12, color: Colors.dark.subtext, marginTop: 2 },
});











// import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   FlatList,
//   TextInput,
//   TouchableOpacity,
//   Platform,
//   ActivityIndicator,
//   KeyboardAvoidingView,
//   Alert,
// } from "react-native";
// import { Image } from "expo-image";
// import { Stack, useLocalSearchParams, useRouter } from "expo-router";
// import { useHeaderHeight } from "@react-navigation/elements";
// import { Send, Paperclip } from "lucide-react-native";
// import * as ImagePicker from "expo-image-picker";
// import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

// import Colors from "@/constants/colors";
// import { useChatStore } from "@/store/chat-store";
// import { supabase } from "@/lib/supabase";
// import { useAuth } from "@/lib/auth";

// type ProfileRow = {
//   id: string;
//   full_name: string | null;
//   username: string | null;
//   avatar_url: string | null;
// };

// type ChatRow = {
//   id: string;
//   user1_id: string;
//   user2_id: string;
// };

// type MessageRow = {
//   id: string;
//   chat_id: string;
//   sender_id: string;
//   text: string;
//   created_at: string;
//   _optimistic?: boolean;
// };

// export default function ChatScreen() {
//   const router = useRouter();

//   const params = useLocalSearchParams<{
//     chatId?: string;
//     userId?: string;
//     otherUserId?: string;
//     id?: string;
//     profileId?: string;
//     username?: string;
//     full_name?: string;
//     avatar_url?: string;
//   }>();

//   const { user: authUser, loading: authLoading } = useAuth();
//   const currentUserId = authUser?.id ?? null;

//   /**
//    * route: /chat/[chatId]
//    * Profile/Search pushes chatId="new" and other user id in params.
//    */
//   const rawChatId = (params.chatId as string | undefined) ?? null;
//   const chatIdParam = rawChatId && rawChatId !== "new" ? rawChatId : null;

//   const otherIdParam =
//     ((params.otherUserId ??
//       params.userId ??
//       params.profileId ??
//       params.id) as string | undefined) ?? null;

//   const {
//     messages,
//     fetchChats,
//     fetchMessages,
//     sendMessage,
//     isLoading,
//     setCurrentChatId,
//   } = useChatStore();

//   const headerHeight = useHeaderHeight();
//   const insets = useSafeAreaInsets();
//   const flatListRef = useRef<FlatList<MessageRow>>(null);

//   const [activeChatId, setActiveChatId] = useState<string | null>(null);

//   // show header info instantly (params), then refresh from DB
//   const [otherUser, setOtherUser] = useState<ProfileRow | null>(() => {
//     if (!otherIdParam) return null;
//     return {
//       id: otherIdParam,
//       full_name: (params.full_name as string) ?? null,
//       username: (params.username as string) ?? null,
//       avatar_url: (params.avatar_url as string) ?? null,
//     };
//   });

//   const [newMessage, setNewMessage] = useState("");
//   const [resolvingChat, setResolvingChat] = useState(false);
//   const [resolvingProfile, setResolvingProfile] = useState(false);

//   const [optimistic, setOptimistic] = useState<MessageRow[]>([]);

//   useEffect(() => {
//     fetchChats?.();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   const scrollToBottom = (animated = true) => {
//     requestAnimationFrame(() => {
//       flatListRef.current?.scrollToEnd({ animated });
//     });
//   };

//   const validateChatId = useCallback(async (maybeChatId: string | null) => {
//     if (!maybeChatId) return null;
//     try {
//       const { data, error } = await supabase
//         .from("chats")
//         .select("id")
//         .eq("id", maybeChatId)
//         .maybeSingle<{ id: string }>();

//       if (error) return null;
//       return data?.id ?? null;
//     } catch {
//       return null;
//     }
//   }, []);

//   const ensureChatId = useCallback(async (): Promise<string | null> => {
//     if (!currentUserId) return null;
//     if (activeChatId) return activeChatId;

//     // 1) if chatId passed, validate
//     if (chatIdParam) {
//       const valid = await validateChatId(chatIdParam);
//       if (valid) {
//         setActiveChatId(valid);
//         setCurrentChatId(valid);
//         fetchMessages(valid);
//         return valid;
//       }
//     }

//     // 2) resolve by other user id
//     if (!otherIdParam) return null;

//     if (otherIdParam === currentUserId) {
//       Alert.alert("Chat", "You cannot start a chat with yourself.");
//       return null;
//     }

//     setResolvingChat(true);
//     try {
//       const { data: found, error: findErr } = await supabase
//         .from("chats")
//         .select("id,user1_id,user2_id")
//         .or(
//           `and(user1_id.eq.${currentUserId},user2_id.eq.${otherIdParam}),and(user1_id.eq.${otherIdParam},user2_id.eq.${currentUserId})`
//         )
//         .limit(1)
//         .maybeSingle<ChatRow>();

//       if (findErr) throw findErr;

//       let resolvedId = found?.id ?? null;

//       if (!resolvedId) {
//         const { data: created, error: createErr } = await supabase
//           .from("chats")
//           .insert({ user1_id: currentUserId, user2_id: otherIdParam })
//           .select("id")
//           .single<{ id: string }>();

//         // If a race condition happens and row already exists, refetch
//         if (createErr) {
//           const { data: again } = await supabase
//             .from("chats")
//             .select("id,user1_id,user2_id")
//             .or(
//               `and(user1_id.eq.${currentUserId},user2_id.eq.${otherIdParam}),and(user1_id.eq.${otherIdParam},user2_id.eq.${currentUserId})`
//             )
//             .limit(1)
//             .maybeSingle<ChatRow>();
//           resolvedId = again?.id ?? null;
//         } else {
//           resolvedId = created.id;
//         }
//       }

//       if (resolvedId) {
//         setActiveChatId(resolvedId);
//         setCurrentChatId(resolvedId);
//         fetchMessages(resolvedId);
//       }

//       return resolvedId;
//     } catch (e: any) {
//       Alert.alert("Chat error", e?.message ?? "Unable to open chat.");
//       return null;
//     } finally {
//       setResolvingChat(false);
//     }
//   }, [
//     currentUserId,
//     activeChatId,
//     chatIdParam,
//     otherIdParam,
//     validateChatId,
//     setCurrentChatId,
//     fetchMessages,
//   ]);

//   // resolve chat ASAP when auth ready
//   useEffect(() => {
//     let mounted = true;

//     if (authLoading) return;

//     (async () => {
//       if (!mounted) return;
//       if (!currentUserId) return; // not logged in
//       await ensureChatId();
//     })();

//     return () => {
//       mounted = false;
//       setCurrentChatId(null);
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [authLoading, currentUserId, ensureChatId]);

//   // Load other user profile
//   useEffect(() => {
//     let cancelled = false;

//     const loadProfile = async () => {
//       if (authLoading) return;

//       if (otherIdParam) {
//         setResolvingProfile(true);
//         try {
//           const { data, error } = await supabase
//             .from("profiles")
//             .select("id,full_name,username,avatar_url")
//             .eq("id", otherIdParam)
//             .maybeSingle<ProfileRow>();

//           if (error) throw error;
//           if (!cancelled && data) setOtherUser(data);
//         } catch {
//           // keep placeholder
//         } finally {
//           if (!cancelled) setResolvingProfile(false);
//         }
//         return;
//       }

//       // else: opened by chatId only => resolve other user from chats table
//       if (!activeChatId || !currentUserId) return;

//       setResolvingProfile(true);
//       try {
//         const { data: chat, error } = await supabase
//           .from("chats")
//           .select("id,user1_id,user2_id")
//           .eq("id", activeChatId)
//           .single<ChatRow>();

//         if (error) throw error;

//         const otherId =
//           chat.user1_id === currentUserId ? chat.user2_id : chat.user1_id;

//         if (!cancelled) {
//           setOtherUser((prev) =>
//             prev ?? { id: otherId, full_name: null, username: null, avatar_url: null }
//           );
//         }

//         const { data: profile, error: pErr } = await supabase
//           .from("profiles")
//           .select("id,full_name,username,avatar_url")
//           .eq("id", otherId)
//           .maybeSingle<ProfileRow>();

//         if (pErr) throw pErr;
//         if (!cancelled && profile) setOtherUser(profile);
//       } catch {
//         // keep placeholder
//       } finally {
//         if (!cancelled) setResolvingProfile(false);
//       }
//     };

//     loadProfile();
//     return () => {
//       cancelled = true;
//     };
//   }, [authLoading, currentUserId, otherIdParam, activeChatId]);

//   const otherDisplayName =
//     otherUser?.full_name?.trim() ||
//     (otherUser?.username ? `@${otherUser.username}` : otherUser ? "User" : "Chat");

//   const otherAvatar =
//     otherUser?.avatar_url ||
//     "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61";

//   const storeMessages: MessageRow[] = useMemo(() => {
//     if (!activeChatId) return [];
//     const m = (messages as any)?.[activeChatId] ?? [];
//     return m.map((x: any) => ({
//       id: x.id,
//       chat_id: x.chat_id ?? x.chatId ?? activeChatId,
//       sender_id: x.sender_id ?? x.senderId,
//       text: x.text ?? "",
//       created_at: x.created_at ?? x.createdAt ?? new Date().toISOString(),
//     }));
//   }, [messages, activeChatId]);

//   const chatMessages: MessageRow[] = useMemo(() => {
//     const map = new Map<string, MessageRow>();
//     for (const msg of storeMessages) map.set(msg.id, msg);
//     for (const msg of optimistic) map.set(msg.id, msg);

//     return Array.from(map.values()).sort((a, b) => {
//       const ta = new Date(a.created_at).getTime();
//       const tb = new Date(b.created_at).getTime();
//       return ta - tb;
//     });
//   }, [storeMessages, optimistic]);

//   const formatTime = (dateString: string) => {
//     const date = new Date(dateString);
//     return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
//   };

//   const formatMessageDate = (dateString: string) => {
//     const date = new Date(dateString);
//     const today = new Date();
//     const yesterday = new Date(today);
//     yesterday.setDate(yesterday.getDate() - 1);

//     if (date.toDateString() === today.toDateString()) return "Today";
//     if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

//     return date.toLocaleDateString([], {
//       month: "short",
//       day: "numeric",
//       year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
//     });
//   };

//   const renderMessageItem = ({
//     item,
//     index,
//   }: {
//     item: MessageRow;
//     index: number;
//   }) => {
//     const isCurrentUser = item.sender_id === currentUserId;

//     const showDateHeader =
//       index === 0 ||
//       formatMessageDate(chatMessages[index - 1].created_at) !==
//         formatMessageDate(item.created_at);

//     return (
//       <>
//         {showDateHeader && (
//           <View style={styles.dateHeaderContainer}>
//             <Text style={styles.dateHeader}>
//               {formatMessageDate(item.created_at)}
//             </Text>
//           </View>
//         )}

//         <View
//           style={[
//             styles.messageContainer,
//             isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage,
//             item._optimistic ? styles.optimisticContainer : null,
//           ]}
//         >
//           {!isCurrentUser && (
//             <Image
//               source={{ uri: otherAvatar }}
//               style={styles.messageAvatar}
//               contentFit="cover"
//             />
//           )}

//           <View
//             style={[
//               styles.messageBubble,
//               isCurrentUser ? styles.currentUserBubble : styles.otherUserBubble,
//             ]}
//           >
//             <Text style={styles.messageText}>{item.text}</Text>
//             <Text style={styles.messageTime}>{formatTime(item.created_at)}</Text>
//           </View>
//         </View>
//       </>
//     );
//   };

//   const handleSendMessage = async () => {
//     if (authLoading) return;

//     if (!currentUserId) {
//       Alert.alert("Login required", "Please login to send messages.");
//       router.push("/signin");
//       return;
//     }

//     const text = newMessage.trim();
//     if (!text) return;

//     const chatId = await ensureChatId();
//     if (!chatId) {
//       Alert.alert("Chat not ready", "Unable to start chat. Please try again.");
//       return;
//     }

//     const tempId = `temp-${Date.now()}`;
//     const nowIso = new Date().toISOString();

//     setOptimistic((prev) => [
//       ...prev,
//       {
//         id: tempId,
//         chat_id: chatId,
//         sender_id: currentUserId,
//         text,
//         created_at: nowIso,
//         _optimistic: true,
//       },
//     ]);

//     setNewMessage("");
//     scrollToBottom(true);

//     try {
//       await sendMessage(chatId, text);
//       setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
//       fetchMessages(chatId);
//       scrollToBottom(true);
//     } catch (e: any) {
//       setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
//       setNewMessage(text);
//       Alert.alert("Send failed", e?.message ?? "Unable to send message.");
//     }
//   };

//   const handleAttachPress = async () => {
//     const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

//     if (!permissionResult.granted) {
//       Alert.alert("Permission required", "Please allow photo access.");
//       return;
//     }

//     const result = await ImagePicker.launchImageLibraryAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       quality: 1,
//     });

//     if (!result.canceled) {
//       console.log("Selected image:", result.assets[0].uri);
//       Alert.alert("Selected", "Image selected. Add upload logic next.");
//     }
//   };

//   const inputBottomPadding = Math.max(insets.bottom, 10);
//   const canSend =
//     !!newMessage.trim() && !resolvingChat && !!currentUserId && !authLoading;

//   return (
//     <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
//       <Stack.Screen
//         options={{
//           headerTitle: () => (
//             <View style={styles.headerTitle}>
//               <Image
//                 source={{ uri: otherAvatar }}
//                 style={styles.headerAvatar}
//                 contentFit="cover"
//               />
//               <View>
//                 <Text style={styles.headerUsername}>{otherDisplayName}</Text>
//                 {(resolvingChat || resolvingProfile) && (
//                   <Text style={styles.headerSubtext}>
//                     {resolvingChat ? "Opening chat..." : "Loading profile..."}
//                   </Text>
//                 )}
//               </View>
//             </View>
//           ),
//           headerStyle: { backgroundColor: Colors.dark.background },
//           headerShadowVisible: false,
//         }}
//       />

//       <KeyboardAvoidingView
//         style={styles.container}
//         behavior={Platform.OS === "ios" ? "padding" : "height"}
//         keyboardVerticalOffset={
//           Platform.OS === "ios" ? headerHeight + insets.top : 0
//         }
//       >
//         {isLoading && !chatMessages.length ? (
//           <View style={styles.loadingMessagesContainer}>
//             <ActivityIndicator size="small" color={Colors.dark.primary} />
//             <Text style={styles.loadingText}>Loading messages...</Text>
//           </View>
//         ) : (
//           <FlatList
//             ref={flatListRef}
//             data={chatMessages}
//             renderItem={renderMessageItem}
//             keyExtractor={(item) => item.id}
//             contentContainerStyle={[
//               styles.messagesList,
//               { paddingBottom: 16 + 62 + inputBottomPadding },
//             ]}
//             onLayout={() => scrollToBottom(false)}
//             onContentSizeChange={() => scrollToBottom(false)}
//             keyboardShouldPersistTaps="handled"
//             ListEmptyComponent={
//               <View style={styles.emptyContainer}>
//                 <Text style={styles.emptyTitle}>No messages yet</Text>
//                 <Text style={styles.emptyText}>
//                   Send a message to start the conversation.
//                 </Text>
//               </View>
//             }
//           />
//         )}

//         <SafeAreaView edges={["bottom"]} style={styles.inputSafe}>
//           <View style={[styles.inputContainer, { paddingBottom: inputBottomPadding }]}>
//             <TouchableOpacity
//               style={styles.attachButton}
//               onPress={handleAttachPress}
//               activeOpacity={0.8}
//               disabled={!currentUserId}
//             >
//               <Paperclip size={24} color={Colors.dark.subtext} />
//             </TouchableOpacity>

//             <TextInput
//               style={styles.input}
//               placeholder={
//                 currentUserId
//                   ? `Message ${otherDisplayName}`
//                   : "Login to send messages"
//               }
//               placeholderTextColor={Colors.dark.subtext}
//               value={newMessage}
//               onChangeText={setNewMessage}
//               multiline
//               editable={!!currentUserId}
//               onFocus={() => setTimeout(() => scrollToBottom(true), 150)}
//             />

//             <TouchableOpacity
//               style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
//               onPress={handleSendMessage}
//               disabled={!canSend}
//               activeOpacity={0.8}
//             >
//               {resolvingChat ? (
//                 <ActivityIndicator size="small" color={Colors.dark.text} />
//               ) : (
//                 <Send size={20} color={Colors.dark.text} />
//               )}
//             </TouchableOpacity>
//           </View>
//         </SafeAreaView>
//       </KeyboardAvoidingView>
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   safe: { flex: 1, backgroundColor: Colors.dark.background },
//   container: { flex: 1, backgroundColor: Colors.dark.background },

//   messagesList: {
//     paddingVertical: 16,
//     paddingHorizontal: 12,
//   },

//   dateHeaderContainer: { alignItems: "center", marginVertical: 12 },
//   dateHeader: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     backgroundColor: Colors.dark.card,
//     paddingHorizontal: 12,
//     paddingVertical: 4,
//     borderRadius: 12,
//   },

//   messageContainer: {
//     flexDirection: "row",
//     marginBottom: 14,
//     maxWidth: "86%",
//   },
//   optimisticContainer: { opacity: 0.85 },
//   currentUserMessage: { alignSelf: "flex-end" },
//   otherUserMessage: { alignSelf: "flex-start" },

//   messageAvatar: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     marginRight: 8,
//     alignSelf: "flex-end",
//   },

//   messageBubble: { padding: 12, borderRadius: 18, minWidth: 80 },
//   currentUserBubble: {
//     backgroundColor: Colors.dark.primary,
//     borderBottomRightRadius: 4,
//   },
//   otherUserBubble: {
//     backgroundColor: Colors.dark.card,
//     borderBottomLeftRadius: 4,
//   },

//   messageText: { color: Colors.dark.text, fontSize: 16, marginBottom: 4 },
//   messageTime: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//     alignSelf: "flex-end",
//   },

//   inputSafe: { backgroundColor: Colors.dark.card },

//   inputContainer: {
//     flexDirection: "row",
//     alignItems: "flex-end",
//     paddingHorizontal: 12,
//     paddingTop: 10,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     backgroundColor: Colors.dark.card,
//   },

//   attachButton: { marginRight: 8, paddingBottom: 6 },

//   input: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 20,
//     paddingHorizontal: 16,
//     paddingTop: 10,
//     paddingBottom: 10,
//     color: Colors.dark.text,
//     maxHeight: 120,
//   },

//   sendButton: {
//     width: 42,
//     height: 42,
//     borderRadius: 21,
//     backgroundColor: Colors.dark.primary,
//     justifyContent: "center",
//     alignItems: "center",
//     marginLeft: 8,
//   },
//   sendButtonDisabled: { backgroundColor: Colors.dark.inactive },

//   loadingMessagesContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   loadingText: { marginTop: 14, fontSize: 16, color: Colors.dark.text },

//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 32,
//     marginTop: 100,
//   },
//   emptyTitle: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   emptyText: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     lineHeight: 24,
//   },

//   headerTitle: { flexDirection: "row", alignItems: "center" },
//   headerAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
//   headerUsername: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text },
//   headerSubtext: { fontSize: 12, color: Colors.dark.subtext, marginTop: 2 },
// });













// import React, { useEffect, useMemo, useRef, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   FlatList,
//   TextInput,
//   TouchableOpacity,
//   Platform,
//   ActivityIndicator,
//   KeyboardAvoidingView,
//   Alert,
//   SafeAreaView,
// } from "react-native";
// import { Image } from "expo-image";
// import { Stack, useLocalSearchParams } from "expo-router";
// import { useHeaderHeight } from "@react-navigation/elements";
// import { Send, Paperclip } from "lucide-react-native";
// import * as ImagePicker from "expo-image-picker";

// import Colors from "@/constants/colors";
// import { useChatStore } from "@/store/chat-store";
// import { useAuthStore } from "@/store/auth-store";
// import { supabase } from "@/lib/supabase";

// type ProfileRow = {
//   id: string;
//   full_name: string | null;
//   username: string | null;
//   avatar_url: string | null;
// };

// type ChatRow = {
//   id: string;
//   user1_id: string;
//   user2_id: string;
// };

// type MessageRow = {
//   id: string;
//   chat_id: string;
//   sender_id: string;
//   text: string;
//   created_at: string;
// };

// export default function ChatScreen() {
//   // Support multiple param names (because Search/Profile screens often differ)
//   const params = useLocalSearchParams<{
//     chatId?: string;
//     userId?: string;
//     id?: string; // fallback
//     profileId?: string; // fallback
//     username?: string;
//     full_name?: string;
//     avatar_url?: string;
//   }>();

//   const chatIdParam = params.chatId ?? null;
//   const otherIdParam = (params.userId ?? params.profileId ?? params.id ?? null) as
//     | string
//     | null;

//   const { user } = useAuthStore();
//   const {
//     messages,
//     fetchChats,
//     fetchMessages,
//     sendMessage,
//     isLoading,
//     setCurrentChatId,
//   } = useChatStore();

//   const headerHeight = useHeaderHeight();
//   const flatListRef = useRef<FlatList<MessageRow>>(null);

//   const [activeChatId, setActiveChatId] = useState<string | null>(chatIdParam);
//   const [otherUser, setOtherUser] = useState<ProfileRow | null>(null);
//   const [newMessage, setNewMessage] = useState("");

//   // Always make sure chats exist in store (some apps need this first)
//   useEffect(() => {
//     fetchChats?.();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // Resolve/Create chatId if we only have other userId (from Search)
//   useEffect(() => {
//     let cancelled = false;

//     const resolve = async () => {
//       if (!user?.id) return;

//       // If direct chatId passed, use it
//       if (chatIdParam) {
//         if (cancelled) return;
//         setActiveChatId(chatIdParam);
//         setCurrentChatId(chatIdParam);
//         fetchMessages(chatIdParam);
//         return;
//       }

//       // If userId passed, create/find chat with that user
//       if (!otherIdParam) {
//         // No chatId and no userId => cannot resolve
//         return;
//       }

//       if (otherIdParam === user.id) {
//         Alert.alert("Chat", "You cannot start a chat with yourself.");
//         return;
//       }

//       try {
//         // 1) Try to find existing chat
//         const { data: found, error: findErr } = await supabase
//           .from("chats")
//           .select("id,user1_id,user2_id")
//           .or(
//             `and(user1_id.eq.${user.id},user2_id.eq.${otherIdParam}),and(user1_id.eq.${otherIdParam},user2_id.eq.${user.id})`
//           )
//           .limit(1)
//           .maybeSingle<ChatRow>();

//         if (findErr) throw findErr;

//         let resolvedChatId = found?.id;

//         // 2) Create if not found
//         if (!resolvedChatId) {
//           const { data: created, error: createErr } = await supabase
//             .from("chats")
//             .insert({ user1_id: user.id, user2_id: otherIdParam })
//             .select("id")
//             .single<{ id: string }>();

//           if (createErr) throw createErr;
//           resolvedChatId = created.id;
//         }

//         if (cancelled) return;

//         setActiveChatId(resolvedChatId);
//         setCurrentChatId(resolvedChatId);
//         fetchMessages(resolvedChatId);
//       } catch (e: any) {
//         Alert.alert("Chat error", e?.message ?? "Unable to open chat.");
//       }
//     };

//     resolve();

//     return () => {
//       cancelled = true;
//       setCurrentChatId(null);
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [chatIdParam, otherIdParam, user?.id]);

//   // Load other user profile (don’t block UI forever if it fails)
//   useEffect(() => {
//     let cancelled = false;

//     const loadProfile = async () => {
//       if (!user?.id) return;

//       // If we have other user id from params, use it
//       if (otherIdParam) {
//         // quick placeholder so UI never gets stuck on "Loading conversation..."
//         setOtherUser((prev) => {
//           if (prev?.id) return prev;
//           return {
//             id: otherIdParam,
//             full_name: (params.full_name as string) ?? null,
//             username: (params.username as string) ?? null,
//             avatar_url: (params.avatar_url as string) ?? null,
//           };
//         });

//         try {
//           const { data, error } = await supabase
//             .from("profiles")
//             .select("id,full_name,username,avatar_url")
//             .eq("id", otherIdParam)
//             .maybeSingle<ProfileRow>();

//           if (error) throw error;

//           if (!cancelled) {
//             if (data) setOtherUser(data);
//             else {
//               // keep placeholder
//               setOtherUser((prev) =>
//                 prev ?? {
//                   id: otherIdParam,
//                   full_name: null,
//                   username: "User",
//                   avatar_url: null,
//                 }
//               );
//             }
//           }
//         } catch {
//           if (!cancelled) {
//             setOtherUser((prev) =>
//               prev ?? {
//                 id: otherIdParam,
//                 full_name: null,
//                 username: "User",
//                 avatar_url: null,
//               }
//             );
//           }
//         }
//         return;
//       }

//       // Else: we only have chatId, resolve other user id from chats table
//       if (!activeChatId) return;

//       try {
//         const { data: chat, error } = await supabase
//           .from("chats")
//           .select("id,user1_id,user2_id")
//           .eq("id", activeChatId)
//           .single<ChatRow>();

//         if (error) throw error;

//         const otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;

//         setOtherUser({
//           id: otherId,
//           full_name: null,
//           username: null,
//           avatar_url: null,
//         });

//         const { data: profile, error: pErr } = await supabase
//           .from("profiles")
//           .select("id,full_name,username,avatar_url")
//           .eq("id", otherId)
//           .maybeSingle<ProfileRow>();

//         if (pErr) throw pErr;

//         if (!cancelled) {
//           if (profile) setOtherUser(profile);
//         }
//       } catch {
//         // keep whatever placeholder we have
//       }
//     };

//     loadProfile();
//     return () => {
//       cancelled = true;
//     };
//   }, [activeChatId, otherIdParam, user?.id]);

//   const chatMessages: MessageRow[] = useMemo(() => {
//     if (!activeChatId) return [];
//     const m = (messages as any)?.[activeChatId] ?? [];
//     return m.map((x: any) => ({
//       id: x.id,
//       chat_id: x.chat_id ?? x.chatId ?? activeChatId,
//       sender_id: x.sender_id ?? x.senderId,
//       text: x.text ?? "",
//       created_at: x.created_at ?? x.createdAt ?? new Date().toISOString(),
//     }));
//   }, [messages, activeChatId]);

//   const otherDisplayName =
//     otherUser?.full_name?.trim() ||
//     (otherUser?.username ? `@${otherUser.username}` : "User");

//   const otherAvatar =
//     otherUser?.avatar_url ||
//     "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61";

//   const formatTime = (dateString: string) => {
//     const date = new Date(dateString);
//     return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
//   };

//   const formatMessageDate = (dateString: string) => {
//     const date = new Date(dateString);
//     const today = new Date();
//     const yesterday = new Date(today);
//     yesterday.setDate(yesterday.getDate() - 1);

//     if (date.toDateString() === today.toDateString()) return "Today";
//     if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

//     return date.toLocaleDateString([], {
//       month: "short",
//       day: "numeric",
//       year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
//     });
//   };

//   const scrollToBottom = (animated = true) => {
//     requestAnimationFrame(() => {
//       flatListRef.current?.scrollToEnd({ animated });
//     });
//   };

//   const renderMessageItem = ({
//     item,
//     index,
//   }: {
//     item: MessageRow;
//     index: number;
//   }) => {
//     const isCurrentUser = item.sender_id === user?.id;

//     const showDateHeader =
//       index === 0 ||
//       formatMessageDate(chatMessages[index - 1].created_at) !==
//         formatMessageDate(item.created_at);

//     return (
//       <>
//         {showDateHeader && (
//           <View style={styles.dateHeaderContainer}>
//             <Text style={styles.dateHeader}>
//               {formatMessageDate(item.created_at)}
//             </Text>
//           </View>
//         )}

//         <View
//           style={[
//             styles.messageContainer,
//             isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage,
//           ]}
//         >
//           {!isCurrentUser && (
//             <Image
//               source={{ uri: otherAvatar }}
//               style={styles.messageAvatar}
//               contentFit="cover"
//             />
//           )}

//           <View
//             style={[
//               styles.messageBubble,
//               isCurrentUser ? styles.currentUserBubble : styles.otherUserBubble,
//             ]}
//           >
//             <Text style={styles.messageText}>{item.text}</Text>
//             <Text style={styles.messageTime}>{formatTime(item.created_at)}</Text>
//           </View>
//         </View>
//       </>
//     );
//   };

//   const handleSendMessage = async () => {
//     if (!user?.id) {
//       Alert.alert("Login required", "Please login to send messages.");
//       return;
//     }
//     if (!activeChatId) {
//       Alert.alert("Chat not ready", "Chat is still initializing. Try again.");
//       return;
//     }

//     const text = newMessage.trim();
//     if (!text) return;

//     try {
//       await sendMessage(activeChatId, text);
//       setNewMessage("");
//       scrollToBottom(true);
//     } catch (e: any) {
//       Alert.alert("Send failed", e?.message ?? "Unable to send message.");
//     }
//   };

//   const handleAttachPress = async () => {
//     const permissionResult =
//       await ImagePicker.requestMediaLibraryPermissionsAsync();

//     if (!permissionResult.granted) {
//       Alert.alert("Permission required", "Please allow photo access.");
//       return;
//     }

//     const result = await ImagePicker.launchImageLibraryAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       quality: 1,
//     });

//     if (!result.canceled) {
//       console.log("Selected image:", result.assets[0].uri);
//       Alert.alert("Selected", "Image selected. Add upload logic next.");
//     }
//   };

//   // ✅ IMPORTANT FIX:
//   // Don’t block screen forever waiting for `otherUser`.
//   const isReady = !!user?.id && !!activeChatId;

//   if (!isReady) {
//     return (
//       <View style={styles.loadingContainer}>
//         <ActivityIndicator size="large" color={Colors.dark.primary} />
//         <Text style={styles.loadingText}>Loading conversation...</Text>
//       </View>
//     );
//   }

//   return (
//     <SafeAreaView style={{ flex: 1, backgroundColor: Colors.dark.background }}>
//       <Stack.Screen
//         options={{
//           headerTitle: () => (
//             <View style={styles.headerTitle}>
//               <Image
//                 source={{ uri: otherAvatar }}
//                 style={styles.headerAvatar}
//                 contentFit="cover"
//               />
//               <Text style={styles.headerUsername}>{otherDisplayName}</Text>
//             </View>
//           ),
//           headerStyle: { backgroundColor: Colors.dark.background },
//           headerShadowVisible: false,
//         }}
//       />

//       <KeyboardAvoidingView
//         style={{ flex: 1 }}
//         behavior={Platform.OS === "ios" ? "padding" : undefined}
//         keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
//       >
//         {isLoading && !chatMessages.length ? (
//           <View style={styles.loadingMessagesContainer}>
//             <ActivityIndicator size="small" color={Colors.dark.primary} />
//             <Text style={styles.loadingText}>Loading messages...</Text>
//           </View>
//         ) : (
//           <FlatList
//             ref={flatListRef}
//             data={chatMessages}
//             renderItem={renderMessageItem}
//             keyExtractor={(item) => item.id}
//             contentContainerStyle={styles.messagesList}
//             onLayout={() => scrollToBottom(false)}
//             onContentSizeChange={() => scrollToBottom(false)}
//             keyboardShouldPersistTaps="handled"
//             ListEmptyComponent={
//               <View style={styles.emptyContainer}>
//                 <Text style={styles.emptyTitle}>No messages yet</Text>
//                 <Text style={styles.emptyText}>
//                   Send a message to start the conversation.
//                 </Text>
//               </View>
//             }
//           />
//         )}

//         {/* ✅ Bottom message box always visible */}
//         <View style={styles.inputContainer}>
//           <TouchableOpacity
//             style={styles.attachButton}
//             onPress={handleAttachPress}
//             activeOpacity={0.8}
//           >
//             <Paperclip size={24} color={Colors.dark.subtext} />
//           </TouchableOpacity>

//           <TextInput
//             style={styles.input}
//             placeholder={`Message ${otherDisplayName}`}
//             placeholderTextColor={Colors.dark.subtext}
//             value={newMessage}
//             onChangeText={setNewMessage}
//             multiline
//             onFocus={() => setTimeout(() => scrollToBottom(true), 150)}
//           />

//           <TouchableOpacity
//             style={[
//               styles.sendButton,
//               !newMessage.trim() && styles.sendButtonDisabled,
//             ]}
//             onPress={handleSendMessage}
//             disabled={!newMessage.trim()}
//             activeOpacity={0.8}
//           >
//             <Send size={20} color={Colors.dark.text} />
//           </TouchableOpacity>
//         </View>
//       </KeyboardAvoidingView>
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   messagesList: {
//     paddingVertical: 16,
//     paddingHorizontal: 12,
//     paddingBottom: 16,
//   },

//   dateHeaderContainer: { alignItems: "center", marginVertical: 12 },
//   dateHeader: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     backgroundColor: Colors.dark.card,
//     paddingHorizontal: 12,
//     paddingVertical: 4,
//     borderRadius: 12,
//   },

//   messageContainer: {
//     flexDirection: "row",
//     marginBottom: 14,
//     maxWidth: "86%",
//   },
//   currentUserMessage: { alignSelf: "flex-end" },
//   otherUserMessage: { alignSelf: "flex-start" },

//   messageAvatar: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     marginRight: 8,
//     alignSelf: "flex-end",
//   },

//   messageBubble: {
//     padding: 12,
//     borderRadius: 18,
//     minWidth: 80,
//   },
//   currentUserBubble: {
//     backgroundColor: Colors.dark.primary,
//     borderBottomRightRadius: 4,
//   },
//   otherUserBubble: {
//     backgroundColor: Colors.dark.card,
//     borderBottomLeftRadius: 4,
//   },

//   messageText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     marginBottom: 4,
//   },
//   messageTime: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//     alignSelf: "flex-end",
//   },

//   inputContainer: {
//     flexDirection: "row",
//     alignItems: "flex-end",
//     paddingHorizontal: 12,
//     paddingTop: 10,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     backgroundColor: Colors.dark.card,
//     paddingBottom: Platform.OS === "ios" ? 18 : 12,
//   },
//   attachButton: { marginRight: 8, paddingBottom: 6 },

//   input: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 20,
//     paddingHorizontal: 16,
//     paddingTop: 10,
//     paddingBottom: 10,
//     color: Colors.dark.text,
//     maxHeight: 120,
//   },

//   sendButton: {
//     width: 42,
//     height: 42,
//     borderRadius: 21,
//     backgroundColor: Colors.dark.primary,
//     justifyContent: "center",
//     alignItems: "center",
//     marginLeft: 8,
//   },
//   sendButtonDisabled: { backgroundColor: Colors.dark.inactive },

//   loadingContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.background,
//   },
//   loadingMessagesContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   loadingText: { marginTop: 14, fontSize: 16, color: Colors.dark.text },

//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 32,
//     marginTop: 100,
//   },
//   emptyTitle: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   emptyText: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     lineHeight: 24,
//   },

//   headerTitle: { flexDirection: "row", alignItems: "center" },
//   headerAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
//   headerUsername: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text },
// });











// import React, { useState, useEffect, useRef } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   FlatList,
//   TextInput,
//   TouchableOpacity,
//   Platform,
//   ActivityIndicator,
//   KeyboardAvoidingView,
// } from "react-native";
// import { Image } from "expo-image";
// import { useLocalSearchParams, Stack } from "expo-router";
// import { Send, Paperclip } from "lucide-react-native";
// import { useChatStore } from "@/store/chat-store";
// import { useAuthStore } from "@/store/auth-store";
// import Colors from "@/constants/colors";
// import { Message } from "@/types";
// import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
// import * as ImagePicker from "expo-image-picker";
// import { useNavigation } from "expo-router";

// export default function ChatScreen() {
//   const { chatId } = useLocalSearchParams<{ chatId: string }>();
//   const { user } = useAuthStore();
//   const {
//     chats,
//     messages,
//     fetchChats,
//     fetchMessages,
//     sendMessage,
//     isLoading,
//     setCurrentChatId,
//   } = useChatStore();
//   const [newMessage, setNewMessage] = useState("");
//   const flatListRef = useRef<FlatList>(null);
//   const navigation = useNavigation();

//   useEffect(() => {
//     if (Platform.OS === "android") {
//       navigation.setOptions({
//         windowSoftInputMode: "adjustResize",
//       });
//     }
//   }, []);

//   const currentChat = chats.find((chat) => chat.id === chatId);

//   const getOtherParticipant = () => {
//     if (!currentChat || !user) return null;
//     const otherUserId = currentChat.participants.find((id) => id !== user.id);
//     const mockUsers = {
//       "1": {
//         id: "1",
//         displayName: "Club Vibes",
//         avatar: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61",
//       },
//       "2": {
//         id: "2",
//         displayName: "Music Lover",
//         avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330",
//       },
//       "3": {
//         id: "3",
//         displayName: "DJ Max",
//         avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d",
//       },
//     };
//     return otherUserId
//       ? mockUsers[otherUserId as keyof typeof mockUsers]
//       : null;
//   };

//   const otherUser = getOtherParticipant();

//   useEffect(() => {
//     if (!chats.length) fetchChats();
//     if (chatId) {
//       fetchMessages(chatId);
//       setCurrentChatId(chatId);
//     }
//     return () => setCurrentChatId(null);
//   }, [chatId]);

//   const handleSendMessage = () => {
//     if (newMessage.trim() && chatId) {
//       sendMessage(chatId, newMessage.trim());
//       setNewMessage("");
//       setTimeout(() => {
//         flatListRef.current?.scrollToEnd({ animated: true });
//       }, 100);
//     }
//   };

//   const formatTime = (dateString: string) => {
//     const date = new Date(dateString);
//     return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
//   };

//   const formatMessageDate = (dateString: string) => {
//     const date = new Date(dateString);
//     const today = new Date();
//     const yesterday = new Date(today);
//     yesterday.setDate(yesterday.getDate() - 1);
//     if (date.toDateString() === today.toDateString()) return "Today";
//     if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
//     return date.toLocaleDateString([], {
//       month: "short",
//       day: "numeric",
//       year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
//     });
//   };

//   const renderMessageItem = ({
//     item,
//     index,
//   }: {
//     item: Message;
//     index: number;
//   }) => {
//     const isCurrentUser = item.senderId === user?.id;
//     const chatMessages = messages[chatId] || [];
//     const showDateHeader =
//       index === 0 ||
//       formatMessageDate(chatMessages[index - 1].createdAt) !==
//         formatMessageDate(item.createdAt);
//     return (
//       <>
//         {showDateHeader && (
//           <View style={styles.dateHeaderContainer}>
//             <Text style={styles.dateHeader}>
//               {formatMessageDate(item.createdAt)}
//             </Text>
//           </View>
//         )}
//         <View
//           style={[
//             styles.messageContainer,
//             isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage,
//           ]}
//         >
//           {!isCurrentUser && (
//             <Image
//               source={{ uri: otherUser?.avatar }}
//               style={styles.messageAvatar}
//               contentFit="cover"
//             />
//           )}
//           <View
//             style={[
//               styles.messageBubble,
//               isCurrentUser ? styles.currentUserBubble : styles.otherUserBubble,
//             ]}
//           >
//             <Text style={styles.messageText}>{item.text}</Text>
//             <Text style={styles.messageTime}>{formatTime(item.createdAt)}</Text>
//           </View>
//         </View>
//       </>
//     );
//   };

//   // 📎 Handle Image Picking Only
//   const handleAttachPress = async () => {
//     const permissionResult =
//       await ImagePicker.requestMediaLibraryPermissionsAsync();
//     if (!permissionResult.granted) {
//       alert("Permission to access camera roll is required!");
//       return;
//     }
//     const result = await ImagePicker.launchImageLibraryAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Images,
//       allowsEditing: true,
//       quality: 1,
//     });
//     if (!result.canceled) {
//       console.log("Selected image:", result.assets[0].uri);
//       // Upload/send image logic here
//     }
//   };

//   if (!currentChat || !otherUser) {
//     return (
//       <View style={styles.loadingContainer}>
//         <ActivityIndicator size="large" color={Colors.dark.primary} />
//         <Text style={styles.loadingText}>Loading conversation...</Text>
//       </View>
//     );
//   }

//   return (
//     <>
//       <Stack.Screen
//         options={{
//           headerTitle: () => (
//             <View style={styles.headerTitle}>
//               <Image
//                 source={{ uri: otherUser.avatar }}
//                 style={styles.headerAvatar}
//                 contentFit="cover"
//               />
//               <Text style={styles.headerUsername}>{otherUser.displayName}</Text>
//             </View>
//           ),
//           headerStyle: { backgroundColor: Colors.dark.background },
//           headerShadowVisible: false,
//         }}
//       />

//       <KeyboardAvoidingView
//         style={{ flex: 1 }}
//         behavior={Platform.OS === "ios" ? "padding" : undefined}
//         keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 90}
//       >
//         {isLoading && !messages[chatId] ? (
//           <View style={styles.loadingMessagesContainer}>
//             <ActivityIndicator size="small" color={Colors.dark.primary} />
//             <Text style={styles.loadingText}>Loading messages...</Text>
//           </View>
//         ) : (
//           <FlatList
//             ref={flatListRef}
//             data={messages[chatId] || []}
//             renderItem={renderMessageItem}
//             keyExtractor={(item) => item.id}
//             contentContainerStyle={styles.messagesList}
//             onLayout={() =>
//               flatListRef.current?.scrollToEnd({ animated: false })
//             }
//             onContentSizeChange={() =>
//               flatListRef.current?.scrollToEnd({ animated: false })
//             }
//             ListEmptyComponent={
//               <View style={styles.emptyContainer}>
//                 <Text style={styles.emptyTitle}>No messages yet</Text>
//                 <Text style={styles.emptyText}>
//                   Send a message to start the conversation.
//                 </Text>
//               </View>
//             }
//           />
//         )}

//         <View style={styles.inputContainer}>
//           <TouchableOpacity
//             style={styles.attachButton}
//             onPress={handleAttachPress}
//           >
//             <Paperclip size={24} color={Colors.dark.subtext} />
//           </TouchableOpacity>
//           <TextInput
//             style={styles.input}
//             placeholder="Type a message..."
//             placeholderTextColor={Colors.dark.subtext}
//             value={newMessage}
//             onChangeText={setNewMessage}
//             multiline
//           />
//           <TouchableOpacity
//             style={[
//               styles.sendButton,
//               !newMessage.trim() && styles.sendButtonDisabled,
//             ]}
//             onPress={handleSendMessage}
//             disabled={!newMessage.trim()}
//           >
//             <Send size={20} color={Colors.dark.text} />
//           </TouchableOpacity>
//         </View>
//       </KeyboardAvoidingView>
//     </>
//   );
// }

// const styles = StyleSheet.create({
//   messagesList: { paddingVertical: 16, paddingHorizontal: 12 },
//   dateHeaderContainer: { alignItems: "center", marginVertical: 16 },
//   dateHeader: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     backgroundColor: Colors.dark.card,
//     paddingHorizontal: 12,
//     paddingVertical: 4,
//     borderRadius: 12,
//   },
//   messageContainer: { flexDirection: "row", marginBottom: 16, maxWidth: "80%" },
//   currentUserMessage: { alignSelf: "flex-end" },
//   otherUserMessage: { alignSelf: "flex-start" },
//   messageAvatar: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     marginRight: 8,
//     alignSelf: "flex-end",
//   },
//   messageBubble: { padding: 12, borderRadius: 18, minWidth: 80 },
//   currentUserBubble: {
//     backgroundColor: Colors.dark.primary,
//     borderBottomRightRadius: 4,
//   },
//   otherUserBubble: {
//     backgroundColor: Colors.dark.card,
//     borderBottomLeftRadius: 4,
//   },
//   messageText: { color: Colors.dark.text, fontSize: 16, marginBottom: 4 },
//   messageTime: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//     alignSelf: "flex-end",
//   },
//   inputContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     padding: 12,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     backgroundColor: Colors.dark.card,
//    paddingBottom: Platform.OS === "ios" ? 30 : 12,
//   },
//   attachButton: { marginRight: 8 },
//   input: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 20,
//     paddingHorizontal: 16,
//     paddingVertical: 10,
//     color: Colors.dark.text,
//     maxHeight: 100,
//   },
//   sendButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.primary,
//     justifyContent: "center",
//     alignItems: "center",
//     marginLeft: 8,
//   },
//   sendButtonDisabled: { backgroundColor: Colors.dark.inactive },
//   loadingContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.background,
//   },
//   loadingMessagesContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   loadingText: { marginTop: 16, fontSize: 16, color: Colors.dark.text },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 32,
//     marginTop: 100,
//   },
//   emptyTitle: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   emptyText: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     lineHeight: 24,
//   },
//   headerTitle: { flexDirection: "row", alignItems: "center" },
//   headerAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
//   headerUsername: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text },
// });
