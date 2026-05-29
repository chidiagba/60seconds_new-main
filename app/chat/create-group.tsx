import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { ArrowRight, Search, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { createGroupChat, GroupChatProfile, searchProfilesForGroup } from '@/lib/group-chat-service';

function normalizeGroupError(error: any) {
  const message = error?.message || String(error) || 'Please try again.';

  if (message.includes('permission denied')) {
    return 'Permission denied by Supabase RLS. Re-run sql_commands_for_supabase_tables/create-group-chat-tables.sql and sign in again.';
  }

  if (message.includes('violates row-level security policy')) {
    return 'Supabase RLS policy blocked this action. Re-run sql_commands_for_supabase_tables/create-group-chat-tables.sql and try again.';
  }

  if (message.includes('relation') && message.includes('does not exist')) {
    return 'Group chat tables are missing in Supabase. Run sql_commands_for_supabase_tables/create-group-chat-tables.sql first.';
  }

  return message;
}

export default function CreateGroupScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [groupName, setGroupName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [searchResults, setSearchResults] = useState<GroupChatProfile[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<GroupChatProfile[]>([]);

  useEffect(() => {
    if (!user?.id || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    const runSearch = async () => {
      try {
        const results = await searchProfilesForGroup(
          searchQuery,
          user.id,
          selectedMembers.map((member) => member.id)
        );

        if (!cancelled) {
          setSearchResults(results);
          setIsSearching(false);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
          setIsSearching(false);
        }
      }
    };

    const timer = setTimeout(runSearch, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, selectedMembers, user?.id]);

  const canCreate = !!groupName.trim() && selectedMembers.length > 0 && !!user?.id && !isCreating;

  const handleAddMember = (member: GroupChatProfile) => {
    setSelectedMembers((current) => [...current, member]);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemoveMember = (memberId: string) => {
    setSelectedMembers((current) => current.filter((member) => member.id !== memberId));
  };

  const helperText = useMemo(() => {
    if (!user?.id) {
      return 'You need to be signed in to create a group.';
    }

    return 'Select at least one registered app user.';
  }, [user?.id]);

  const handleCreateGroup = async () => {
    if (!canCreate || !user?.id) {
      return;
    }

    try {
      setIsCreating(true);
      const trimmedName = groupName.trim();
      const groupId = await createGroupChat({
        currentUserId: user.id,
        name: trimmedName,
        memberIds: selectedMembers.map((member) => member.id),
      });

      router.replace({
        pathname: '/messages',
        params: {
          createdGroupId: groupId,
          createdGroupName: trimmedName,
          createdGroupMemberCount: String(selectedMembers.length + 1),
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      Alert.alert('Unable to create group', normalizeGroupError(error));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen
        options={{
          title: 'Create group',
          headerStyle: { backgroundColor: Colors.dark.background },
          headerTintColor: Colors.dark.text,
        }}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create a synced group</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Group name</Text>
          <TextInput
            style={styles.input}
            placeholder="Weekend Launch Team"
            placeholderTextColor={Colors.dark.subtext}
            value={groupName}
            onChangeText={setGroupName}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Add members</Text>
          <View style={styles.searchRow}>
            <Search size={18} color={Colors.dark.subtext} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search registered users"
              placeholderTextColor={Colors.dark.subtext}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
            />
          </View>

          {selectedMembers.length > 0 ? (
            <View style={styles.selectedWrap}>
              {selectedMembers.map((member) => (
                <View key={member.id} style={styles.memberChip}>
                  <Text style={styles.memberChipText}>{member.fullName}</Text>
                  <TouchableOpacity onPress={() => handleRemoveMember(member.id)}>
                    <X size={14} color={Colors.dark.text} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.helperText}>{helperText}</Text>
          )}

          {isSearching ? (
            <View style={styles.loaderRow}>
              <ActivityIndicator size="small" color={Colors.dark.primary} />
            </View>
          ) : null}

          {!isSearching && searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.searchResult} onPress={() => handleAddMember(item)}>
                  {item.avatarUrl ? (
                    <Image source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarFallbackText}>{item.fullName.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}

                  <View style={styles.searchInfo}>
                    <Text style={styles.searchName}>{item.fullName}</Text>
                    <Text style={styles.searchHandle}>@{item.username}</Text>
                  </View>

                  <ArrowRight size={18} color={Colors.dark.subtext} />
                </TouchableOpacity>
              )}
            />
          ) : null}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footerSafe}>
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.createButton, !canCreate && styles.createButtonDisabled]}
          onPress={handleCreateGroup}
          disabled={!canCreate}
          activeOpacity={0.85}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color={Colors.dark.text} />
          ) : (
            <>
              <Text style={styles.createButtonLabel}>Create group</Text>
              <ArrowRight size={18} color={Colors.dark.text} />
            </>
          )}
        </TouchableOpacity>
      </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.dark.background },
  content: { padding: 16, gap: 16, paddingBottom: 140 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.dark.text },
  card: {
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  label: { color: Colors.dark.text, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  input: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: Colors.dark.text,
    fontSize: 16,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  searchInput: { flex: 1, color: Colors.dark.text, paddingVertical: 14, fontSize: 15 },
  helperText: { color: Colors.dark.subtext, fontSize: 13 },
  selectedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.dark.primary,
  },
  memberChipText: { color: Colors.dark.text, fontWeight: '600' },
  loaderRow: { paddingVertical: 12, alignItems: 'center' },
  searchResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: { color: Colors.dark.text, fontWeight: '800' },
  searchInfo: { flex: 1 },
  searchName: { color: Colors.dark.text, fontSize: 15, fontWeight: '600' },
  searchHandle: { color: Colors.dark.subtext, marginTop: 2 },
  footerSafe: {
    backgroundColor: Colors.dark.background,
  },
  footer: {
    padding: 16,
    backgroundColor: Colors.dark.background,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  createButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  createButtonDisabled: { opacity: 0.45 },
  createButtonLabel: { color: Colors.dark.text, fontWeight: '700', fontSize: 16 },
});
