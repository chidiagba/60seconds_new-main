import {validatedVoucherSelection, CheckoutItem} from '@/utils/checkout-selection';
import { create } from 'zustand';
import { Voucher } from '@/types';
import { voucherService } from '@/lib/database';
import { supabase } from '@/lib/supabase';
import { voucherDiscountFields } from '@/utils/voucher-fields';

const fromRow = (r: any): Voucher => ({ id: r.id, businessId: r.business_id, code: r.code, name: r.name || r.title, description: r.description, productId: r.product_id || undefined, currency:r.currency,eventId:r.event_id,allowedUserIds:r.allowed_user_ids,perUserLimit:r.per_user_limit,applicableProducts:r.applicable_products,applicableCategories:r.applicable_categories, ...voucherDiscountFields(r), minPurchaseAmount: r.min_purchase_amount, maxDiscountAmount: r.max_discount_amount, expiryDate: r.expiry_date, usageLimit: r.usage_limit, usageCount: r.usage_count, isActive: r.is_active, createdAt: r.created_at });
const toRow = (v: Partial<Voucher>): any => Object.fromEntries(Object.entries(v).filter(([k]) => !['id','createdAt','usageCount','businessId'].includes(k)).map(([k,value]) => [k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), k === 'code' ? String(value).trim().toUpperCase() : value]));
import { useAuthStore } from './auth-store';

interface VoucherState {
  vouchers: Voucher[];
  activeVoucher: Voucher | null;
  checkoutQuote: any | null;
  checkoutVersion: number;
  setCheckoutQuote: (quote: any) => void;
  checkoutCompleted: (businessId?:string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchVouchers: (businessId?: string) => Promise<void>;
  getVoucherByCode: (code: string) => Promise<Voucher | null>;
  createVoucher: (voucher: Omit<Voucher, 'id' | 'businessId' | 'createdAt' | 'usageCount'>) => Promise<boolean>;
  updateVoucher: (voucherId: string, updates: Partial<Voucher>) => Promise<boolean>;
  deleteVoucher: (voucherId: string) => Promise<boolean>;
  toggleVoucherStatus: (voucherId: string) => Promise<boolean>;
  validateVoucher: (code: string, amount: number, productId?: string, businessId?: string, items?: Array<{productId:string;quantity:number}>) => Promise<{
    valid: boolean;
    voucher?: Voucher;
    discountAmount?: number;
    errorMessage?: string;
    quote?: any;
  }>;
  applyVoucher: (code: string) => void;
  applyValidatedVoucher: (voucher:Voucher,quote:any,items:CheckoutItem[]) => void;
  resumeCheckoutQuote: (quote:any,items:CheckoutItem[]) => void;
  clearActiveVoucher: () => void;
  incrementUsageCount: (voucherId: string) => Promise<boolean>;
}

export const useVoucherStore = create<VoucherState>((set, get) => ({
  vouchers: [],
  activeVoucher: null,
  checkoutQuote: null,
  checkoutVersion: 0,
  setCheckoutQuote: (checkoutQuote) => set({checkoutQuote}),
  checkoutCompleted: async (businessId) => { set(state=>({checkoutVersion:state.checkoutVersion+1})); if(businessId) await get().fetchVouchers(businessId); },
  isLoading: false,
  error: null,
  
  fetchVouchers: async (businessId?: string) => {
    set({ isLoading: true, error: null });
    try {
      
      let filteredVouchers;
      if (businessId) {
        filteredVouchers = (await voucherService.getBusinessVouchers(businessId)).map(fromRow);
      } else {
        const { user } = useAuthStore.getState();
        if (!user || !user.isBusinessAccount) {
          throw new Error('Only business accounts can access vouchers');
        }
        filteredVouchers = (await voucherService.getBusinessVouchers(user.id)).map(fromRow);
      }
      
      set({ vouchers: filteredVouchers, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },
  
  getVoucherByCode: async (code: string) => {
    set({ isLoading: true, error: null });
    try {
      
      const { data, error } = await supabase.from('vouchers').select('*').ilike('code', code.trim().toUpperCase().replace(/[%_]/g, c => '\\' + c)).maybeSingle();
      if (error) throw error;
      const voucher = data ? fromRow(data) : null;
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
      
      
      const newVoucher = fromRow(await voucherService.createVoucher({ ...toRow(voucherData), business_id: user.id }));

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
      
      
      await voucherService.updateVoucher(voucherId, toRow(updates));
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
      
      
      const { error } = await supabase.from('vouchers').delete().eq('id', voucherId).eq('business_id', user.id);
      if (error) throw error;
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
      
      
      await voucherService.updateVoucher(voucherId, { is_active: !voucherToUpdate.isActive });
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
  
  validateVoucher: async (code, _amount, productId, _businessId, items) => {
    set({isLoading:true,error:null});
    try {
      const requested=items || (productId ? [{productId,quantity:1}] : []);
      const {data:quote,error}=await supabase.rpc('quote_order_checkout',{requested_items:requested,voucher_code:code.trim()});
      if(error)throw error;
      if(!quote?.voucher)throw new Error('Voucher not found');
      const voucher=fromRow(quote.voucher);
      set(state=>({isLoading:false,vouchers:[...state.vouchers.filter(v=>v.id!==voucher.id),voucher]}));
      return {valid:true,voucher,quote,discountAmount:Number(quote.discount_amount)};
    } catch(error:any){set({isLoading:false,error:error.message});return {valid:false,errorMessage:error.message};}
  },

  applyValidatedVoucher:(voucher,quote,items)=>set(validatedVoucherSelection(voucher,quote,items)),
  resumeCheckoutQuote:(quote,items)=>{
    if(quote.voucher_id)set(validatedVoucherSelection(fromRow(quote.voucher),quote,items));
    else set({activeVoucher:null,checkoutQuote:quote});
  },
  applyVoucher: (code) => {
    const voucher = get().vouchers.find(v => v.code.toUpperCase() === code.trim().toUpperCase() && v.isActive);
    set({ activeVoucher: voucher || null });
  },
  
  clearActiveVoucher: () => {
    set({ activeVoucher: null, checkoutQuote:null });
  },
  
  incrementUsageCount: async (voucherId) => {
    set({ isLoading: true, error: null });
    try {
      const { vouchers } = get();
      
      
      const redeemed = fromRow(await voucherService.redeemVoucher(voucherId));
      // Increment usage count
      const updatedVouchers = vouchers.map(v => 
        v.id === voucherId ? redeemed : v
      );
      
      set({ vouchers: updatedVouchers, isLoading: false });
      return true;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return false;
    }
  },
}));
