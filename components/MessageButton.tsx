import { logger } from '@/lib/logger';
import React from 'react';
import { TouchableOpacity, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useChatStore } from '@/store/chat-store';
import Colors from '@/constants/colors';

interface MessageButtonProps {
  userId: string;
  style?: any;
  showText?: boolean;
}

export default function MessageButton({ userId, style, showText = false }: MessageButtonProps) {
  const router = useRouter();
  const { createChat, getChatWithUser } = useChatStore();
  
  const handlePress = async () => {
    try {
      // Check if a chat already exists with this user
      const existingChat = getChatWithUser(userId);
      
      if (existingChat) {
        // If chat exists, navigate to it
        router.push(`/chat/${existingChat.id}`);
      } else {
        // Otherwise create a new chat
        const chatId = await createChat(userId);
        router.push(`/chat/${chatId}`);
      }
    } catch (error) {
      logger.error('Error starting chat:', error);
      // Handle error (show toast, etc.)
    }
  };
  
  return (
    <TouchableOpacity 
      style={[styles.button, style]} 
      onPress={handlePress}
    >
      <MessageCircle size={20} color={Colors.dark.text} />
      {showText && <Text style={styles.text}>Message</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  text: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
});