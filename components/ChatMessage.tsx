import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors from '@/constants/colors';
import { Message, User } from '@/types';

interface ChatMessageProps {
  message: Message;
  isCurrentUser: boolean;
  otherUser?: User;
  showAvatar?: boolean;
}

export default function ChatMessage({ 
  message, 
  isCurrentUser, 
  otherUser, 
  showAvatar = true 
}: ChatMessageProps) {
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  return (
    <View style={[
      styles.container,
      isCurrentUser ? styles.currentUserContainer : styles.otherUserContainer
    ]}>
      {!isCurrentUser && showAvatar && otherUser && (
        <Image
          source={{ uri: otherUser.avatar }}
          style={styles.avatar}
          contentFit="cover"
        />
      )}
      
      {!isCurrentUser && !showAvatar && <View style={styles.avatarPlaceholder} />}
      
      <View style={[
        styles.bubble,
        isCurrentUser ? styles.currentUserBubble : styles.otherUserBubble
      ]}>
        <Text style={styles.text}>{message.text}</Text>
        <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
        
        {message.attachments && message.attachments.length > 0 && (
          <View style={styles.attachmentsContainer}>
            {message.attachments.map(attachment => (
              <View key={attachment.id} style={styles.attachment}>
                {attachment.type === 'image' && (
                  <Image
                    source={{ uri: attachment.url }}
                    style={styles.attachmentImage}
                    contentFit="cover"
                  />
                )}
                {attachment.type !== 'image' && (
                  <Text style={styles.attachmentName}>{attachment.name}</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginBottom: 8,
    maxWidth: '80%',
  },
  currentUserContainer: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
  },
  otherUserContainer: {
    alignSelf: 'flex-start',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    alignSelf: 'flex-end',
  },
  avatarPlaceholder: {
    width: 32,
    marginRight: 8,
  },
  bubble: {
    padding: 12,
    borderRadius: 18,
    minWidth: 80,
  },
  currentUserBubble: {
    backgroundColor: Colors.dark.primary,
    borderBottomRightRadius: 4,
  },
  otherUserBubble: {
    backgroundColor: Colors.dark.card,
    borderBottomLeftRadius: 4,
  },
  text: {
    color: Colors.dark.text,
    fontSize: 16,
  },
  time: {
    fontSize: 12,
    color: Colors.dark.subtext,
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  attachmentsContainer: {
    marginTop: 8,
  },
  attachment: {
    marginTop: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  attachmentImage: {
    width: '100%',
    height: 150,
    borderRadius: 8,
  },
  attachmentName: {
    color: Colors.dark.text,
    fontSize: 14,
    backgroundColor: Colors.dark.background,
    padding: 8,
    borderRadius: 8,
  },
});