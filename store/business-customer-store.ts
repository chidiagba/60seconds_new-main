import { create } from 'zustand';
import { BusinessCustomer, VideoInteraction, VoucherShare, CustomerFilters, CustomerStats, InteractionType, User } from '@/types';
import { useAuthStore } from './auth-store';
import { mockUsers } from '@/mocks/users';

interface BusinessCustomerState {
  customers: BusinessCustomer[];
  interactions: VideoInteraction[];
  voucherShares: VoucherShare[];
  stats: CustomerStats | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchCustomers: (filters?: CustomerFilters) => Promise<void>;
  fetchCustomerInteractions: (customerId?: string) => Promise<void>;
  fetchCustomerStats: () => Promise<void>;
  sendMessageToCustomer: (customerId: string, message: string) => Promise<boolean>;
  sendMessageToMultipleCustomers: (customerIds: string[], message: string) => Promise<boolean>;
  shareVoucherWithCustomer: (customerId: string, voucherId: string, message?: string) => Promise<boolean>;
  shareVoucherWithMultipleCustomers: (customerIds: string[], voucherId: string, message?: string) => Promise<boolean>;
  addCustomerTag: (customerId: string, tag: string) => Promise<boolean>;
  removeCustomerTag: (customerId: string, tag: string) => Promise<boolean>;
  updateCustomerNotes: (customerId: string, notes: string) => Promise<boolean>;
  getCustomersByInteractionType: (interactionType: InteractionType) => BusinessCustomer[];
  getTopCustomers: (limit?: number) => BusinessCustomer[];
}

// Mock data for business customers
const generateMockCustomers = (businessId: string): BusinessCustomer[] => {
  const customers = mockUsers.filter(user => !user.isBusinessAccount).slice(0, 15);
  
  return customers.map((customer, index) => {
    const interactionTypes: InteractionType[] = [];
    const randomInteractions = Math.floor(Math.random() * 5) + 1;
    
    for (let i = 0; i < randomInteractions; i++) {
      const types: InteractionType[] = ['view', 'like', 'comment', 'share', 'purchase'];
      const randomType = types[Math.floor(Math.random() * types.length)];
      if (!interactionTypes.includes(randomType)) {
        interactionTypes.push(randomType);
      }
    }
    
    const totalSpent = Math.random() * 500;
    const totalInteractions = Math.floor(Math.random() * 50) + 1;
    
    return {
      id: `bc_${index + 1}`,
      businessId,
      customerId: customer.id,
      customer,
      firstInteractionDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      lastInteractionDate: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      totalInteractions,
      totalSpent,
      interactionTypes,
      tags: index % 3 === 0 ? ['VIP'] : index % 5 === 0 ? ['Regular'] : [],
      notes: index % 4 === 0 ? 'Great customer, always engages with content' : undefined,
      createdAt: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
};

const generateMockInteractions = (businessId: string): VideoInteraction[] => {
  const interactions: VideoInteraction[] = [];
  const customers = mockUsers.filter(user => !user.isBusinessAccount).slice(0, 10);
  
  customers.forEach((customer, customerIndex) => {
    const numInteractions = Math.floor(Math.random() * 10) + 1;
    
    for (let i = 0; i < numInteractions; i++) {
      const types: InteractionType[] = ['view', 'like', 'comment', 'share', 'purchase'];
      const interactionType = types[Math.floor(Math.random() * types.length)];
      
      interactions.push({
        id: `int_${customerIndex}_${i}`,
        userId: customer.id,
        videoId: `video_${Math.floor(Math.random() * 5) + 1}`,
        businessId,
        interactionType,
        interactionData: interactionType === 'purchase' ? { amount: Math.random() * 100 } : undefined,
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        user: customer,
      });
    }
  });
  
  return interactions;
};

export const useBusinessCustomerStore = create<BusinessCustomerState>((set, get) => ({
  customers: [],
  interactions: [],
  voucherShares: [],
  stats: null,
  isLoading: false,
  error: null,
  
  fetchCustomers: async (filters?: CustomerFilters) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can access customer data');
      }
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 800));
      
      let customers = generateMockCustomers(user.id);
      
      // Apply filters
      if (filters) {
        if (filters.interactionType) {
          customers = customers.filter(c => 
            c.interactionTypes.includes(filters.interactionType!)
          );
        }
        
        if (filters.minSpent !== undefined) {
          customers = customers.filter(c => c.totalSpent >= filters.minSpent!);
        }
        
        if (filters.maxSpent !== undefined) {
          customers = customers.filter(c => c.totalSpent <= filters.maxSpent!);
        }
        
        if (filters.tags && filters.tags.length > 0) {
          customers = customers.filter(c => 
            filters.tags!.some(tag => c.tags.includes(tag))
          );
        }
        
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          customers = customers.filter(c => 
            c.customer.name.toLowerCase().includes(searchLower) ||
            c.customer.username.toLowerCase().includes(searchLower) ||
            (c.customer.email && c.customer.email.toLowerCase().includes(searchLower))
          );
        }
        
        if (filters.dateRange) {
          const startDate = new Date(filters.dateRange.start);
          const endDate = new Date(filters.dateRange.end);
          customers = customers.filter(c => {
            const lastInteraction = new Date(c.lastInteractionDate);
            return lastInteraction >= startDate && lastInteraction <= endDate;
          });
        }
      }
      
      // Sort by last interaction date (most recent first)
      customers.sort((a, b) => 
        new Date(b.lastInteractionDate).getTime() - new Date(a.lastInteractionDate).getTime()
      );
      
      set({ customers, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },
  
  fetchCustomerInteractions: async (customerId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can access interaction data');
      }
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      let interactions = generateMockInteractions(user.id);
      
      if (customerId) {
        interactions = interactions.filter(i => i.userId === customerId);
      }
      
      // Sort by creation date (most recent first)
      interactions.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      set({ interactions, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },
  
  fetchCustomerStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can access stats');
      }
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const customers = get().customers;
      const interactions = generateMockInteractions(user.id);
      
      const totalCustomers = customers.length;
      const totalRevenue = customers.reduce((sum, c) => sum + c.totalSpent, 0);
      const averageSpentPerCustomer = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
      
      // Calculate new customers this month
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const newCustomersThisMonth = customers.filter(c => 
        new Date(c.firstInteractionDate) >= oneMonthAgo
      ).length;
      
      // Find top interaction type
      const interactionCounts: Record<InteractionType, number> = {
        view: 0, like: 0, comment: 0, share: 0, purchase: 0
      };
      
      interactions.forEach(i => {
        interactionCounts[i.interactionType]++;
      });
      
      const topInteractionType = Object.entries(interactionCounts)
        .sort(([,a], [,b]) => b - a)[0][0] as InteractionType;
      
      // Calculate repeat customer rate
      const repeatCustomers = customers.filter(c => c.totalInteractions > 5).length;
      const repeatCustomerRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;
      
      const stats: CustomerStats = {
        totalCustomers,
        newCustomersThisMonth,
        totalRevenue,
        averageSpentPerCustomer,
        topInteractionType,
        repeatCustomerRate,
      };
      
      set({ stats, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },
  
  sendMessageToCustomer: async (customerId: string, message: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can send messages');
      }
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // In a real app, this would create a chat and send the message
      console.log(`Sending message to customer ${customerId}: ${message}`);
      
      set({ isLoading: false });
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  sendMessageToMultipleCustomers: async (customerIds: string[], message: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can send messages');
      }
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // In a real app, this would create chats and send messages to multiple customers
      console.log(`Sending message to ${customerIds.length} customers: ${message}`);
      
      set({ isLoading: false });
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  shareVoucherWithCustomer: async (customerId: string, voucherId: string, message?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can share vouchers');
      }
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const newVoucherShare: VoucherShare = {
        id: Date.now().toString(),
        voucherId,
        businessId: user.id,
        customerId,
        sharedVia: 'message',
        messageText: message,
        isUsed: false,
        createdAt: new Date().toISOString(),
      };
      
      set(state => ({
        voucherShares: [...state.voucherShares, newVoucherShare],
        isLoading: false,
      }));
      
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  shareVoucherWithMultipleCustomers: async (customerIds: string[], voucherId: string, message?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can share vouchers');
      }
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const newVoucherShares: VoucherShare[] = customerIds.map(customerId => ({
        id: `${Date.now()}_${customerId}`,
        voucherId,
        businessId: user.id,
        customerId,
        sharedVia: 'message' as const,
        messageText: message,
        isUsed: false,
        createdAt: new Date().toISOString(),
      }));
      
      set(state => ({
        voucherShares: [...state.voucherShares, ...newVoucherShares],
        isLoading: false,
      }));
      
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  addCustomerTag: async (customerId: string, tag: string) => {
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 300));
      
      set(state => ({
        customers: state.customers.map(customer => {
          if (customer.customerId === customerId) {
            const updatedTags = [...customer.tags];
            if (!updatedTags.includes(tag)) {
              updatedTags.push(tag);
            }
            return { ...customer, tags: updatedTags };
          }
          return customer;
        }),
        isLoading: false,
      }));
      
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  removeCustomerTag: async (customerId: string, tag: string) => {
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 300));
      
      set(state => ({
        customers: state.customers.map(customer => {
          if (customer.customerId === customerId) {
            return {
              ...customer,
              tags: customer.tags.filter(t => t !== tag)
            };
          }
          return customer;
        }),
        isLoading: false,
      }));
      
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  updateCustomerNotes: async (customerId: string, notes: string) => {
    set({ isLoading: true, error: null });
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 400));
      
      set(state => ({
        customers: state.customers.map(customer => {
          if (customer.customerId === customerId) {
            return { ...customer, notes };
          }
          return customer;
        }),
        isLoading: false,
      }));
      
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  getCustomersByInteractionType: (interactionType: InteractionType) => {
    return get().customers.filter(customer => 
      customer.interactionTypes.includes(interactionType)
    );
  },
  
  getTopCustomers: (limit = 10) => {
    return get().customers
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  },
}));