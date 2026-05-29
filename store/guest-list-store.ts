import { create } from 'zustand';
import { GuestListEntry, GuestListRequest, GuestListStatus, GuestListRequestStatus, User } from '@/types';
import { useAuthStore } from '@/store/auth-store';
import { mockUsers } from '@/mocks/users';

interface GuestListState {
  guestLists: { [eventId: string]: GuestListEntry[] };
  guestListRequests: { [eventId: string]: GuestListRequest[] };
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchGuestList: (eventId: string) => Promise<void>;
  fetchGuestListRequests: (eventId: string) => Promise<void>;
  addUserToGuestList: (eventId: string, userId: string, notes?: string) => Promise<void>;
  removeUserFromGuestList: (eventId: string, userId: string) => Promise<void>;
  requestGuestListAccess: (eventId: string, message?: string) => Promise<void>;
  approveGuestListRequest: (eventId: string, requestId: string) => Promise<void>;
  rejectGuestListRequest: (eventId: string, requestId: string) => Promise<void>;
  updateGuestListStatus: (eventId: string, userId: string, status: GuestListStatus) => Promise<void>;
  searchUsers: (query: string) => Promise<User[]>;
  isUserOnGuestList: (eventId: string, userId: string) => boolean;
  hasUserRequestedAccess: (eventId: string, userId: string) => boolean;
  getGuestListForEvent: (eventId: string) => GuestListEntry[];
  getGuestListRequestsForEvent: (eventId: string) => GuestListRequest[];
}

export const useGuestListStore = create<GuestListState>((set, get) => ({
  guestLists: {},
  guestListRequests: {},
  isLoading: false,
  error: null,
  
  fetchGuestList: async (eventId: string) => {
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mock guest list data
      const mockGuestList: GuestListEntry[] = [
        {
          id: '1',
          eventId,
          userId: mockUsers[3].id,
          user: mockUsers[3],
          status: GuestListStatus.CONFIRMED,
          addedBy: mockUsers[0].id,
          addedAt: new Date(Date.now() - 86400000).toISOString(),
          notes: 'VIP guest'
        },
        {
          id: '2',
          eventId,
          userId: mockUsers[5].id,
          user: mockUsers[5],
          status: GuestListStatus.CONFIRMED,
          addedBy: mockUsers[0].id,
          addedAt: new Date(Date.now() - 172800000).toISOString()
        }
      ];
      
      set(state => ({
        guestLists: {
          ...state.guestLists,
          [eventId]: mockGuestList
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to fetch guest list', isLoading: false });
    }
  },
  
  fetchGuestListRequests: async (eventId: string) => {
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Mock guest list requests
      const mockRequests: GuestListRequest[] = [
        {
          id: '1',
          eventId,
          userId: mockUsers[7].id,
          user: mockUsers[7],
          status: GuestListRequestStatus.PENDING,
          message: 'Would love to attend this event!',
          requestedAt: new Date(Date.now() - 3600000).toISOString()
        }
      ];
      
      set(state => ({
        guestListRequests: {
          ...state.guestListRequests,
          [eventId]: mockRequests
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to fetch guest list requests', isLoading: false });
    }
  },
  
  addUserToGuestList: async (eventId: string, userId: string, notes?: string) => {
    const { user: currentUser } = useAuthStore.getState();
    if (!currentUser) return;
    
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const targetUser = mockUsers.find(u => u.id === userId);
      if (!targetUser) throw new Error('User not found');
      
      const newEntry: GuestListEntry = {
        id: Date.now().toString(),
        eventId,
        userId,
        user: targetUser,
        status: GuestListStatus.CONFIRMED,
        addedBy: currentUser.id,
        addedAt: new Date().toISOString(),
        notes
      };
      
      set(state => ({
        guestLists: {
          ...state.guestLists,
          [eventId]: [...(state.guestLists[eventId] || []), newEntry]
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to add user to guest list', isLoading: false });
    }
  },
  
  removeUserFromGuestList: async (eventId: string, userId: string) => {
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 300));
      
      set(state => ({
        guestLists: {
          ...state.guestLists,
          [eventId]: (state.guestLists[eventId] || []).filter(entry => entry.userId !== userId)
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to remove user from guest list', isLoading: false });
    }
  },
  
  requestGuestListAccess: async (eventId: string, message?: string) => {
    const { user: currentUser } = useAuthStore.getState();
    if (!currentUser) return;
    
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const newRequest: GuestListRequest = {
        id: Date.now().toString(),
        eventId,
        userId: currentUser.id,
        user: currentUser,
        status: GuestListRequestStatus.PENDING,
        message,
        requestedAt: new Date().toISOString()
      };
      
      set(state => ({
        guestListRequests: {
          ...state.guestListRequests,
          [eventId]: [...(state.guestListRequests[eventId] || []), newRequest]
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to request guest list access', isLoading: false });
    }
  },
  
  approveGuestListRequest: async (eventId: string, requestId: string) => {
    const { user: currentUser } = useAuthStore.getState();
    if (!currentUser) return;
    
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const state = get();
      const request = state.guestListRequests[eventId]?.find(r => r.id === requestId);
      if (!request) throw new Error('Request not found');
      
      // Update request status
      const updatedRequests = (state.guestListRequests[eventId] || []).map(r => 
        r.id === requestId 
          ? { 
              ...r, 
              status: GuestListRequestStatus.APPROVED,
              respondedAt: new Date().toISOString(),
              respondedBy: currentUser.id
            }
          : r
      );
      
      // Add user to guest list
      const newGuestEntry: GuestListEntry = {
        id: Date.now().toString(),
        eventId,
        userId: request.userId,
        user: request.user,
        status: GuestListStatus.CONFIRMED,
        addedBy: currentUser.id,
        addedAt: new Date().toISOString()
      };
      
      set(state => ({
        guestListRequests: {
          ...state.guestListRequests,
          [eventId]: updatedRequests
        },
        guestLists: {
          ...state.guestLists,
          [eventId]: [...(state.guestLists[eventId] || []), newGuestEntry]
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to approve request', isLoading: false });
    }
  },
  
  rejectGuestListRequest: async (eventId: string, requestId: string) => {
    const { user: currentUser } = useAuthStore.getState();
    if (!currentUser) return;
    
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 300));
      
      set(state => ({
        guestListRequests: {
          ...state.guestListRequests,
          [eventId]: (state.guestListRequests[eventId] || []).map(r => 
            r.id === requestId 
              ? { 
                  ...r, 
                  status: GuestListRequestStatus.REJECTED,
                  respondedAt: new Date().toISOString(),
                  respondedBy: currentUser.id
                }
              : r
          )
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to reject request', isLoading: false });
    }
  },
  
  updateGuestListStatus: async (eventId: string, userId: string, status: GuestListStatus) => {
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 300));
      
      set(state => ({
        guestLists: {
          ...state.guestLists,
          [eventId]: (state.guestLists[eventId] || []).map(entry => 
            entry.userId === userId ? { ...entry, status } : entry
          )
        },
        isLoading: false
      }));
    } catch (error) {
      set({ error: 'Failed to update guest list status', isLoading: false });
    }
  },
  
  searchUsers: async (query: string) => {
    if (!query.trim()) return [];
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const searchQuery = query.toLowerCase();
    return mockUsers.filter(user => 
      user.name.toLowerCase().includes(searchQuery) ||
      user.username.toLowerCase().includes(searchQuery) ||
      user.displayName?.toLowerCase().includes(searchQuery)
    );
  },
  
  isUserOnGuestList: (eventId: string, userId: string) => {
    const { guestLists } = get();
    const guestList = guestLists[eventId] || [];
    return guestList.some(entry => 
      entry.userId === userId && 
      entry.status === GuestListStatus.CONFIRMED
    );
  },
  
  hasUserRequestedAccess: (eventId: string, userId: string) => {
    const { guestListRequests } = get();
    const requests = guestListRequests[eventId] || [];
    return requests.some(request => 
      request.userId === userId && 
      request.status === GuestListRequestStatus.PENDING
    );
  },
  
  getGuestListForEvent: (eventId: string) => {
    const { guestLists } = get();
    return guestLists[eventId] || [];
  },
  
  getGuestListRequestsForEvent: (eventId: string) => {
    const { guestListRequests } = get();
    return guestListRequests[eventId] || [];
  }
}));