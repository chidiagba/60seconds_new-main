import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Wallet, Transaction, PaymentMethod, BusinessBankAccount, WithdrawalRequest, PLATFORM_ACCOUNT_ID, PLATFORM_WALLET_ID, TRANSACTION_FEE_PERCENTAGE, TWINT_MERCHANT_ID, TWINT_API_KEY, PAYSTACK_PUBLIC_KEY, PAYSTACK_MERCHANT_ID } from '@/types/wallet';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from './auth-store';
import { CurrencyCode, DEFAULT_CURRENCY, isSupportedCurrencyCode, normalizeCurrencyCode } from '@/constants/currencies';
import { resolveCurrencyFromCountry } from '@/utils/country-currency';

type BusinessBankAccountRow = {
  id: string;
  user_id: string;
  is_primary?: boolean | null;
  payout_provider?: 'stripe' | 'paystack' | null;
  bank_name: string;
  bank_code?: string | null;
  account_holder_name: string;
  account_number: string;
  routing_number?: string | null;
  iban?: string | null;
  swift_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  currency?: string | null;
  is_verified: boolean;
  verification_status?: 'pending' | 'verified' | 'failed' | null;
  verification_reason?: string | null;
  paystack_recipient_code?: string | null;
  paystack_recipient_id?: string | null;
  stripe_external_account_id?: string | null;
  verified_at?: string | null;
  created_at: string;
  updated_at?: string;
};

type BusinessBankAccountMetadata = {
  is_primary?: boolean;
  payout_provider?: 'stripe' | 'paystack';
  bank_name?: string;
  bank_code?: string;
  account_holder_name?: string;
  account_number?: string;
  routing_number?: string;
  iban?: string;
  swift_code?: string;
  country?: string;
  country_code?: string;
  currency?: string;
  is_verified?: boolean;
  verification_status?: 'pending' | 'verified' | 'failed';
  verification_reason?: string;
  paystack_recipient_code?: string;
  paystack_recipient_id?: string;
  stripe_external_account_id?: string;
  verified_at?: string;
  created_at?: string;
  updated_at?: string;
};

const mapBusinessBankAccountRow = (row: BusinessBankAccountRow): BusinessBankAccount => ({
  id: row.id,
  userId: row.user_id,
  isPrimary: row.is_primary !== false,
  payoutProvider: row.payout_provider || undefined,
  accountName: row.account_holder_name,
  accountNumber: row.account_number,
  routingNumber: row.routing_number || '',
  iban: row.iban || undefined,
  swiftCode: row.swift_code || undefined,
  bankName: row.bank_name,
  bankCode: row.bank_code || undefined,
  country: row.country || undefined,
  countryCode: row.country_code || undefined,
  currency: row.currency || undefined,
  isVerified: row.is_verified,
  verificationStatus: (row.verification_status as any) || (row.is_verified ? 'verified' : 'pending'),
  verificationReason: row.verification_reason || undefined,
  paystackRecipientCode: row.paystack_recipient_code || undefined,
  paystackRecipientId: row.paystack_recipient_id || undefined,
  stripeExternalAccountId: row.stripe_external_account_id || undefined,
  verifiedAt: row.verified_at || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapBusinessBankAccountMetadata = (userId: string, payload: BusinessBankAccountMetadata): BusinessBankAccount | null => {
  if (!payload?.bank_name || !payload?.account_holder_name || !payload?.account_number) {
    return null;
  }

  return {
    id: `meta_${userId}`,
    userId,
    isPrimary: payload.is_primary !== false,
    payoutProvider: payload.payout_provider || undefined,
    bankName: payload.bank_name,
    bankCode: payload.bank_code || undefined,
    accountName: payload.account_holder_name,
    accountNumber: payload.account_number,
    routingNumber: payload.routing_number || '',
    iban: payload.iban || undefined,
    swiftCode: payload.swift_code || undefined,
    country: payload.country || undefined,
    countryCode: payload.country_code || undefined,
    currency: payload.currency || undefined,
    isVerified: payload.is_verified === true,
    verificationStatus: payload.verification_status || (payload.is_verified ? 'verified' : 'pending'),
    verificationReason: payload.verification_reason || undefined,
    paystackRecipientCode: payload.paystack_recipient_code || undefined,
    paystackRecipientId: payload.paystack_recipient_id || undefined,
    stripeExternalAccountId: payload.stripe_external_account_id || undefined,
    verifiedAt: payload.verified_at || undefined,
    createdAt: payload.created_at || new Date().toISOString(),
    updatedAt: payload.updated_at,
  };
};

const isMetadataBackedBusinessBankAccountId = (id?: string | null): boolean => {
  return typeof id === 'string' && id.startsWith('meta_');
};

const isBusinessBankTableUnavailableError = (error: any): boolean => {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  const hasTableContext = message.includes('business_bank_accounts');

  return (
    hasTableContext &&
    (
      message.includes('could not find the table') ||
      message.includes('relation') ||
      message.includes('schema cache') ||
      message.includes('permission denied') ||
      message.includes('row-level security') ||
      code === '42501'
    )
  );
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
};

const resolvePreferredCurrency = (input: {
  walletCurrency?: string | null;
  profileCurrency?: string | null;
  country?: string | null;
  countryCode?: string | null;
}): CurrencyCode => {
  const currencyFromWallet = normalizeCurrencyCode(input.walletCurrency, DEFAULT_CURRENCY);
  const currencyFromProfile = normalizeCurrencyCode(input.profileCurrency, DEFAULT_CURRENCY);
  const currencyFromCountry = normalizeCurrencyCode(
    resolveCurrencyFromCountry({
      country: input.country,
      countryCode: input.countryCode,
      fallbackCurrency: input.profileCurrency || input.walletCurrency || DEFAULT_CURRENCY,
    }),
    DEFAULT_CURRENCY
  );

  if (isSupportedCurrencyCode(input.profileCurrency || '')) {
    return currencyFromProfile;
  }

  if (input.country || input.countryCode) {
    return currencyFromCountry;
  }

  return currencyFromWallet;
};

type StripeBankVerificationResult = {
  verified: boolean;
  verificationStatus: 'pending' | 'verified' | 'failed';
  verificationReason?: string | null;
  stripeExternalAccountId?: string | null;
};

type PaystackBankVerificationResult = {
  verified: boolean;
  verificationStatus: 'pending' | 'verified' | 'failed';
  verificationReason?: string | null;
  accountName?: string | null;
  paystackRecipientCode?: string | null;
  paystackRecipientId?: string | null;
  bankCode?: string | null;
};

const verifyBankAccountWithStripe = async (payload: {
  accountName: string;
  accountNumber: string;
  routingNumber?: string;
  iban?: string;
  currency?: string;
  countryCode?: string;
  stripeExternalAccountId?: string;
  refreshOnly?: boolean;
}): Promise<StripeBankVerificationResult> => {
  const { data, error } = await supabase.functions.invoke('stripe-verify-business-bank-account', {
    body: {
      accountName: payload.accountName,
      accountNumber: payload.accountNumber,
      routingNumber: payload.routingNumber || '',
      iban: payload.iban || '',
      currency: payload.currency || DEFAULT_CURRENCY,
      countryCode: payload.countryCode || '',
      stripeExternalAccountId: payload.stripeExternalAccountId || '',
      refreshOnly: payload.refreshOnly === true,
    },
  });

  if (error) {
    return {
      verified: false,
      verificationStatus: 'failed',
      verificationReason: error.message || 'Stripe verification request failed.',
      stripeExternalAccountId: payload.stripeExternalAccountId || null,
    };
  }

  return {
    verified: data?.verified === true,
    verificationStatus: (data?.verificationStatus as 'pending' | 'verified' | 'failed') || 'failed',
    verificationReason: data?.verificationReason || null,
    stripeExternalAccountId: data?.stripeExternalAccountId || payload.stripeExternalAccountId || null,
  };
};

const verifyBusinessBankAccountWithPaystack = async (payload: {
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankCode?: string;
  countryCode?: string;
  currency?: string;
  paystackRecipientCode?: string;
  refreshOnly?: boolean;
  resolveOnly?: boolean;
}): Promise<PaystackBankVerificationResult> => {
  const { data, error } = await supabase.functions.invoke('paystack-verify-business-bank-account', {
    body: {
      accountName: payload.accountName,
      accountNumber: payload.accountNumber,
      bankName: payload.bankName,
      bankCode: payload.bankCode || '',
      countryCode: payload.countryCode || '',
      currency: payload.currency || DEFAULT_CURRENCY,
      paystackRecipientCode: payload.paystackRecipientCode || '',
      refreshOnly: payload.refreshOnly === true,
      resolveOnly: payload.resolveOnly === true,
    },
  });

  if (error) {
    return {
      verified: false,
      verificationStatus: 'failed',
      verificationReason: error.message || 'Paystack verification request failed.',
      paystackRecipientCode: payload.paystackRecipientCode || null,
      bankCode: payload.bankCode || null,
    };
  }

  return {
    verified: data?.verified === true,
    verificationStatus: (data?.verificationStatus as 'pending' | 'verified' | 'failed') || 'failed',
    verificationReason: data?.verificationReason || null,
    accountName: data?.accountName || payload.accountName,
    paystackRecipientCode: data?.paystackRecipientCode || payload.paystackRecipientCode || null,
    paystackRecipientId: data?.paystackRecipientId || null,
    bankCode: data?.bankCode || payload.bankCode || null,
  };
};

interface WalletState {
  wallet: Wallet | null;
  transactions: Transaction[];
  paymentMethods: PaymentMethod[];
  businessBankAccount: BusinessBankAccount | null;
  withdrawalRequests: WithdrawalRequest[];
  isLoading: boolean;
  error: string | null;
  selectedCurrency: CurrencyCode;
  
  // Actions
  fetchWallet: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  fetchPaymentMethods: () => Promise<void>;
  fetchBusinessBankAccount: () => Promise<void>;
  fetchWithdrawalRequests: () => Promise<void>;
  
  addFunds: (amount: number, paymentMethodId: string, paymentProvider?: 'internal' | 'twint' | 'paystack') => Promise<boolean>;
  makePayment: (amount: number, description: string, metadata: any) => Promise<boolean>;
  transferFunds: (amount: number, recipientId: string, description: string) => Promise<boolean>;
  requestWithdrawal: (amount: number) => Promise<boolean>;
  
  addPaymentMethod: (paymentMethod: Omit<PaymentMethod, 'id' | 'userId' | 'createdAt'>, user?: any) => Promise<boolean>;
  removePaymentMethod: (paymentMethodId: string) => Promise<boolean>;
  setDefaultPaymentMethod: (paymentMethodId: string) => Promise<boolean>;
  
  addBusinessBankAccount: (bankAccount: Omit<BusinessBankAccount, 'id' | 'userId' | 'isVerified' | 'createdAt'>) => Promise<boolean>;
  updateBusinessBankAccount: (bankAccount: Partial<BusinessBankAccount>) => Promise<boolean>;
  
  // Helper functions
  calculateTransactionFee: (amount: number) => number;

  // Currency selection
  setCurrency: (currency: CurrencyCode) => void;
  
  // Testing functions removed for production
  
  // Twint specific functions
  processTwintPayment: (amount: number, description: string, metadata: any) => Promise<boolean>;
  
  // Paystack specific functions
  processPaystackPayment: (amount: number, description: string, metadata: any) => Promise<boolean>;
  verifyPaystackPayment: (reference: string) => Promise<boolean>;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      wallet: null,
      transactions: [],
      paymentMethods: [],
      businessBankAccount: null,
      withdrawalRequests: [],
      isLoading: false,
      error: null,
      selectedCurrency: DEFAULT_CURRENCY,
      
      fetchWallet: async () => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          if (!user) {
            console.log('⚠️ No user found - skipping wallet fetch');
            set({ wallet: null, isLoading: false });
            return;
          }
          
          console.log('🔍 Fetching wallet for user:', user.id);

          const { data: profileData } = await supabase
            .from('profiles')
            .select('currency,country,country_code')
            .eq('id', user.id)
            .maybeSingle();

          const preferredCurrency = resolvePreferredCurrency({
            profileCurrency: profileData?.currency,
            country: profileData?.country,
            countryCode: profileData?.country_code,
          });
          
          // Fetch wallet from Supabase
          const { data: walletData, error: walletError } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', user.id)
            .single();
          
          if (walletError) {
            if (walletError.code === 'PGRST116') {
              // Wallet not found, create one (idempotent to avoid duplicate key races).
              console.log('📝 Creating new wallet for user:', user.id);
              const { data: newWallet, error: createError } = await supabase
                .from('wallets')
                .upsert({
                  user_id: user.id,
                  balance: 0.00,
                  currency: preferredCurrency,
                  is_verified: false
                }, { onConflict: 'user_id' })
                .select()
                .single();
              
              if (createError) {
                // If a concurrent write created the row between read and write, fetch existing row.
                const createMessage = String(createError.message || '').toLowerCase();
                if (createMessage.includes('duplicate key') || createMessage.includes('wallets_user_id_key')) {
                  const { data: existingWallet, error: existingWalletError } = await supabase
                    .from('wallets')
                    .select('*')
                    .eq('user_id', user.id)
                    .single();

                  if (existingWalletError || !existingWallet) {
                    throw new Error(`Failed to fetch existing wallet after duplicate conflict: ${existingWalletError?.message || 'wallet not found'}`);
                  }

                  const selectedCurrency = resolvePreferredCurrency({
                    walletCurrency: existingWallet.currency,
                    profileCurrency: profileData?.currency,
                    country: profileData?.country,
                    countryCode: profileData?.country_code,
                  });

                  set({ wallet: existingWallet, selectedCurrency, isLoading: false });
                  console.log('✅ Wallet fetched after duplicate conflict:', existingWallet);
                  return;
                }

                throw new Error(`Failed to create wallet: ${createError.message}`);
              }

              const selectedCurrency = resolvePreferredCurrency({
                walletCurrency: newWallet.currency,
                profileCurrency: profileData?.currency,
                country: profileData?.country,
                countryCode: profileData?.country_code,
              });
              
              set({ wallet: newWallet, selectedCurrency, isLoading: false });
              console.log('✅ Wallet created successfully:', newWallet);
            } else {
              throw new Error(`Failed to fetch wallet: ${walletError.message}`);
            }
          } else {
            const selectedCurrency = resolvePreferredCurrency({
              walletCurrency: walletData?.currency,
              profileCurrency: profileData?.currency,
              country: profileData?.country,
              countryCode: profileData?.country_code,
            });

            set({ wallet: walletData, selectedCurrency, isLoading: false });
            console.log('✅ Wallet fetched successfully:', walletData);
          }
        } catch (error: any) {
          console.error('❌ Wallet fetch error:', error);
          set({ error: error.message, isLoading: false });
        }
      },
      
      fetchTransactions: async () => {
        set({ isLoading: true, error: null });
        try {
          const { wallet } = get();
          if (!wallet) {
            console.log('⚠️ No wallet found - skipping transactions fetch');
            set({ transactions: [], isLoading: false });
            return;
          }
          
          console.log('🔍 Fetching transactions for wallet:', wallet.id);
          
          // Fetch transactions from Supabase
          const { data: transactionsData, error: transactionsError } = await supabase
            .from('transactions')
            .select('*')
            .eq('wallet_id', wallet.id)
            .order('created_at', { ascending: false });
          
          if (transactionsError) {
            throw new Error(`Failed to fetch transactions: ${transactionsError.message}`);
          }
          
          set({ transactions: transactionsData || [], isLoading: false });
          console.log('✅ Transactions fetched successfully:', transactionsData);
        } catch (error: any) {
          console.error('❌ Transactions fetch error:', error);
          set({ error: error.message, isLoading: false });
        }
      },
      
      fetchPaymentMethods: async () => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          if (!user) {
            console.log('⚠️ No user found - skipping payment methods fetch');
            set({ paymentMethods: [], isLoading: false });
            return;
          }
          
          console.log('🔍 Fetching payment methods for user:', user.id);
          
          // Add timeout to prevent infinite loading
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Payment methods fetch timeout')), 8000);
          });
          
          // Fetch payment methods from Supabase
          const fetchPromise = supabase
            .from('payment_methods')
            .select('*')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .order('created_at', { ascending: false });
          
          const { data: paymentMethodsData, error: paymentMethodsError } = await Promise.race([
            fetchPromise,
            timeoutPromise
          ]) as any;
          
          if (paymentMethodsError) {
            if (paymentMethodsError.message === 'Payment methods fetch timeout') {
              console.log('⏰ Payment methods fetch timeout - using empty array');
            } else {
              console.log('⚠️ Payment methods fetch error:', paymentMethodsError.message);
            }
            set({ paymentMethods: [], isLoading: false });
            return;
          }
          
          set({ paymentMethods: paymentMethodsData || [], isLoading: false });
          console.log('✅ Payment methods fetched successfully:', paymentMethodsData);
        } catch (error: any) {
          console.error('❌ Payment methods fetch error:', error);
          // Don't fail completely, just show empty state
          set({ paymentMethods: [], isLoading: false, error: null });
        }
      },
      
      fetchBusinessBankAccount: async () => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          if (!user) {
            throw new Error('User not authenticated');
          }
          
          if (!user.isBusinessAccount) {
            set({ businessBankAccount: null, isLoading: false });
            return;
          }

          const { data, error } = await withTimeout(
            (supabase as any)
              .from('business_bank_accounts')
              .select('*')
              .eq('user_id', user.id)
              .eq('is_active', true)
              .maybeSingle(),
            12000,
            'Bank account fetch timeout'
          );

          if (error && isBusinessBankTableUnavailableError(error)) {
            const { data: authData, error: authError } = await supabase.auth.getUser();
            if (authError) {
              throw new Error(`Failed to fetch bank account metadata: ${authError.message}`);
            }

            const metadataPayload = (authData.user?.user_metadata as any)?.business_bank_account as BusinessBankAccountMetadata | undefined;
            let mappedFromMetadata = mapBusinessBankAccountMetadata(user.id, metadataPayload || {});

            if (
              mappedFromMetadata &&
              !mappedFromMetadata.isVerified &&
              mappedFromMetadata.payoutProvider === 'paystack' &&
              (mappedFromMetadata.paystackRecipientCode || mappedFromMetadata.bankCode || mappedFromMetadata.bankName)
            ) {
              const verification = await verifyBusinessBankAccountWithPaystack({
                accountName: mappedFromMetadata.accountName,
                accountNumber: mappedFromMetadata.accountNumber,
                bankName: mappedFromMetadata.bankName,
                bankCode: mappedFromMetadata.bankCode,
                currency: mappedFromMetadata.currency,
                countryCode: mappedFromMetadata.countryCode,
                refreshOnly: true,
                paystackRecipientCode: mappedFromMetadata.paystackRecipientCode,
              });

              const existingMeta = (authData.user?.user_metadata || {}) as Record<string, any>;
              const refreshedMeta: BusinessBankAccountMetadata = {
                ...(metadataPayload || {}),
                is_verified: verification.verified,
                verification_status: verification.verificationStatus,
                verification_reason: verification.verificationReason || undefined,
                payout_provider: 'paystack',
                bank_code: verification.bankCode || mappedFromMetadata.bankCode || undefined,
                paystack_recipient_code: verification.paystackRecipientCode || mappedFromMetadata.paystackRecipientCode,
                paystack_recipient_id: verification.paystackRecipientId || mappedFromMetadata.paystackRecipientId,
                verified_at: verification.verified ? new Date().toISOString() : undefined,
                updated_at: new Date().toISOString(),
              };

              const { data: updatedUserData } = await supabase.auth.updateUser({
                data: {
                  ...existingMeta,
                  business_bank_account: refreshedMeta,
                },
              });

              mappedFromMetadata = mapBusinessBankAccountMetadata(
                user.id,
                ((updatedUserData.user?.user_metadata as any)?.business_bank_account || refreshedMeta) as BusinessBankAccountMetadata
              );
            }

            set({
              businessBankAccount: mappedFromMetadata,
              isLoading: false,
            });
            return;
          }

          if (error) {
            throw new Error(`Failed to fetch bank account: ${error.message}`);
          }

          let mappedFromTable = data ? mapBusinessBankAccountRow(data as BusinessBankAccountRow) : null;

          if (
            mappedFromTable &&
            !mappedFromTable.isVerified &&
            mappedFromTable.payoutProvider === 'paystack' &&
            (mappedFromTable.paystackRecipientCode || mappedFromTable.bankCode || mappedFromTable.bankName)
          ) {
            const verification = await verifyBusinessBankAccountWithPaystack({
              accountName: mappedFromTable.accountName,
              accountNumber: mappedFromTable.accountNumber,
              bankName: mappedFromTable.bankName,
              bankCode: mappedFromTable.bankCode,
              currency: mappedFromTable.currency,
              countryCode: mappedFromTable.countryCode,
              refreshOnly: true,
              paystackRecipientCode: mappedFromTable.paystackRecipientCode,
            });

            const verificationUpdatePayload = {
              is_verified: verification.verified,
              verification_status: verification.verificationStatus,
              verification_reason: verification.verificationReason || null,
              payout_provider: 'paystack',
              bank_code: verification.bankCode || mappedFromTable.bankCode || null,
              paystack_recipient_code: verification.paystackRecipientCode || mappedFromTable.paystackRecipientCode || null,
              paystack_recipient_id: verification.paystackRecipientId || mappedFromTable.paystackRecipientId || null,
              verified_at: verification.verified ? new Date().toISOString() : null,
            };

            mappedFromTable = {
              ...mappedFromTable,
              isVerified: verification.verified,
              verificationStatus: verification.verificationStatus,
              verificationReason: verification.verificationReason || undefined,
              payoutProvider: 'paystack',
              bankCode: verification.bankCode || mappedFromTable.bankCode,
              paystackRecipientCode: verification.paystackRecipientCode || mappedFromTable.paystackRecipientCode,
              paystackRecipientId: verification.paystackRecipientId || mappedFromTable.paystackRecipientId,
              verifiedAt: verification.verified ? new Date().toISOString() : undefined,
            };

            const { data: refreshedRow } = await (supabase as any)
              .from('business_bank_accounts')
              .update(verificationUpdatePayload)
              .eq('id', mappedFromTable.id)
              .select('*')
              .maybeSingle();

            if (refreshedRow) {
              mappedFromTable = mapBusinessBankAccountRow(refreshedRow as BusinessBankAccountRow);
            }
          }

          set({
            businessBankAccount: mappedFromTable,
            isLoading: false,
          });
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
        }
      },
      
      fetchWithdrawalRequests: async () => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          if (!user) {
            throw new Error('User not authenticated');
          }
          
          if (!user.isBusinessAccount) {
            set({ withdrawalRequests: [], isLoading: false });
            return;
          }
          
          // In a real app, this would be an API call
          // Simulating network delay
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // TODO: Implement withdrawal requests fetching from Supabase
          const requests: any[] = []; // mockWithdrawalRequests.filter(wr => wr.userId === user.id);
          set({ withdrawalRequests: requests, isLoading: false });
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
        }
      },
      
      addFunds: async (amount: number, paymentMethodId: string, paymentProvider: 'internal' | 'twint' | 'paystack' = 'internal') => {
        set({ isLoading: true, error: null });
        try {
          const { wallet, transactions, paymentMethods } = get();
          if (!wallet) {
            throw new Error('Wallet not initialized');
          }
          
          // Find the payment method
          const paymentMethod = paymentMethods.find(pm => pm.id === paymentMethodId);
          if (!paymentMethod) {
            throw new Error('Payment method not found');
          }
          
          // In a real app, this would be an API call to process payment
          // Simulating network delay
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Create new transaction
          const newTransaction: Transaction = {
            id: Date.now().toString(),
            walletId: wallet.id,
            amount: amount,
            type: 'deposit',
            status: 'completed',
            description: `Added funds to wallet${paymentProvider === 'twint' ? ' via Twint' : paymentProvider === 'paystack' ? ' via Paystack' : ''}`,
            metadata: {
              paymentMethodId,
              paymentProvider,
              twintTransactionId: paymentProvider === 'twint' ? `twint_deposit_${Date.now()}` : undefined,
              paystackReference: paymentProvider === 'paystack' ? `paystack_ref_${Date.now()}` : undefined,
              paystackTransactionId: paymentProvider === 'paystack' ? `paystack_${Date.now()}` : undefined
            },
            createdAt: new Date().toISOString(),
          };
          
          // Update wallet balance
          const updatedWallet: Wallet = {
            ...wallet,
            balance: wallet.balance + amount,
            updatedAt: new Date().toISOString(),
          };
          
          set({
            wallet: updatedWallet,
            transactions: [newTransaction, ...transactions],
            isLoading: false,
          });
          
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      calculateTransactionFee: (amount: number) => {
        return parseFloat((amount * TRANSACTION_FEE_PERCENTAGE).toFixed(2));
      },

      setCurrency: (currency: CurrencyCode) => {
        set({ selectedCurrency: currency });
      },
      
      // createMockUser removed for production
      
      processTwintPayment: async (amount: number, description: string, metadata: any) => {
        set({ isLoading: true, error: null });
        try {
          // In a real app, this would be an API call to the Twint payment gateway
          // For now, we'll simulate a successful payment
          
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Generate a Twint transaction ID
          const twintTransactionId = `twint_${Date.now()}`;
          
          // Return success
          set({ isLoading: false });
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      processPaystackPayment: async (amount: number, description: string, metadata: any) => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          if (!user) {
            throw new Error('User must be authenticated to process payment');
          }
          const currentUser = user;

          // Import PaystackService dynamically to avoid circular dependencies
          const { default: PaystackService } = await import('@/lib/paystack');
          
          // Generate a unique reference
          const reference = PaystackService.generateReference();
          
          // Get user's wallet ID
          const { wallet } = get();
          if (!wallet) {
            throw new Error('Wallet not found. Please create a wallet first.');
          }
          
          // Get the current wallet
          const currentWallet = get().wallet;
          if (!currentWallet) {
            throw new Error('Failed to create wallet for payment');
          }
          
          // Initialize payment with Paystack
          const paymentData = await PaystackService.initializePayment({
            email: currentUser.email || 'user@example.com',
            amount,
            currency: 'NGN', // Use NGN for Paystack
            reference,
            userId: currentUser.id,
            walletId: currentWallet.id,
            paymentType: 'wallet_funding',
            metadata: {
              ...metadata,
              description,
              type: 'wallet_funding',
            },
          });
          
          console.log('Paystack payment initialized:', paymentData);
          
          // Return success with reference
          set({ 
            isLoading: false,
            error: null
          });
          
          return true;
        } catch (error: any) {
          console.error('Paystack payment error:', error);
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      verifyPaystackPayment: async (reference: string) => {
        set({ isLoading: true, error: null });
        try {
          // Import PaystackService dynamically to avoid circular dependencies
          const { default: PaystackService } = await import('@/lib/paystack');
          
          // Verify payment with Paystack
          const verification = await PaystackService.verifyPayment(reference);
          
          if (verification.data.status === 'success') {
            console.log('Paystack payment verified successfully:', verification.data);
            set({ isLoading: false });
            return true;
          } else {
            throw new Error(`Payment verification failed: ${verification.data.status}`);
          }
        } catch (error: any) {
          console.error('Paystack verification error:', error);
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      makePayment: async (amount: number, description: string, metadata: any) => {
        set({ isLoading: true, error: null });
        try {
          const { wallet, transactions, calculateTransactionFee } = get();
          
          // Check if this is a Twint or Paystack payment
          const isTwintPayment = metadata.paymentProvider === 'twint';
          const isPaystackPayment = metadata.paymentProvider === 'paystack';
          const isStripePayment = metadata.paymentProvider === 'stripe';
          
          if (!isTwintPayment && !isPaystackPayment && !isStripePayment && !wallet) {
            throw new Error('Wallet not initialized');
          }
          
          // Calculate the 5% platform fee
          const fee = calculateTransactionFee(amount);
          const totalAmount = amount + fee;
          
          // For wallet payments, check balance
          if (!isTwintPayment && !isPaystackPayment && !isStripePayment && wallet && wallet.balance < totalAmount) {
            throw new Error('Insufficient funds');
          }
          
          // In a real app, this would be an API call to process payment
          // Simulating network delay
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Generate transaction ID
          const transactionId = Date.now().toString();
          
          // For Twint or Paystack payments, we would process through their respective APIs
          if (isStripePayment) {
            set({
              isLoading: false,
            });
            return true;
          }

          if (isTwintPayment || isPaystackPayment) {
            // Create order in Supabase for external payments
            const { user } = useAuthStore.getState();
            if (!user) {
              throw new Error('User not authenticated');
            }

            // Create order record in Supabase
            const { data: orderData, error: orderError } = await supabase
              .from('orders')
              .insert({
                user_id: user.id,
                business_id: metadata.recipientId,
                order_date: new Date().toISOString(),
                items: metadata.cartItems || [],
                payment_method: isTwintPayment ? 'twint' : 'paystack',
                total_amount: amount,
                status: 'pending',
                payment_status: 'pending',
                payment_provider: isTwintPayment ? 'twint' : 'paystack',
                payment_metadata: metadata
              })
              .select()
              .single();

            if (orderError) {
              throw new Error(`Failed to create order: ${orderError.message}`);
            }

            // Initialize external payment
            let paymentData;
            if (isPaystackPayment) {
              const { default: PaystackService } = await import('@/lib/paystack');
              paymentData = await PaystackService.initializePayment({
                email: user.email || 'user@example.com',
                amount: amount,
                currency: 'USD',
                userId: user.id,
                orderId: orderData.id,
                paymentType: 'order_payment',
                metadata: {
                  ...metadata,
                  description,
                  orderId: orderData.id,
                  businessId: metadata.recipientId
                }
              });
            } else if (isTwintPayment) {
              const { default: WorldlineService } = await import('@/lib/worldline');
              paymentData = await WorldlineService.initializePayment({
                amount: amount,
                currency: 'USD',
                orderId: orderData.id,
                customerEmail: user.email || 'user@example.com',
                customerName: user.name || 'User',
                description: description,
                userId: user.id,
                paymentType: 'order_payment',
                metadata: {
                  ...metadata,
                  description,
                  orderId: orderData.id,
                  businessId: metadata.recipientId
                }
              });
            }

            console.log('External payment initialized:', paymentData);
            
            set({
              isLoading: false,
            });
            
            return true;
          }
          
          // Standard wallet payment flow
          // Create new transaction for the payment (including fee)
          const newTransaction: Transaction = {
            id: transactionId,
            walletId: wallet!.id,
            amount: -totalAmount, // Negative amount for payment (includes fee)
            type: 'payment',
            status: 'completed',
            description,
            transactionFee: fee,
            metadata: {
              ...metadata,
              subtotal: amount,
              feeRecipientId: PLATFORM_ACCOUNT_ID,
              paymentProvider: 'internal'
            },
            createdAt: new Date().toISOString(),
          };
          
          // Create a separate transaction for the platform fee
          const feeTransaction: Transaction = {
            id: `fee_${transactionId}`,
            walletId: PLATFORM_WALLET_ID,
            amount: fee,
            type: 'fee',
            status: 'completed',
            description: `Platform fee for ${description}`,
            metadata: {
              originalTransactionId: transactionId,
              businessId: metadata.recipientId,
              paymentProvider: 'internal'
            },
            createdAt: new Date().toISOString(),
          };
          
          // Create a transaction for the business (recipient) - they receive the amount minus fee
          const businessTransaction: Transaction = {
            id: `business_${transactionId}`,
            walletId: metadata.recipientId, // Business wallet ID
            amount: amount, // Original amount without fee
            type: 'payment',
            status: 'completed',
            description: `Payment received: ${description}`,
            metadata: {
              originalTransactionId: transactionId,
              senderId: wallet!.userId,
              paymentProvider: 'internal'
            },
            createdAt: new Date().toISOString(),
          };
          
          // Update wallet balance for standard wallet payments
          const updatedWallet: Wallet = {
            ...wallet!,
            balance: wallet!.balance - totalAmount,
            updatedAt: new Date().toISOString(),
          };
          
          set({
            wallet: updatedWallet,
            transactions: [newTransaction, feeTransaction, businessTransaction, ...transactions],
            isLoading: false,
          });
          
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      transferFunds: async (amount: number, recipientId: string, description: string) => {
        set({ isLoading: true, error: null });
        try {
          const { wallet, transactions, calculateTransactionFee } = get();
          if (!wallet) {
            throw new Error('Wallet not initialized');
          }
          
          // Calculate the 5% platform fee
          const fee = calculateTransactionFee(amount);
          const totalAmount = amount + fee;
          
          if (wallet.balance < totalAmount) {
            throw new Error('Insufficient funds');
          }
          
          // In a real app, this would be an API call to process transfer
          // Simulating network delay
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Generate transaction ID
          const transactionId = Date.now().toString();
          
          // Create new transaction for the transfer (including fee)
          const newTransaction: Transaction = {
            id: transactionId,
            walletId: wallet.id,
            amount: -totalAmount, // Negative amount for transfer out (includes fee)
            type: 'transfer',
            status: 'completed',
            description,
            transactionFee: fee,
            metadata: {
              recipientId,
              subtotal: amount,
              feeRecipientId: PLATFORM_ACCOUNT_ID,
              paymentProvider: 'internal'
            },
            createdAt: new Date().toISOString(),
          };
          
          // Create a separate transaction for the platform fee
          const feeTransaction: Transaction = {
            id: `fee_${transactionId}`,
            walletId: PLATFORM_WALLET_ID,
            amount: fee,
            type: 'fee',
            status: 'completed',
            description: `Platform fee for ${description}`,
            metadata: {
              originalTransactionId: transactionId,
              senderId: wallet.userId,
              recipientId,
              paymentProvider: 'internal'
            },
            createdAt: new Date().toISOString(),
          };
          
          // Create a transaction for the recipient - they receive the amount minus fee
          const recipientTransaction: Transaction = {
            id: `recipient_${transactionId}`,
            walletId: recipientId,
            amount: amount, // Original amount without fee
            type: 'transfer',
            status: 'completed',
            description: `Transfer received: ${description}`,
            metadata: {
              originalTransactionId: transactionId,
              senderId: wallet.userId,
              paymentProvider: 'internal'
            },
            createdAt: new Date().toISOString(),
          };
          
          // Update wallet balance
          const updatedWallet: Wallet = {
            ...wallet,
            balance: wallet.balance - totalAmount,
            updatedAt: new Date().toISOString(),
          };
          
          set({
            wallet: updatedWallet,
            transactions: [newTransaction, feeTransaction, recipientTransaction, ...transactions],
            isLoading: false,
          });
          
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      requestWithdrawal: async (amount: number) => {
        set({ isLoading: true, error: null });
        try {
          const { wallet, businessBankAccount, withdrawalRequests } = get();
          const { user } = useAuthStore.getState();
          
          if (!wallet) {
            throw new Error('Wallet not initialized');
          }
          
          if (!user?.isBusinessAccount) {
            throw new Error('Only business accounts can withdraw funds');
          }
          
          if (!businessBankAccount) {
            throw new Error('No bank account linked to your profile');
          }

          if (!businessBankAccount.isVerified) {
            const reason = businessBankAccount.verificationReason || 'Your bank account is still pending Stripe verification.';
            throw new Error(`Bank account not verified. ${reason}`);
          }

          const usesPaystackPayout = businessBankAccount.payoutProvider === 'paystack' && String(businessBankAccount.countryCode || '').toUpperCase() === 'NG';
          
          if (wallet.balance < amount) {
            throw new Error('Insufficient funds');
          }

          const { data, error } = await (supabase as any)
            .from('withdrawal_requests')
            .insert({
              user_id: user.id,
              amount,
              status: 'pending',
              business_bank_account_id: businessBankAccount.id,
              processing_fee: 0,
            })
            .select('*')
            .single();

          if (error || !data) {
            throw new Error(`Failed to create withdrawal request: ${error?.message || 'unknown error'}`);
          }

          if (usesPaystackPayout) {
            const { data: payoutData, error: payoutError } = await supabase.functions.invoke('paystack-withdraw-business-bank-account', {
              body: {
                amount,
                withdrawalRequestId: data.id,
                businessBankAccountId: businessBankAccount.id,
                bankName: businessBankAccount.bankName,
                accountName: businessBankAccount.accountName,
                accountNumber: businessBankAccount.accountNumber,
                bankCode: businessBankAccount.bankCode || '',
                paystackRecipientCode: businessBankAccount.paystackRecipientCode || '',
                countryCode: businessBankAccount.countryCode || '',
                currency: businessBankAccount.currency || get().selectedCurrency || DEFAULT_CURRENCY,
              },
            });

            if (payoutError) {
              await (supabase as any)
                .from('withdrawal_requests')
                .update({ status: 'failed' })
                .eq('id', data.id);
              throw new Error(payoutError.message || 'Failed to initiate Paystack withdrawal');
            }

            if (payoutData?.status) {
              await (supabase as any)
                .from('withdrawal_requests')
                .update({ status: payoutData.status })
                .eq('id', data.id);
            }
          }

          const withdrawalStatus = usesPaystackPayout ? 'processing' : data.status;

          const newWithdrawalRequest: WithdrawalRequest = {
            id: data.id,
            userId: data.user_id,
            amount: Number(data.amount || amount),
            status: withdrawalStatus,
            businessBankAccountId: data.business_bank_account_id,
            createdAt: data.created_at,
          };
          
          set({
            withdrawalRequests: [newWithdrawalRequest, ...withdrawalRequests],
            isLoading: false,
          });
          
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      addPaymentMethod: async (paymentMethod, userParam) => {
        console.log("=== WALLET STORE: addPaymentMethod ===");
        console.log("Input paymentMethod:", paymentMethod);
        console.log("Input userParam:", userParam);
        
        set({ isLoading: true, error: null });
        try {
          // Use passed user parameter or get from store
          const user = userParam || useAuthStore.getState().user;
          
          console.log("User:", user);
          
          if (!user) {
            throw new Error("User must be authenticated to add payment method");
          }
          
          // If this is set as default, update other payment methods first
          if (paymentMethod.isDefault) {
            console.log("🔄 Setting other payment methods as non-default");
            await supabase
              .from('payment_methods')
              .update({ is_default: false })
              .eq('user_id', user.id);
          }
          
          // Insert new payment method to Supabase
          const { data: newPaymentMethod, error: insertError } = await supabase
            .from('payment_methods')
            .insert({
              user_id: user.id,
              type: paymentMethod.type,
              is_default: paymentMethod.isDefault || false,
              nickname: paymentMethod.nickname,
              last_four: paymentMethod.lastFour,
              expiry_date: paymentMethod.expiryDate,
              card_type: paymentMethod.cardType,
              bank_name: paymentMethod.bankName,
              account_type: paymentMethod.accountType,
              twint_phone_number: paymentMethod.twintPhoneNumber,
              paystack_email: paymentMethod.paystackEmail,
              paystack_auth_code: paymentMethod.paystackAuthCode,
              worldline_customer_id: paymentMethod.worldlineCustomerId,
              worldline_payment_method_id: paymentMethod.worldlinePaymentMethodId,
              metadata: (paymentMethod as any).metadata,
              is_active: true
            })
            .select()
            .single();
          
          if (insertError) {
            throw new Error(`Failed to add payment method: ${insertError.message}`);
          }
          
          console.log("✅ Payment method added to Supabase:", newPaymentMethod);
          
          // Refresh payment methods from database
          await get().fetchPaymentMethods();
          
          console.log("✅ Payment method added successfully");
          return true;
        } catch (error: any) {
          console.log("❌ Error adding payment method:", error);
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      removePaymentMethod: async (paymentMethodId) => {
        set({ isLoading: true, error: null });
        try {
          const { paymentMethods } = get();
          
          // In a real app, this would be an API call to remove payment method
          // Simulating network delay
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const methodToRemove = paymentMethods.find(pm => pm.id === paymentMethodId);
          if (!methodToRemove) {
            throw new Error('Payment method not found');
          }
          
          // If removing the default payment method, set another one as default
          let updatedPaymentMethods = paymentMethods.filter(pm => pm.id !== paymentMethodId);
          if (methodToRemove.isDefault && updatedPaymentMethods.length > 0) {
            updatedPaymentMethods[0].isDefault = true;
          }
          
          set({
            paymentMethods: updatedPaymentMethods,
            isLoading: false,
          });
          
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      setDefaultPaymentMethod: async (paymentMethodId) => {
        set({ isLoading: true, error: null });
        try {
          const { paymentMethods } = get();
          
          // In a real app, this would be an API call to update payment method
          // Simulating network delay
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const updatedPaymentMethods = paymentMethods.map(pm => ({
            ...pm,
            isDefault: pm.id === paymentMethodId,
          }));
          
          set({
            paymentMethods: updatedPaymentMethods,
            isLoading: false,
          });
          
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      addBusinessBankAccount: async (bankAccount) => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          
          if (!user) {
            throw new Error('User not authenticated');
          }
          
          if (!user.isBusinessAccount) {
            throw new Error('Only business accounts can add bank accounts');
          }

          const payoutProvider = bankAccount.payoutProvider || 'stripe';
          const isPaystackSelection = payoutProvider === 'paystack' && String(bankAccount.countryCode || '').toUpperCase() === 'NG';
          const now = new Date().toISOString();

          if (isPaystackSelection) {
            const verification = await verifyBusinessBankAccountWithPaystack({
              accountName: bankAccount.accountName,
              accountNumber: bankAccount.accountNumber,
              bankName: bankAccount.bankName,
              bankCode: bankAccount.bankCode,
              countryCode: bankAccount.countryCode,
              currency: bankAccount.currency || get().selectedCurrency || DEFAULT_CURRENCY,
            });

            if (verification.verificationStatus === 'failed' && !verification.verified) {
              throw new Error(verification.verificationReason || 'Paystack bank verification failed');
            }

            const resolvedAccountName = verification.accountName || bankAccount.accountName;

            const paystackBasePayload = {
              user_id: user.id,
              is_primary: true,
              payout_provider: 'paystack' as const,
              bank_name: bankAccount.bankName,
              account_holder_name: resolvedAccountName,
              account_number: bankAccount.accountNumber,
              routing_number: bankAccount.routingNumber || null,
              country: bankAccount.country || (user as any)?.country || 'Unknown',
              country_code: bankAccount.countryCode || 'NG',
              currency: bankAccount.currency || get().selectedCurrency || DEFAULT_CURRENCY,
              is_verified: verification.verified,
              verification_status: verification.verificationStatus,
              verification_reason: verification.verificationReason || null,
              stripe_external_account_id: null,
              verified_at: verification.verified ? now : null,
              is_active: true,
            };

            const paystackExtendedPayload = {
              ...paystackBasePayload,
              bank_code: verification.bankCode || bankAccount.bankCode || null,
              iban: bankAccount.iban || null,
              swift_code: bankAccount.swiftCode || null,
              paystack_recipient_code: verification.paystackRecipientCode || null,
              paystack_recipient_id: verification.paystackRecipientId || null,
            };

            let data: any = null;
            let error: any = null;

            ({ data, error } = await withTimeout(
              (supabase as any)
                .from('business_bank_accounts')
                .upsert(paystackExtendedPayload, { onConflict: 'user_id' })
                .select('*')
                .single(),
              12000,
              'Bank account save timeout'
            ));

            if (error && /column|bank_code|paystack_recipient|iban|swift_code|schema cache/i.test(error.message || '')) {
              ({ data, error } = await withTimeout(
                (supabase as any)
                  .from('business_bank_accounts')
                  .upsert(paystackBasePayload, { onConflict: 'user_id' })
                  .select('*')
                  .single(),
                12000,
                'Bank account save timeout'
              ));
            }

            if (error && isBusinessBankTableUnavailableError(error)) {
              const { data: authData, error: authErr } = await supabase.auth.getUser();
              if (authErr || !authData.user) {
                throw new Error(`Failed to save bank metadata: ${authErr?.message || 'User not found'}`);
              }

              const existingMeta = (authData.user.user_metadata || {}) as Record<string, any>;
              const metadataPayload: BusinessBankAccountMetadata = {
                is_primary: true,
                payout_provider: 'paystack',
                bank_name: bankAccount.bankName,
                bank_code: verification.bankCode || bankAccount.bankCode || '',
                account_holder_name: resolvedAccountName,
                account_number: bankAccount.accountNumber,
                routing_number: bankAccount.routingNumber || '',
                iban: bankAccount.iban || '',
                swift_code: bankAccount.swiftCode || '',
                country: bankAccount.country || (user as any)?.country || 'Unknown',
                country_code: bankAccount.countryCode || 'NG',
                currency: bankAccount.currency || get().selectedCurrency || DEFAULT_CURRENCY,
                is_verified: verification.verified,
                verification_status: verification.verificationStatus,
                verification_reason: verification.verificationReason || undefined,
                paystack_recipient_code: verification.paystackRecipientCode || undefined,
                paystack_recipient_id: verification.paystackRecipientId || undefined,
                stripe_external_account_id: undefined,
                verified_at: verification.verified ? now : undefined,
                created_at: existingMeta.business_bank_account?.created_at || now,
                updated_at: now,
              };

              const { data: updatedUserData, error: updateMetaErr } = await supabase.auth.updateUser({
                data: {
                  ...existingMeta,
                  business_bank_account: metadataPayload,
                },
              });

              if (updateMetaErr) {
                throw new Error(`Failed to save bank metadata: ${updateMetaErr.message}`);
              }

              const mappedFromMetadata = mapBusinessBankAccountMetadata(
                user.id,
                ((updatedUserData.user?.user_metadata as any)?.business_bank_account || metadataPayload) as BusinessBankAccountMetadata
              );

              set({
                businessBankAccount: mappedFromMetadata,
                isLoading: false,
              });

              return true;
            }

            if (error) {
              throw new Error(`Failed to save Paystack bank account: ${error.message}`);
            }

            set({
              businessBankAccount: mapBusinessBankAccountRow(data as BusinessBankAccountRow),
              isLoading: false,
            });

            return true;
          }

          const basePayload = {
            user_id: user.id,
            is_primary: true,
            payout_provider: payoutProvider,
            bank_name: bankAccount.bankName,
            account_holder_name: bankAccount.accountName,
            account_number: bankAccount.accountNumber,
            routing_number: bankAccount.routingNumber || null,
            country: bankAccount.country || (user as any)?.country || 'Unknown',
            country_code: bankAccount.countryCode || null,
            currency: bankAccount.currency || get().selectedCurrency || DEFAULT_CURRENCY,
            is_verified: true,
            verification_status: 'verified' as const,
            verification_reason: null,
            stripe_external_account_id: null,
            paystack_recipient_code: null,
            paystack_recipient_id: null,
            verified_at: now,
            is_active: true,
          };

          const extendedPayload = {
            ...basePayload,
            bank_code: bankAccount.bankCode || null,
            iban: bankAccount.iban || null,
            swift_code: bankAccount.swiftCode || null,
          };

          let data: any = null;
          let error: any = null;

          ({ data, error } = await withTimeout(
            (supabase as any)
              .from('business_bank_accounts')
              .upsert(extendedPayload, { onConflict: 'user_id' })
              .select('*')
              .single(),
            12000,
            'Bank account save timeout'
          ));

          if (error && /column|iban|swift_code/i.test(error.message || '')) {
            ({ data, error } = await withTimeout(
              (supabase as any)
                .from('business_bank_accounts')
                .upsert(basePayload, { onConflict: 'user_id' })
                .select('*')
                .single(),
              12000,
              'Bank account save timeout'
            ));
          }

          if (error && isBusinessBankTableUnavailableError(error)) {
            const { data: authData, error: authErr } = await supabase.auth.getUser();
            if (authErr || !authData.user) {
              throw new Error(`Failed to save bank metadata: ${authErr?.message || 'User not found'}`);
            }

            const existingMeta = (authData.user.user_metadata || {}) as Record<string, any>;
            const metadataPayload: BusinessBankAccountMetadata = {
              is_primary: true,
              payout_provider: payoutProvider,
              bank_name: bankAccount.bankName,
              bank_code: bankAccount.bankCode || '',
              account_holder_name: bankAccount.accountName,
              account_number: bankAccount.accountNumber,
              routing_number: bankAccount.routingNumber || '',
              iban: bankAccount.iban || '',
              swift_code: bankAccount.swiftCode || '',
              country: bankAccount.country || (user as any)?.country || 'Unknown',
              country_code: bankAccount.countryCode || '',
              currency: bankAccount.currency || get().selectedCurrency || DEFAULT_CURRENCY,
              is_verified: true,
              verification_status: 'verified',
              verification_reason: undefined,
              paystack_recipient_code: undefined,
              paystack_recipient_id: undefined,
              stripe_external_account_id: undefined,
              verified_at: now,
              created_at: existingMeta.business_bank_account?.created_at || now,
              updated_at: now,
            };

            const { data: updatedUserData, error: updateMetaErr } = await supabase.auth.updateUser({
              data: {
                ...existingMeta,
                business_bank_account: metadataPayload,
              },
            });

            if (updateMetaErr) {
              throw new Error(`Failed to save bank metadata: ${updateMetaErr.message}`);
            }

            const mappedFromMetadata = mapBusinessBankAccountMetadata(
              user.id,
              ((updatedUserData.user?.user_metadata as any)?.business_bank_account || metadataPayload) as BusinessBankAccountMetadata
            );

            set({
              businessBankAccount: mappedFromMetadata,
              isLoading: false,
            });

            return true;
          }

          if (error) {
            throw new Error(`Failed to save bank account: ${error.message}`);
          }

          const mappedFromTable = mapBusinessBankAccountRow(data as BusinessBankAccountRow);

          set({
            businessBankAccount: mappedFromTable,
            isLoading: false,
          });
          
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      updateBusinessBankAccount: async (bankAccount) => {
        set({ isLoading: true, error: null });
        try {
          const { businessBankAccount } = get();
          const { user } = useAuthStore.getState();
          
          if (!businessBankAccount) {
            throw new Error('No bank account to update');
          }

          if (!user) {
            throw new Error('User not authenticated');
          }

          const resolvedPayoutProvider = bankAccount.payoutProvider || businessBankAccount.payoutProvider || 'stripe';
          const isPaystackSelection = resolvedPayoutProvider === 'paystack' && String(bankAccount.countryCode || businessBankAccount.countryCode || '').toUpperCase() === 'NG';

          if (isPaystackSelection) {
            const verification = await verifyBusinessBankAccountWithPaystack({
              accountName: bankAccount.accountName || businessBankAccount.accountName,
              accountNumber: bankAccount.accountNumber || businessBankAccount.accountNumber,
              bankName: bankAccount.bankName || businessBankAccount.bankName,
              bankCode: bankAccount.bankCode || businessBankAccount.bankCode,
              countryCode: bankAccount.countryCode || businessBankAccount.countryCode,
              currency: bankAccount.currency || businessBankAccount.currency,
              paystackRecipientCode: businessBankAccount.paystackRecipientCode,
            });

            if (verification.verificationStatus === 'failed' && !verification.verified) {
              throw new Error(verification.verificationReason || 'Paystack bank verification failed');
            }

            const nowIso = new Date().toISOString();
            const resolvedAccountName = verification.accountName || bankAccount.accountName || businessBankAccount.accountName;

            const paystackBasePayload: Record<string, any> = {
              is_primary: true,
              payout_provider: 'paystack',
              bank_name: bankAccount.bankName ?? businessBankAccount.bankName,
              account_holder_name: resolvedAccountName,
              account_number: bankAccount.accountNumber ?? businessBankAccount.accountNumber,
              routing_number: bankAccount.routingNumber !== undefined ? bankAccount.routingNumber || null : businessBankAccount.routingNumber || null,
              country: bankAccount.country ?? businessBankAccount.country,
              country_code: (bankAccount.countryCode ?? businessBankAccount.countryCode) || 'NG',
              currency: bankAccount.currency ?? businessBankAccount.currency,
              is_verified: verification.verified,
              verification_status: verification.verificationStatus,
              verification_reason: verification.verificationReason || null,
              stripe_external_account_id: null,
              verified_at: verification.verified ? nowIso : null,
            };

            const paystackExtendedPayload: Record<string, any> = {
              ...paystackBasePayload,
              bank_code: verification.bankCode || bankAccount.bankCode || businessBankAccount.bankCode || null,
              iban: bankAccount.iban !== undefined ? bankAccount.iban || null : businessBankAccount.iban || null,
              swift_code: bankAccount.swiftCode !== undefined ? bankAccount.swiftCode || null : businessBankAccount.swiftCode || null,
              paystack_recipient_code: verification.paystackRecipientCode || businessBankAccount.paystackRecipientCode || null,
              paystack_recipient_id: verification.paystackRecipientId || businessBankAccount.paystackRecipientId || null,
            };

            let data: any = null;
            let error: any = null;

            ({ data, error } = await withTimeout(
              (supabase as any)
                .from('business_bank_accounts')
                .update(paystackExtendedPayload)
                .eq('id', businessBankAccount.id)
                .select('*')
                .single(),
              12000,
              'Bank account update timeout'
            ));

            if (error && /column|bank_code|paystack_recipient|iban|swift_code|schema cache/i.test(error.message || '')) {
              ({ data, error } = await withTimeout(
                (supabase as any)
                  .from('business_bank_accounts')
                  .update(paystackBasePayload)
                  .eq('id', businessBankAccount.id)
                  .select('*')
                  .single(),
                12000,
                'Bank account update timeout'
              ));
            }

            if (error && isBusinessBankTableUnavailableError(error)) {
              const { data: authData, error: authErr } = await supabase.auth.getUser();
              if (authErr || !authData.user) {
                throw new Error(`Failed to update bank metadata: ${authErr?.message || 'User not found'}`);
              }

              const existingMeta = (authData.user.user_metadata || {}) as Record<string, any>;
              const existingBankMeta = (existingMeta.business_bank_account || {}) as BusinessBankAccountMetadata;
              const metadataPayload: BusinessBankAccountMetadata = {
                ...existingBankMeta,
                is_primary: true,
                payout_provider: 'paystack',
                bank_name: bankAccount.bankName ?? businessBankAccount.bankName,
                bank_code: verification.bankCode || bankAccount.bankCode || businessBankAccount.bankCode || '',
                account_holder_name: resolvedAccountName,
                account_number: bankAccount.accountNumber ?? businessBankAccount.accountNumber,
                routing_number: bankAccount.routingNumber !== undefined ? bankAccount.routingNumber || '' : businessBankAccount.routingNumber || '',
                iban: bankAccount.iban !== undefined ? bankAccount.iban || '' : businessBankAccount.iban || '',
                swift_code: bankAccount.swiftCode !== undefined ? bankAccount.swiftCode || '' : businessBankAccount.swiftCode || '',
                country: bankAccount.country ?? businessBankAccount.country,
                country_code: (bankAccount.countryCode ?? businessBankAccount.countryCode) || 'NG',
                currency: bankAccount.currency ?? businessBankAccount.currency,
                is_verified: verification.verified,
                verification_status: verification.verificationStatus,
                verification_reason: verification.verificationReason || undefined,
                paystack_recipient_code: verification.paystackRecipientCode || businessBankAccount.paystackRecipientCode,
                paystack_recipient_id: verification.paystackRecipientId || businessBankAccount.paystackRecipientId,
                stripe_external_account_id: undefined,
                verified_at: verification.verified ? nowIso : undefined,
                updated_at: nowIso,
              };

              const { data: updatedUserData, error: updateMetaErr } = await supabase.auth.updateUser({
                data: {
                  ...existingMeta,
                  business_bank_account: metadataPayload,
                },
              });

              if (updateMetaErr) {
                throw new Error(`Failed to update bank metadata: ${updateMetaErr.message}`);
              }

              const mappedFromMetadata = mapBusinessBankAccountMetadata(
                user.id,
                ((updatedUserData.user?.user_metadata as any)?.business_bank_account || metadataPayload) as BusinessBankAccountMetadata
              );

              set({
                businessBankAccount: mappedFromMetadata,
                isLoading: false,
              });

              return true;
            }

            if (error) {
              throw new Error(`Failed to update Paystack bank account: ${error.message}`);
            }

            set({
              businessBankAccount: mapBusinessBankAccountRow(data as BusinessBankAccountRow),
              isLoading: false,
            });

            return true;
          }

          const persistBusinessBankMetadata = async () => {
            const { data: authData, error: authErr } = await supabase.auth.getUser();
            if (authErr || !authData.user) {
              throw new Error(`Failed to update bank metadata: ${authErr?.message || 'User not found'}`);
            }

            const existingMeta = (authData.user.user_metadata || {}) as Record<string, any>;
            const existingBankMeta = (existingMeta.business_bank_account || {}) as BusinessBankAccountMetadata;

            const metadataPayload: BusinessBankAccountMetadata = {
              ...existingBankMeta,
              is_primary: true,
              payout_provider: resolvedPayoutProvider,
              ...(bankAccount.bankName !== undefined ? { bank_name: bankAccount.bankName } : {}),
              ...(bankAccount.bankCode !== undefined ? { bank_code: bankAccount.bankCode || '' } : {}),
              ...(bankAccount.accountName !== undefined ? { account_holder_name: bankAccount.accountName } : {}),
              ...(bankAccount.accountNumber !== undefined ? { account_number: bankAccount.accountNumber } : {}),
              ...(bankAccount.routingNumber !== undefined ? { routing_number: bankAccount.routingNumber || '' } : {}),
              ...(bankAccount.iban !== undefined ? { iban: bankAccount.iban || '' } : {}),
              ...(bankAccount.swiftCode !== undefined ? { swift_code: bankAccount.swiftCode || '' } : {}),
              ...(bankAccount.country !== undefined ? { country: bankAccount.country } : {}),
              ...(bankAccount.countryCode !== undefined ? { country_code: bankAccount.countryCode || '' } : {}),
              ...(bankAccount.currency !== undefined ? { currency: bankAccount.currency } : {}),
              is_verified: true,
              verification_status: 'verified',
              verification_reason: undefined,
              paystack_recipient_code: undefined,
              paystack_recipient_id: undefined,
              stripe_external_account_id: undefined,
              verified_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            const { data: updatedUserData, error: updateMetaErr } = await supabase.auth.updateUser({
              data: {
                ...existingMeta,
                business_bank_account: metadataPayload,
              },
            });

            if (updateMetaErr) {
              throw new Error(`Failed to update bank metadata: ${updateMetaErr.message}`);
            }

            const mappedFromMetadata = mapBusinessBankAccountMetadata(
              user.id,
              ((updatedUserData.user?.user_metadata as any)?.business_bank_account || metadataPayload) as BusinessBankAccountMetadata
            );

            set({
              businessBankAccount: mappedFromMetadata,
              isLoading: false,
            });

            return true;
          };

          // Metadata-backed records use synthetic IDs (meta_<uid>) and must be updated via auth metadata,
          // not direct table row updates (which expect UUID ids).
          if (isMetadataBackedBusinessBankAccountId(businessBankAccount.id)) {
            return await persistBusinessBankMetadata();
          }

          const updatePayload: Record<string, any> = {};
          updatePayload.is_primary = true;
          updatePayload.payout_provider = resolvedPayoutProvider;

          if (bankAccount.bankName !== undefined) updatePayload.bank_name = bankAccount.bankName;
          if (bankAccount.bankCode !== undefined) updatePayload.bank_code = bankAccount.bankCode || null;
          if (bankAccount.accountName !== undefined) updatePayload.account_holder_name = bankAccount.accountName;
          if (bankAccount.accountNumber !== undefined) updatePayload.account_number = bankAccount.accountNumber;
          if (bankAccount.routingNumber !== undefined) updatePayload.routing_number = bankAccount.routingNumber || null;
          if (bankAccount.iban !== undefined) updatePayload.iban = bankAccount.iban || null;
          if (bankAccount.swiftCode !== undefined) updatePayload.swift_code = bankAccount.swiftCode || null;
          if (bankAccount.country !== undefined) updatePayload.country = bankAccount.country;
          if (bankAccount.countryCode !== undefined) updatePayload.country_code = bankAccount.countryCode || null;
          if (bankAccount.currency !== undefined) updatePayload.currency = bankAccount.currency;

          updatePayload.is_verified = true;
          updatePayload.verification_status = 'verified';
          updatePayload.verification_reason = null;
          updatePayload.stripe_external_account_id = null;
          updatePayload.paystack_recipient_code = null;
          updatePayload.paystack_recipient_id = null;
          updatePayload.verified_at = new Date().toISOString();

          let data: any = null;
          let error: any = null;

          ({ data, error } = await withTimeout(
            (supabase as any)
              .from('business_bank_accounts')
              .update(updatePayload)
              .eq('id', businessBankAccount.id)
              .select('*')
              .single(),
            12000,
            'Bank account update timeout'
          ));

          if (error && /column|iban|swift_code/i.test(error.message || '')) {
            const { iban: _iban, swift_code: _swiftCode, ...legacyPayload } = updatePayload;
            ({ data, error } = await withTimeout(
              (supabase as any)
                .from('business_bank_accounts')
                .update(legacyPayload)
                .eq('id', businessBankAccount.id)
                .select('*')
                .single(),
              12000,
              'Bank account update timeout'
            ));
          }

          if (error && isBusinessBankTableUnavailableError(error)) {
            return await persistBusinessBankMetadata();
          }

          if (error) {
            throw new Error(`Failed to update bank account: ${error.message}`);
          }

          const mappedFromTable = mapBusinessBankAccountRow(data as BusinessBankAccountRow);

          set({
            businessBankAccount: mappedFromTable,
            isLoading: false,
          });
          
          return true;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
    }),
    {
      name: 'wallet-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        wallet: state.wallet,
        paymentMethods: state.paymentMethods,
        businessBankAccount: state.businessBankAccount,
        selectedCurrency: state.selectedCurrency,
      }),
    }
  )
);