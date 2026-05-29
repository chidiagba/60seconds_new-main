import { create } from 'zustand';
import { Chat, Message, User, MessageAttachment } from '@/types';
import { useAuthStore } from '@/store/auth-store';

interface ChatState {
  chats: Chat[];
  currentChatId: string | null;
  messages: Record<string, Message[]>; // chatId -> messages
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchChats: () => Promise<void>;
  fetchMessages: (chatId: string) => Promise<void>;
  sendMessage: (chatId: string, text: string, attachments?: MessageAttachment[]) => Promise<void>;
  createChat: (userId: string) => Promise<string>; // Returns chatId
  markAsRead: (chatId: string) => void;
  setCurrentChatId: (chatId: string | null) => void;
  getChatWithUser: (userId: string) => Chat | null;
  getTotalUnreadCount: () => number;
}

// Mock data for initial chats
const mockChats: Chat[] = [
  {
    id: '1',
    participants: ['current-user', '2'], // current-user and Music Lover
    lastMessage: {
      id: '101',
      chatId: '1',
      senderId: '2',
      text: "Hey, are you going to the event this weekend?",
      read: false,
      createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    },
    unreadCount: 1,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), // 3 days ago
    updatedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  },
  {
    id: '2',
    participants: ['current-user', '3'], // current-user and DJ Max
    lastMessage: {
      id: '201',
      chatId: '2',
      senderId: 'current-user',
      text: "Your set was amazing last night!",
      read: true,
      createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    },
    unreadCount: 0,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
    updatedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
  },
  {
    id: '3',
    participants: ['current-user', '1'], // current-user and Club Vibes
    lastMessage: {
      id: '301',
      chatId: '3',
      senderId: '1',
      text: "Thanks for your reservation! We've saved your VIP table.",
      read: false,
      createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
    },
    unreadCount: 2,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
    updatedAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
  },
];

// Mock messages for each chat
const mockMessages: Record<string, Message[]> = {
  '1': [
    {
      id: '100',
      chatId: '1',
      senderId: 'current-user',
      text: "Hi there! How are you?",
      read: true,
      createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    },
    {
      id: '101',
      chatId: '1',
      senderId: '2',
      text: "Hey, are you going to the event this weekend?",
      read: false,
      createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    },
  ],
  '2': [
    {
      id: '200',
      chatId: '2',
      senderId: '3',
      text: "Thanks for coming to my show!",
      read: true,
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
    },
    {
      id: '201',
      chatId: '2',
      senderId: 'current-user',
      text: "Your set was amazing last night!",
      read: true,
      createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    },
  ],
  '3': [
    {
      id: '300',
      chatId: '3',
      senderId: 'current-user',
      text: "Hi, I'd like to reserve a VIP table for Saturday.",
      read: true,
      createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    },
    {
      id: '301',
      chatId: '3',
      senderId: '1',
      text: "Thanks for your reservation! We've saved your VIP table.",
      read: false,
      createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
    },
    {
      id: '302',
      chatId: '3',
      senderId: '1',
      text: "Please arrive before 11 PM to secure your spot.",
      read: false,
      createdAt: new Date(Date.now() - 7100000).toISOString(), // Just after previous message
    },
  ],
};

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  currentChatId: null,
  messages: {},
  isLoading: false,
  error: null,
  
  fetchChats: async () => {
    set({ isLoading: true, error: null });
    try {
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Replace 'current-user' with the actual user ID
      const { user } = useAuthStore.getState();
      if (!user) {
        set({ error: 'User not authenticated', isLoading: false });
        return;
      }
      
      // Update the mock chats to use the current user's ID
      const userChats = mockChats.map(chat => ({
        ...chat,
        participants: chat.participants.map(p => 
          p === 'current-user' ? user.id : p
        )
      }));
      
      set({ chats: userChats, isLoading: false });
    } catch (error) {
      set({ error: 'Failed to fetch chats', isLoading: false });
    }
  },
  
  fetchMessages: async (chatId: string) => {
    set({ isLoading: true, error: null });
    try {
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Get messages for this chat
      const chatMessages = mockMessages[chatId] || [];
      
      set(state => ({
        messages: {
          ...state.messages,
          [chatId]: chatMessages
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to fetch messages', isLoading: false });
    }
  },
  
  sendMessage: async (chatId: string, text: string, attachments?: MessageAttachment[]) => {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    const newMessage: Message = {
      id: Date.now().toString(),
      chatId,
      senderId: user.id,
      text,
      read: false,
      createdAt: new Date().toISOString(),
      attachments,
    };
    
    // Optimistically update UI
    set(state => {
      // Update messages for this chat
      const chatMessages = [...(state.messages[chatId] || []), newMessage];
      
      // Update the chat with the new last message
      const updatedChats = state.chats.map(chat => {
        if (chat.id === chatId) {
          return {
            ...chat,
            lastMessage: newMessage,
            updatedAt: newMessage.createdAt
          };
        }
        return chat;
      });
      
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMessages
        },
        chats: updatedChats
      };
    });
    
    try {
      // In a real app, this would be an API call to send the message
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Message sent successfully, no need to update state again
    } catch (error) {
      // Handle error, maybe revert the optimistic update
      set({ error: 'Failed to send message' });
    }
  },
  
  createChat: async (userId: string) => {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error('User not authenticated');
    
    // Check if a chat already exists with this user
    const existingChat = get().getChatWithUser(userId);
    if (existingChat) return existingChat.id;
    
    // Create a new chat
    const newChatId = Date.now().toString();
    const newChat: Chat = {
      id: newChatId,
      participants: [user.id, userId],
      unreadCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    set(state => ({
      chats: [newChat, ...state.chats],
      currentChatId: newChatId,
      messages: {
        ...state.messages,
        [newChatId]: []
      }
    }));
    
    return newChatId;
  },
  
  markAsRead: (chatId: string) => {
    set(state => {
      // Mark all messages in this chat as read
      const chatMessages = state.messages[chatId] || [];
      const updatedMessages = chatMessages.map(message => ({
        ...message,
        read: true
      }));
      
      // Update the chat's unread count
      const updatedChats = state.chats.map(chat => {
        if (chat.id === chatId) {
          return {
            ...chat,
            unreadCount: 0
          };
        }
        return chat;
      });
      
      return {
        messages: {
          ...state.messages,
          [chatId]: updatedMessages
        },
        chats: updatedChats
      };
    });
  },
  
  setCurrentChatId: (chatId: string | null) => {
    set({ currentChatId: chatId });
    
    // If setting a chat as current, mark it as read
    if (chatId) {
      get().markAsRead(chatId);
    }
  },
  
  getChatWithUser: (userId: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return null;
    
    return get().chats.find(chat => 
      chat.participants.includes(user.id) && 
      chat.participants.includes(userId)
    ) || null;
  },
  
  getTotalUnreadCount: () => {
    return get().chats.reduce((total, chat) => total + chat.unreadCount, 0);
  }
}));