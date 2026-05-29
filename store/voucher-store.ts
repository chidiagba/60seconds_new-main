import { create } from 'zustand';
import { Voucher } from '@/types';
import { mockVouchers } from '@/mocks/vouchers';
import { useAuthStore } from './auth-store';

interface VoucherState {
  vouchers: Voucher[];
  activeVoucher: Voucher | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchVouchers: (businessId?: string) => Promise<void>;
  getVoucherByCode: (code: string) => Promise<Voucher | null>;
  createVoucher: (voucher: Omit<Voucher, 'id' | 'businessId' | 'createdAt' | 'usageCount'>) => Promise<boolean>;
  updateVoucher: (voucherId: string, updates: Partial<Voucher>) => Promise<boolean>;
  deleteVoucher: (voucherId: string) => Promise<boolean>;
  toggleVoucherStatus: (voucherId: string) => Promise<boolean>;
  validateVoucher: (code: string, amount: number, productId?: string) => Promise<{
    valid: boolean;
    voucher?: Voucher;
    discountAmount?: number;
    errorMessage?: string;
  }>;
  applyVoucher: (code: string) => void;
  clearActiveVoucher: () => void;
  incrementUsageCount: (voucherId: string) => Promise<boolean>;
}

export const useVoucherStore = create<VoucherState>((set, get) => ({
  vouchers: [],
  activeVoucher: null,
  isLoading: false,
  error: null,
  
  fetchVouchers: async (businessId?: string) => {
    set({ isLoading: true, error: null });
    try {
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      let filteredVouchers;
      if (businessId) {
        filteredVouchers = mockVouchers.filter(voucher => voucher.businessId === businessId);
      } else {
        const { user } = useAuthStore.getState();
        if (!user || !user.isBusinessAccount) {
          throw new Error('Only business accounts can access vouchers');
        }
        filteredVouchers = mockVouchers.filter(voucher => voucher.businessId === user.id);
      }
      
      set({ vouchers: filteredVouchers, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },
  
  getVoucherByCode: async (code: string) => {
    set({ isLoading: true, error: null });
    try {
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const voucher = mockVouchers.find(v => v.code === code && v.isActive);
      set({ isLoading: false });
      return voucher || null;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return null;
    }
  },
  
  createVoucher: async (voucherData) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useAuthStore.getState();
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can create vouchers');
      }
      
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Check if code already exists
      const existingVoucher = mockVouchers.find(v => v.code === voucherData.code);
      if (existingVoucher) {
        throw new Error('Voucher code already exists');
      }
      
      // Create new voucher
      const newVoucher: Voucher = {
        id: Date.now().toString(),
        businessId: user.id,
        usageCount: 0,
        createdAt: new Date().toISOString(),
        ...voucherData,
      };
      
      // Add to local state
      set(state => ({
        vouchers: [...state.vouchers, newVoucher],
        isLoading: false,
      }));
      
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  updateVoucher: async (voucherId, updates) => {
    set({ isLoading: true, error: null });
    try {
      const { vouchers } = get();
      const { user } = useAuthStore.getState();
      
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can update vouchers');
      }
      
      const voucherToUpdate = vouchers.find(v => v.id === voucherId);
      if (!voucherToUpdate) {
        throw new Error('Voucher not found');
      }
      
      if (voucherToUpdate.businessId !== user.id) {
        throw new Error('You can only update your own vouchers');
      }
      
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Update voucher
      const updatedVouchers = vouchers.map(v => 
        v.id === voucherId ? { ...v, ...updates } : v
      );
      
      set({ vouchers: updatedVouchers, isLoading: false });
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  deleteVoucher: async (voucherId) => {
    set({ isLoading: true, error: null });
    try {
      const { vouchers } = get();
      const { user } = useAuthStore.getState();
      
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can delete vouchers');
      }
      
      const voucherToDelete = vouchers.find(v => v.id === voucherId);
      if (!voucherToDelete) {
        throw new Error('Voucher not found');
      }
      
      if (voucherToDelete.businessId !== user.id) {
        throw new Error('You can only delete your own vouchers');
      }
      
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Delete voucher
      const updatedVouchers = vouchers.filter(v => v.id !== voucherId);
      
      set({ vouchers: updatedVouchers, isLoading: false });
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  toggleVoucherStatus: async (voucherId) => {
    set({ isLoading: true, error: null });
    try {
      const { vouchers } = get();
      const { user } = useAuthStore.getState();
      
      if (!user || !user.isBusinessAccount) {
        throw new Error('Only business accounts can update vouchers');
      }
      
      const voucherToUpdate = vouchers.find(v => v.id === voucherId);
      if (!voucherToUpdate) {
        throw new Error('Voucher not found');
      }
      
      if (voucherToUpdate.businessId !== user.id) {
        throw new Error('You can only update your own vouchers');
      }
      
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Toggle status
      const updatedVouchers = vouchers.map(v => 
        v.id === voucherId ? { ...v, isActive: !v.isActive } : v
      );
      
      set({ vouchers: updatedVouchers, isLoading: false });
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
  
  validateVoucher: async (code, amount, productId) => {
    set({ isLoading: true, error: null });
    try {
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const voucher = mockVouchers.find(v => v.code === code);
      
      if (!voucher) {
        set({ isLoading: false });
        return { valid: false, errorMessage: 'Voucher not found' };
      }
      
      if (!voucher.isActive) {
        set({ isLoading: false });
        return { valid: false, errorMessage: 'Voucher is inactive' };
      }
      
      const now = new Date();
      const expiryDate = new Date(voucher.expiryDate);
      if (now > expiryDate) {
        set({ isLoading: false });
        return { valid: false, errorMessage: 'Voucher has expired' };
      }
      
      if (voucher.usageCount >= voucher.usageLimit) {
        set({ isLoading: false });
        return { valid: false, errorMessage: 'Voucher usage limit reached' };
      }
      
      if (voucher.minPurchaseAmount && amount < voucher.minPurchaseAmount) {
        set({ isLoading: false });
        return { 
          valid: false, 
          errorMessage: `Minimum purchase amount is $${voucher.minPurchaseAmount.toFixed(2)}` 
        };
      }
      
      if (voucher.productId && voucher.productId !== productId) {
        set({ isLoading: false });
        return { 
          valid: false, 
          errorMessage: 'Voucher is only valid for specific products' 
        };
      }
      
      // Calculate discount amount
      let discountAmount = 0;
      if (voucher.discountType === 'percentage') {
        discountAmount = (amount * voucher.discountValue) / 100;
        if (voucher.maxDiscountAmount && discountAmount > voucher.maxDiscountAmount) {
          discountAmount = voucher.maxDiscountAmount;
        }
      } else {
        discountAmount = voucher.discountValue;
        if (discountAmount > amount) {
          discountAmount = amount;
        }
      }
      
      set({ isLoading: false });
      return { 
        valid: true, 
        voucher, 
        discountAmount 
      };
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return { valid: false, errorMessage: error.message };
    }
  },
  
  applyVoucher: (code) => {
    const voucher = mockVouchers.find(v => v.code === code && v.isActive);
    set({ activeVoucher: voucher || null });
  },
  
  clearActiveVoucher: () => {
    set({ activeVoucher: null });
  },
  
  incrementUsageCount: async (voucherId) => {
    set({ isLoading: true, error: null });
    try {
      const { vouchers } = get();
      
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Increment usage count
      const updatedVouchers = vouchers.map(v => 
        v.id === voucherId ? { ...v, usageCount: v.usageCount + 1 } : v
      );
      
      set({ vouchers: updatedVouchers, isLoading: false });
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
}));