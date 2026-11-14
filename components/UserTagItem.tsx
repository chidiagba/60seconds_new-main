import AvatarImage from '@/components/AvatarImage';
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { User } from '@/types';

interface UserTagItemProps {
  user: User;
  onRemove?: () => void;
  showRemoveButton?: boolean;
  onPress?: () => void;
}

export default function UserTagItem({ 
  user, 
  onRemove, 
  showRemoveButton = true,
  onPress
}: UserTagItemProps) {
  return (
    <TouchableOpacity 
      style={styles.container}
      onPress={onPress}
      disabled={!onPress}
    >
      <AvatarImage
        uri={user.avatar} userId={user?.id}
        style={styles.avatar}
        contentFit="cover"
        transition={300}
      />
      <Text style={styles.username}>@{user.username}</Text>
      
      {showRemoveButton && onRemove && (
        <TouchableOpacity 
          style={styles.removeButton}
          onPress={onRemove}
        >
          <X size={16} color={Colors.dark.text} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 6,
  },
  username: {
    color: Colors.dark.text,
    fontSize: 14,
  },
  removeButton: {
    marginLeft: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});