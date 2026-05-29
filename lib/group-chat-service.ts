import { supabase } from '@/lib/supabase';

const GROUP_COLORS = ['#6366F1', '#10B981', '#F43F5E', '#F59E0B', '#3B82F6', '#8B5CF6'];

export type GroupChatRole = 'owner' | 'admin' | 'member';
export type GroupMessageType = 'text' | 'video' | 'event';

export interface GroupChatProfile {
  id: string;
  fullName: string;
  username: string;
  avatarUrl?: string | null;
  isBusinessAccount?: boolean;
}

export interface GroupChatMember extends GroupChatProfile {
  role: GroupChatRole;
  joinedAt: string;
  lastReadAt?: string | null;
}

export interface GroupChatListItem {
  id: string;
  name: string;
  avatarColor: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  unreadCount: number;
  lastMessage?: GroupChatMessage | null;
}

export interface GroupChatDetails extends GroupChatListItem {
  members: GroupChatMember[];
}

export interface GroupSharedVideo {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  description?: string | null;
  eventName?: string | null;
  createdAt?: string | null;
}

export interface GroupSharedEvent {
  id: string;
  eventName: string;
  description?: string | null;
  imageUrl?: string | null;
  startDate: string;
  locationName?: string | null;
  ticketPrice?: number | null;
  currency?: string | null;
}

export interface GroupChatMessage {
  id: string;
  groupId: string;
  sender: GroupChatProfile;
  type: GroupMessageType;
  text?: string | null;
  video?: GroupSharedVideo | null;
  event?: GroupSharedEvent | null;
  createdAt: string;
}

type GroupChatRelation = {
  id: string;
  name: string;
  avatar_color: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ProfileRelation = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  user_type: string | null;
};

type VideoRelation = {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  description: string | null;
  event_name: string | null;
  created_at: string | null;
};

type EventRelation = {
  id: string;
  event_name: string;
  description: string | null;
  image_url: string | null;
  start_date: string;
  location_name: string | null;
  ticket_price: number | null;
  currency: string | null;
};

type RelationValue<T> = T | T[] | null;

type GroupMembershipRow = {
  group_chat_id: string;
  role: GroupChatRole;
  joined_at: string;
  last_read_at: string | null;
  group_chats: RelationValue<GroupChatRelation>;
};

type GroupMemberRow = {
  group_chat_id: string;
  role: GroupChatRole;
  joined_at: string;
  last_read_at: string | null;
  profiles: RelationValue<ProfileRelation>;
};

type GroupMessageRow = {
  id: string;
  group_chat_id: string;
  sender_id: string;
  message_type: GroupMessageType;
  text: string | null;
  created_at: string;
  sender: RelationValue<ProfileRelation>;
  video: RelationValue<VideoRelation>;
  event: RelationValue<EventRelation>;
};

function pickRelationRow<T>(value: RelationValue<T> | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function toProfile(row: ProfileRelation): GroupChatProfile {
  return {
    id: row.id,
    fullName: row.full_name || row.username || 'Unknown user',
    username: row.username || 'user',
    avatarUrl: row.avatar_url,
    isBusinessAccount: row.user_type === 'business',
  };
}

function toMessage(row: GroupMessageRow): GroupChatMessage {
  const sender = pickRelationRow(row.sender);
  const video = pickRelationRow(row.video);
  const event = pickRelationRow(row.event);

  return {
    id: row.id,
    groupId: row.group_chat_id,
    sender: toProfile(sender || {
      id: row.sender_id,
      full_name: 'Unknown user',
      username: 'user',
      avatar_url: null,
      user_type: null,
    }),
    type: row.message_type,
    text: row.text,
    video: video
      ? {
          id: video.id,
          title: video.title,
          videoUrl: video.video_url,
          thumbnailUrl: video.thumbnail_url,
          description: video.description,
          eventName: video.event_name,
          createdAt: video.created_at,
        }
      : null,
    event: event
      ? {
          id: event.id,
          eventName: event.event_name,
          description: event.description,
          imageUrl: event.image_url,
          startDate: event.start_date,
          locationName: event.location_name,
          ticketPrice: event.ticket_price,
          currency: event.currency,
        }
      : null,
    createdAt: row.created_at,
  };
}

export function getGroupInitials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'GC'
  );
}

export function getGroupLastLine(message?: GroupChatMessage | null, currentUserId?: string | null) {
  if (!message) {
    return 'Group created';
  }

  const prefix = currentUserId && message.sender.id === currentUserId ? 'You: ' : '';

  if (message.type === 'video') {
    return `${prefix}${message.sender.fullName} shared a video`;
  }

  if (message.type === 'event') {
    return `${prefix}${message.sender.fullName} shared an event`;
  }

  return `${prefix}${message.text || 'New message'}`;
}

export async function createGroupChat(input: {
  currentUserId: string;
  name: string;
  memberIds: string[];
}) {
  const trimmedName = input.name.trim();
  const color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
  const { data: chat, error: chatError } = await supabase
    .from('group_chats')
    .insert({
      name: trimmedName,
      created_by: input.currentUserId,
      avatar_color: color,
    })
    .select('id')
    .single<{ id: string }>();

  if (chatError || !chat?.id) {
    throw chatError || new Error('Unable to create group chat.');
  }

  const uniqueMemberIds = Array.from(new Set([input.currentUserId, ...input.memberIds]));
  const membershipRows = uniqueMemberIds.map((userId) => ({
    group_chat_id: chat.id,
    user_id: userId,
    role: userId === input.currentUserId ? 'owner' : 'member',
  }));

  const { error: memberError } = await supabase.from('group_chat_members').insert(membershipRows);
  if (memberError) {
    throw memberError;
  }

  // Create an initial message so all invited members immediately see context in the thread.
  await supabase.from('group_chat_messages').insert({
    group_chat_id: chat.id,
    sender_id: input.currentUserId,
    message_type: 'text',
    text: `Welcome to ${trimmedName}`,
  });

  return chat.id;
}

export async function addGroupMembers(input: {
  groupId: string;
  memberIds: string[];
}) {
  const uniqueMemberIds = Array.from(new Set(input.memberIds));
  if (uniqueMemberIds.length === 0) {
    return;
  }

  const rows = uniqueMemberIds.map((userId) => ({
    group_chat_id: input.groupId,
    user_id: userId,
    role: 'member',
  }));

  const { error } = await supabase.from('group_chat_members').upsert(rows, { onConflict: 'group_chat_id,user_id' });
  if (error) {
    throw error;
  }
}

export async function markGroupChatRead(groupId: string, currentUserId: string) {
  const { error } = await supabase
    .from('group_chat_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('group_chat_id', groupId)
    .eq('user_id', currentUserId);

  if (error) {
    throw error;
  }
}

export async function fetchMyGroupChats(currentUserId: string): Promise<GroupChatListItem[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('group_chat_members')
    .select('group_chat_id,role,joined_at,last_read_at,group_chats(id,name,avatar_color,created_by,created_at,updated_at)')
    .eq('user_id', currentUserId)
    .order('joined_at', { ascending: false });

  if (membershipError) {
    throw membershipError;
  }

  const membershipRows = (memberships ?? []) as unknown as GroupMembershipRow[];
  if (membershipRows.length === 0) {
    return [];
  }

  const groupIds = membershipRows.map((row) => row.group_chat_id);

  const [membersResult, messagesResult] = await Promise.all([
    supabase
      .from('group_chat_members')
      .select('group_chat_id,role,joined_at,last_read_at,profiles(id,full_name,username,avatar_url,user_type)')
      .in('group_chat_id', groupIds),
    supabase
      .from('group_chat_messages')
      .select('id,group_chat_id,sender_id,message_type,text,created_at,sender:profiles!group_chat_messages_sender_id_fkey(id,full_name,username,avatar_url,user_type),video:videos(id,title,video_url,thumbnail_url,description,event_name,created_at),event:events(id,event_name,description,image_url,start_date,location_name,ticket_price,currency)')
      .in('group_chat_id', groupIds)
      .order('created_at', { ascending: false }),
  ]);

  if (membersResult.error) {
    throw membersResult.error;
  }

  if (messagesResult.error) {
    throw messagesResult.error;
  }

  const membersByGroup = new Map<string, GroupMemberRow[]>();
  ((membersResult.data ?? []) as unknown as GroupMemberRow[]).forEach((row) => {
    const current = membersByGroup.get(row.group_chat_id) || [];
    current.push(row);
    membersByGroup.set(row.group_chat_id, current);
  });

  const lastMessageByGroup = new Map<string, GroupChatMessage>();
  const unreadCountByGroup = new Map<string, number>();
  const messageRows = (messagesResult.data ?? []) as unknown as GroupMessageRow[];

  messageRows.forEach((row) => {
    if (!lastMessageByGroup.has(row.group_chat_id)) {
      lastMessageByGroup.set(row.group_chat_id, toMessage(row));
    }
  });

  membershipRows.forEach((membership) => {
    const lastReadAt = membership.last_read_at ? new Date(membership.last_read_at).getTime() : 0;
    const unreadCount = messageRows.filter(
      (row) =>
        row.group_chat_id === membership.group_chat_id &&
        row.sender_id !== currentUserId &&
        new Date(row.created_at).getTime() > lastReadAt
    ).length;
    unreadCountByGroup.set(membership.group_chat_id, unreadCount);
  });

  return membershipRows
    .map((membership) => {
      const chat = pickRelationRow(membership.group_chats);
      if (!chat) {
        return null;
      }

      return {
        id: chat.id,
        name: chat.name,
        avatarColor: chat.avatar_color || GROUP_COLORS[0],
        createdBy: chat.created_by,
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
        memberCount: (membersByGroup.get(chat.id) || []).length,
        unreadCount: unreadCountByGroup.get(chat.id) || 0,
        lastMessage: lastMessageByGroup.get(chat.id) || null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right!.updatedAt).getTime() - new Date(left!.updatedAt).getTime()) as GroupChatListItem[];
}

export async function fetchGroupChatDetails(groupId: string, currentUserId: string): Promise<GroupChatDetails> {
  const [chatResult, membersResult, messagesResult] = await Promise.all([
    supabase
      .from('group_chats')
      .select('id,name,avatar_color,created_by,created_at,updated_at')
      .eq('id', groupId)
      .single<{
        id: string;
        name: string;
        avatar_color: string | null;
        created_by: string;
        created_at: string;
        updated_at: string;
      }>(),
    supabase
      .from('group_chat_members')
      .select('group_chat_id,role,joined_at,last_read_at,profiles(id,full_name,username,avatar_url,user_type)')
      .eq('group_chat_id', groupId),
    supabase
      .from('group_chat_messages')
      .select('id,group_chat_id,sender_id,message_type,text,created_at,sender:profiles!group_chat_messages_sender_id_fkey(id,full_name,username,avatar_url,user_type),video:videos(id,title,video_url,thumbnail_url,description,event_name,created_at),event:events(id,event_name,description,image_url,start_date,location_name,ticket_price,currency)')
      .eq('group_chat_id', groupId)
      .order('created_at', { ascending: true }),
  ]);

  if (chatResult.error || !chatResult.data) {
    throw chatResult.error || new Error('Group chat not found.');
  }

  if (membersResult.error) {
    throw membersResult.error;
  }

  if (messagesResult.error) {
    throw messagesResult.error;
  }

  const memberRows = (membersResult.data ?? []) as unknown as GroupMemberRow[];
  const members = memberRows
    .map((row) => {
      const profile = pickRelationRow(row.profiles);
      if (!profile) {
        return null;
      }

      return {
        ...toProfile(profile),
        role: row.role,
        joinedAt: row.joined_at,
        lastReadAt: row.last_read_at,
      };
    })
    .filter(Boolean) as GroupChatMember[];

  const messageRows = (messagesResult.data ?? []) as unknown as GroupMessageRow[];
  const messages = messageRows.map(toMessage);
  const currentMembership = memberRows.find((row) => pickRelationRow(row.profiles)?.id === currentUserId);
  const lastReadAt = currentMembership?.last_read_at ? new Date(currentMembership.last_read_at).getTime() : 0;
  const unreadCount = messageRows.filter(
    (row) => row.sender_id !== currentUserId && new Date(row.created_at).getTime() > lastReadAt
  ).length;

  return {
    id: chatResult.data.id,
    name: chatResult.data.name,
    avatarColor: chatResult.data.avatar_color || GROUP_COLORS[0],
    createdBy: chatResult.data.created_by,
    createdAt: chatResult.data.created_at,
    updatedAt: chatResult.data.updated_at,
    memberCount: members.length,
    unreadCount,
    lastMessage: messages.length > 0 ? messages[messages.length - 1] : null,
    members,
  };
}

export async function fetchGroupChatMessages(groupId: string): Promise<GroupChatMessage[]> {
  const { data, error } = await supabase
    .from('group_chat_messages')
    .select('id,group_chat_id,sender_id,message_type,text,created_at,sender:profiles!group_chat_messages_sender_id_fkey(id,full_name,username,avatar_url,user_type),video:videos(id,title,video_url,thumbnail_url,description,event_name,created_at),event:events(id,event_name,description,image_url,start_date,location_name,ticket_price,currency)')
    .eq('group_chat_id', groupId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as unknown as GroupMessageRow[]).map(toMessage);
}

export async function sendGroupTextMessage(input: {
  groupId: string;
  senderId: string;
  text: string;
}) {
  const { error } = await supabase.from('group_chat_messages').insert({
    group_chat_id: input.groupId,
    sender_id: input.senderId,
    message_type: 'text',
    text: input.text.trim(),
  });

  if (error) {
    throw error;
  }
}

export async function sendGroupVideoMessage(input: {
  groupId: string;
  senderId: string;
  videoId: string;
  text?: string;
}) {
  const { error } = await supabase.from('group_chat_messages').insert({
    group_chat_id: input.groupId,
    sender_id: input.senderId,
    message_type: 'video',
    video_id: input.videoId,
    text: input.text?.trim() || null,
  });

  if (error) {
    throw error;
  }
}

export async function sendGroupEventMessage(input: {
  groupId: string;
  senderId: string;
  eventId: string;
  text?: string;
}) {
  const { error } = await supabase.from('group_chat_messages').insert({
    group_chat_id: input.groupId,
    sender_id: input.senderId,
    message_type: 'event',
    event_id: input.eventId,
    text: input.text?.trim() || null,
  });

  if (error) {
    throw error;
  }
}

export async function updateGroupTextMessage(input: {
  messageId: string;
  senderId: string;
  text: string;
}) {
  const { error } = await supabase
    .from('group_chat_messages')
    .update({ text: input.text.trim() })
    .eq('id', input.messageId)
    .eq('sender_id', input.senderId)
    .eq('message_type', 'text');

  if (error) {
    throw error;
  }
}

export async function deleteGroupMessage(input: {
  messageId: string;
  senderId: string;
}) {
  const { error } = await supabase
    .from('group_chat_messages')
    .delete()
    .eq('id', input.messageId)
    .eq('sender_id', input.senderId);

  if (error) {
    throw error;
  }
}

export async function searchProfilesForGroup(query: string, currentUserId: string, excludeIds: string[] = []) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,full_name,username,avatar_url,user_type')
    .or(`full_name.ilike.%${query}%,username.ilike.%${query}%,business_name.ilike.%${query}%`)
    .neq('id', currentUserId)
    .limit(20);

  if (error) {
    throw error;
  }

  const excluded = new Set(excludeIds);
  return (data ?? [])
    .map((row: any) => toProfile(row))
    .filter((profile) => !excluded.has(profile.id));
}

export async function fetchMyShareableVideos(currentUserId: string): Promise<GroupSharedVideo[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('id,title,video_url,thumbnail_url,description,event_name,created_at')
    .eq('user_id', currentUserId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  return (data ?? []).map((video: any) => ({
    id: video.id,
    title: video.title,
    videoUrl: video.video_url,
    thumbnailUrl: video.thumbnail_url,
    description: video.description,
    eventName: video.event_name,
    createdAt: video.created_at,
  }));
}

export async function fetchMyShareableEvents(currentUserId: string): Promise<GroupSharedEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id,event_name,description,image_url,start_date,location_name,ticket_price,currency')
    .or(`user_id.eq.${currentUserId},creator_id.eq.${currentUserId}`)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  return (data ?? []).map((event: any) => ({
    id: event.id,
    eventName: event.event_name,
    description: event.description,
    imageUrl: event.image_url,
    startDate: event.start_date,
    locationName: event.location_name,
    ticketPrice: event.ticket_price,
    currency: event.currency,
  }));
}

export async function renameGroupChat(groupId: string, newName: string) {
  const { error } = await supabase
    .from('group_chats')
    .update({ name: newName.trim() })
    .eq('id', groupId);

  if (error) {
    throw error;
  }
}

export async function removeGroupMember(groupId: string, targetUserId: string) {
  const { error } = await supabase
    .from('group_chat_members')
    .delete()
    .eq('group_chat_id', groupId)
    .eq('user_id', targetUserId);

  if (error) {
    throw error;
  }
}

export async function leaveGroupChat(groupId: string, currentUserId: string) {
  const deleteMembership = async (userId: string) => {
    const { data, error } = await supabase
      .from('group_chat_members')
      .delete()
      .eq('group_chat_id', groupId)
      .eq('user_id', userId)
      .select('id');

    if (error) {
      throw error;
    }

    return (data ?? []).length;
  };

  const removedCount = await deleteMembership(currentUserId);
  if (removedCount > 0) {
    return;
  }

  // Some auth wrappers can expose a profile identifier while RLS policies rely on auth.uid().
  // Retry with the authenticated Supabase user ID before failing.
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw authError;
  }

  const authUserId = authData.user?.id;
  if (authUserId && authUserId !== currentUserId) {
    const fallbackRemovedCount = await deleteMembership(authUserId);
    if (fallbackRemovedCount > 0) {
      return;
    }
  }

  throw new Error('Unable to leave this group because your membership could not be removed.');
}
