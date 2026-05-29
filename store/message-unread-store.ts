import { create } from 'zustand';

interface MessageUnreadState {
  unreadCount: number;
  incrementUnread: () => void;
  incrementBy: (count: number) => void;
  clearUnread: () => void;
  setUnreadCount: (count: number) => void;
}

export const useMessageUnreadStore = create<MessageUnreadState>((set) => ({
  unreadCount: 0,
  incrementUnread: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),
  incrementBy: (count) => set((state) => ({ unreadCount: state.unreadCount + Math.max(0, count) })),
  clearUnread: () => set({ unreadCount: 0 }),
  setUnreadCount: (count) => set({ unreadCount: Math.max(0, count) }),
}));
