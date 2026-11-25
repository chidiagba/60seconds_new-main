import { logger } from '@/lib/logger';
import { calculateOwnerWalletBalance } from '../supabase/functions/_shared/owner-wallet-balance';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Wallet, Transaction, PaymentMethod, BusinessBankAccount, WithdrawalRequest, PLATFORM_ACCOUNT_ID, PLATFORM_WALLET_ID, TRANSACTION_FEE_PERCENTAGE, TWINT_MERCHANT_ID, TWINT_API_KEY, PAYSTACK_PUBLIC_KEY, PAYSTACK_MERCHANT_ID } from '@/types/wallet';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from './auth-store';
import { CurrencyCode, DEFAULT_CURRENCY, isSupportedCurrencyCode, normalizeCurrencyCode } from '@/constants/currencies';
import { resolveCurrencyFromCountry } from '@/utils/country-currency';
import { settleExternalOrderPayment } from '@/lib/external-payment-settlement';

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
  paystack_subaccount_code?: string | null;
  paystack_subaccount_id?: string | null;
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
  paystack_subaccount_code?: string;
  paystack_subaccount_id?: string;
  stripe_external_account_id?: string;
  verified_at?: string;
  created_at?: string;
  updated_at?: string;
};

type TransactionRow = {
  id: string;
  wallet_id?: string;
  walletId?: string;
  amount?: number;
  type?: Transaction['type'];
  status?: Transaction['status'];
  description?: string;
  transaction_fee?: number;
  transactionFee?: number;
  metadata?: Record<string, any>;
  created_at?: string;
  createdAt?: string;
};

type TicketReceiptSettlementRow = {
  order_id?: string | null;
  product_id?: string | null;
  video_id?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  net_price?: number | null;
  currency?: string | null;
  created_at?: string | null;
};

type BusinessOrderSettlementRow = {
  id: string;
  total_amount?: number | null;
  business_id?: string | null;
  currency?: string | null;
  video_id?: string | null;
  created_at?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  status?: string | null;
  items?: any[] | null;
};

type BusinessProductSettlementRow = {
  id: string;
  price?: number | null;
  currency?: string | null;
  event_id?: string | null;
};

const BUSINESS_PLATFORM_FEE_RATE = 0.04;
const BUSINESS_RECONCILIATION_COOLDOWN_MS = 60 * 1000;
const businessReconciliationLastRunAt = new Map<string, number>();

const roundMoney = (value: number): number => Number(Number(value || 0).toFixed(2));

const deriveBusinessNetAmount = (grossAmount: number): number => {
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) return 0;
  return roundMoney(grossAmount / (1 + BUSINESS_PLATFORM_FEE_RATE));
};

const getBusinessOwnerCreditAmount = (amount: number, metadata: Record<string, any>): number => {
  const entry = String(metadata.entry || metadata.ledgerEntry || '').trim();
  if (entry !== 'owner_credit') {
    return roundMoney(amount);
  }

  const explicitNetAmount = Number(metadata.net_amount ?? metadata.netAmount);
  if (Number.isFinite(explicitNetAmount) && explicitNetAmount > 0) {
    return roundMoney(explicitNetAmount);
  }

  const grossAmount = Number(metadata.gross_amount ?? metadata.grossAmount);
  const platformFeeAmount = Number(metadata.platform_fee_amount ?? metadata.platformFeeAmount);
  if (Number.isFinite(grossAmount) && Number.isFinite(platformFeeAmount) && grossAmount > platformFeeAmount) {
    return roundMoney(grossAmount - platformFeeAmount);
  }

  return roundMoney(amount);
};

const isOwnerCreditTransaction = (tx: Transaction): boolean => {
  const metadata = (tx.metadata || {}) as Record<string, any>;
  return String(metadata.entry || '').trim() === 'owner_credit';
};

const isPaidSettlementStatus = (row?: { payment_status?: string | null; status?: string | null }): boolean => {
  const paymentStatus = String(row?.payment_status || '').trim().toLowerCase();
  const status = String(row?.status || '').trim().toLowerCase();
  const paidStatuses = ['paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved'];
  return paidStatuses.includes(paymentStatus) || paidStatuses.includes(status);
};

const calculateBusinessClaimableBalance = (transactions: Transaction[]): number =>
  calculateOwnerWalletBalance(transactions, true);

const normalizeTransactionStatus = (status: any): Transaction['status'] => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'success' || normalized === 'successful' || normalized === 'paid') {
    return 'completed';
  }
  if (normalized === 'processing' || normalized === 'in_progress') {
    return 'pending';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'failed';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'cancelled';
  }
  return 'pending';
};

const isLegacyBusinessPaymentDebit = (row: TransactionRow): boolean => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const entry = String(metadata.entry || '').trim();
  const description = String(row.description || metadata.description || '').trim().toLowerCase();
  const amount = Number(row.amount || 0);

  return (
    amount < 0 &&
    entry !== 'owner_credit' &&
    (
      entry === 'buyer_debit' ||
      description.includes('paystack purchase') ||
      description.includes('purchase (backfill)')
    )
  );
};

const createOwnerCreditFromBuyerDebit = (row: TransactionRow, fallbackCurrency: CurrencyCode): Transaction | null => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const entry = String(metadata.entry || '').trim();
  if (entry !== 'buyer_debit' && !isLegacyBusinessPaymentDebit(row)) return null;

  const grossAmount = Math.abs(Number(metadata.gross_amount ?? metadata.grossAmount ?? row.amount ?? 0));
  if (!(grossAmount > 0)) return null;

  const explicitNetAmount = Number(metadata.net_amount ?? metadata.netAmount);
  const netAmount = Number.isFinite(explicitNetAmount) && explicitNetAmount > 0
    ? roundMoney(explicitNetAmount)
    : deriveBusinessNetAmount(grossAmount);
  const platformFeeAmount = roundMoney(Math.max(0, grossAmount - netAmount));
  const currency = normalizeCurrencyCode(metadata.currency, fallbackCurrency);

  return {
    id: `owner_credit_${row.id}`,
    walletId: row.wallet_id || row.walletId || '',
    amount: netAmount,
    type: 'deposit',
    status: 'completed',
    description: 'Sale settlement',
    transactionFee: 0,
    metadata: ({
      ...metadata,
      entry: 'owner_credit',
      source: entry === 'buyer_debit' ? 'legacy_buyer_debit_display' : 'legacy_paystack_backfill_display',
      originalTransactionId: row.id,
      gross_amount: grossAmount,
      platform_fee_amount: platformFeeAmount,
      net_amount: netAmount,
      currency,
    } as any),
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  };
};

const mapTransactionRow = (row: TransactionRow): Transaction => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const normalizedMetadata = {
    ...metadata,
    paymentProvider: metadata.paymentProvider || metadata.payment_provider,
    paystackReference: metadata.paystackReference || metadata.payment_reference,
    twintTransactionId: metadata.twintTransactionId || metadata.payment_transaction_id,
    businessId: metadata.businessId || metadata.owner_id,
    videoId: metadata.videoId || metadata.video_id,
    productId: metadata.productId || metadata.product_id,
    recipientId: metadata.recipientId || metadata.recipient_id,
    senderId: metadata.senderId || metadata.sender_id,
    paymentMethodId: metadata.paymentMethodId || metadata.payment_method_id,
    originalTransactionId: metadata.originalTransactionId || metadata.original_transaction_id,
    feeRecipientId: metadata.feeRecipientId || metadata.fee_recipient_id,
  };
  const amount = getBusinessOwnerCreditAmount(Number(row.amount || 0), normalizedMetadata);

  return {
    id: row.id,
    walletId: row.wallet_id || row.walletId || '',
    amount,
    type: (row.type as Transaction['type']) || 'payment',
    status: normalizeTransactionStatus(row.status),
    description: row.description || 'Transaction',
    transactionFee: row.transaction_fee ?? row.transactionFee,
    metadata: normalizedMetadata,
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  };
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
  verificationReason: row.is_verified ? undefined : (row.verification_reason || undefined),
  paystackRecipientCode: row.paystack_recipient_code || undefined,
  paystackRecipientId: row.paystack_recipient_id || undefined,
  paystackSubaccountCode: row.paystack_subaccount_code || undefined,
  paystackSubaccountId: row.paystack_subaccount_id || undefined,
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
    verificationReason: payload.is_verified ? undefined : (payload.verification_reason || undefined),
    paystackRecipientCode: payload.paystack_recipient_code || undefined,
    paystackRecipientId: payload.paystack_recipient_id || undefined,
    paystackSubaccountCode: payload.paystack_subaccount_code || undefined,
    paystackSubaccountId: payload.paystack_subaccount_id || undefined,
    stripeExternalAccountId: payload.stripe_external_account_id || undefined,
    verifiedAt: payload.verified_at || undefined,
    createdAt: payload.created_at || new Date().toISOString(),
    updatedAt: payload.updated_at,
  };
};

const normalizeBusinessBankAccountId = (value?: string | null): string => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^"+|"+$/g, '');
};

const isMetadataBackedBusinessBankAccountId = (id?: string | null): boolean => {
  const normalized = normalizeBusinessBankAccountId(id);
  return normalized.startsWith('meta_');
};

const isUuidLike = (value?: string | null): boolean => {
  const normalized = normalizeBusinessBankAccountId(value);
  if (!normalized) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
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

const isNigerianCurrencySignal = (value?: string | null): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized === 'ng' ||
    normalized === 'nga' ||
    normalized === 'ngn' ||
    normalized === 'nigeria' ||
    normalized === 'nigerian' ||
    normalized.includes('nigeria') ||
    normalized.includes('opay') ||
    normalized.includes('paystack')
  );
};

const resolveBusinessBankCurrency = (bankAccount?: BusinessBankAccount | null): CurrencyCode | null => {
  if (!bankAccount) return null;

  if (isSupportedCurrencyCode(bankAccount.currency || '')) {
    return normalizeCurrencyCode(bankAccount.currency, DEFAULT_CURRENCY);
  }

  const isNigerianBank =
    isNigerianCurrencySignal(bankAccount.country) ||
    isNigerianCurrencySignal(bankAccount.countryCode) ||
    isNigerianCurrencySignal(bankAccount.bankName) ||
    isNigerianCurrencySignal(bankAccount.payoutProvider);

  return isNigerianBank ? 'NGN' : null;
};

const shouldAutoSyncPaystackBankAccount = (bankAccount?: Partial<BusinessBankAccount> | null): boolean => {
  if (!bankAccount) return false;

  const hasRequiredBankDetails =
    Boolean(String(bankAccount.accountNumber || '').trim()) &&
    Boolean(String(bankAccount.bankName || '').trim()) &&
    Boolean(String(bankAccount.accountName || '').trim());

  if (!hasRequiredBankDetails) return false;

  const isNigerianBank =
    isNigerianCurrencySignal(bankAccount.country || '') ||
    isNigerianCurrencySignal(bankAccount.countryCode || '') ||
    isNigerianCurrencySignal(bankAccount.currency || '') ||
    isNigerianCurrencySignal(bankAccount.bankName || '') ||
    isNigerianCurrencySignal(bankAccount.payoutProvider || '');

  if (!isNigerianBank) return false;

  const payoutProvider = String(bankAccount.payoutProvider || '').trim().toLowerCase();
  const verificationStatus = String(bankAccount.verificationStatus || '').trim().toLowerCase();
  const hasRecipientCode = Boolean(String(bankAccount.paystackRecipientCode || '').trim());
  const hasSubaccountCode = Boolean(String(bankAccount.paystackSubaccountCode || '').trim());

  return payoutProvider !== 'paystack' || verificationStatus !== 'verified' || !hasRecipientCode || !hasSubaccountCode;
};

const withTimeout = async <T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise)
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

  if (input.country || input.countryCode) {
    return currencyFromCountry;
  }

  if (isSupportedCurrencyCode(input.profileCurrency || '')) {
    return currencyFromProfile;
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
  paystackSubaccountCode?: string | null;
  paystackSubaccountId?: string | null;
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
  paystackSubaccountCode?: string;
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
      paystackSubaccountCode: payload.paystackSubaccountCode || '',
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
      paystackSubaccountCode: payload.paystackSubaccountCode || null,
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
    paystackSubaccountCode: data?.paystackSubaccountCode || payload.paystackSubaccountCode || null,
    paystackSubaccountId: data?.paystackSubaccountId || null,
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
  isBackgroundSyncing: boolean;
  isReconcilingBusinessWallet: boolean;
  error: string | null;
  selectedCurrency: CurrencyCode;
  lastBusinessReconciledAt: string | null;
  lastBusinessReconcileStatus: 'idle' | 'success' | 'failed';
  
  // Actions
  fetchWallet: () => Promise<void>;
  fetchTransactions: (options?: { silent?: boolean }) => Promise<void>;
  reconcileBusinessWalletBalance: () => Promise<void>;
  manualReconcileBusinessWallet: () => Promise<boolean>;
  fetchPaymentMethods: () => Promise<void>;
  fetchBusinessBankAccount: () => Promise<void>;
  fetchWithdrawalRequests: () => Promise<void>;
  
  addFunds: (amount: number, paymentMethodId: string, paymentProvider?: 'internal' | 'twint' | 'paystack') => Promise<boolean>;
  makePayment: (amount: number, description: string, metadata: any) => Promise<boolean>;
  transferFunds: (amount: number, recipientId: string, description: string) => Promise<boolean>;
  requestWithdrawal: (amount: number) => Promise<{ success: boolean; payoutSubmitted: boolean; ledgerRecorded: boolean; providerQueued?: boolean }>;
  
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
      isBackgroundSyncing: false,
      isReconcilingBusinessWallet: false,
      error: null,
      selectedCurrency: DEFAULT_CURRENCY,
      lastBusinessReconciledAt: null,
      lastBusinessReconcileStatus: 'idle',
      
      fetchWallet: async () => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          const { data: authUserData } = await supabase.auth.getUser();
          const effectiveUserId = authUserData.user?.id || user?.id;

          if (!effectiveUserId) {
            logger.debug('⚠️ No user found - skipping wallet fetch');
            set({ wallet: null, isLoading: false });
            return;
          }
          
          logger.debug('🔍 Fetching wallet for user:', effectiveUserId);

          const { data: profileData } = await supabase
            .from('profiles')
            .select('currency,country,country_code')
            .eq('id', effectiveUserId)
            .maybeSingle();

          await get().fetchBusinessBankAccount();

          const existingBusinessBankAccount = get().businessBankAccount;
          const businessBankCurrency = resolveBusinessBankCurrency(existingBusinessBankAccount);
          const fallbackCountry =
            profileData?.country ||
            (user as any)?.country ||
            (user as any)?.countryCode ||
            existingBusinessBankAccount?.country;
          const fallbackCountryCode =
            profileData?.country_code ||
            (user as any)?.countryCode ||
            (user as any)?.country_code ||
            existingBusinessBankAccount?.countryCode;
          const fallbackProfileCurrency =
            businessBankCurrency ||
            profileData?.currency ||
            (user as any)?.currency ||
            existingBusinessBankAccount?.currency;

          const preferredCurrency = resolvePreferredCurrency({
            profileCurrency: fallbackProfileCurrency,
            country: fallbackCountry,
            countryCode: fallbackCountryCode,
          });
          
          // Fetch wallet from Supabase
          const { data: walletData, error: walletError } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', effectiveUserId)
            .single();
          
          if (walletError) {
            if (walletError.code === 'PGRST116') {
              // Wallet not found, create one (idempotent to avoid duplicate key races).
              logger.debug('📝 Creating new wallet for user:', effectiveUserId);
              const { data: newWallet, error: createError } = await supabase
                .from('wallets')
                .upsert({
                  user_id: effectiveUserId,
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
                    .eq('user_id', effectiveUserId)
                    .single();

                  if (existingWalletError || !existingWallet) {
                    throw new Error(`Failed to fetch existing wallet after duplicate conflict: ${existingWalletError?.message || 'wallet not found'}`);
                  }

                  const selectedCurrency = resolvePreferredCurrency({
                    walletCurrency: existingWallet.currency,
                    profileCurrency: fallbackProfileCurrency,
                    country: fallbackCountry,
                    countryCode: fallbackCountryCode,
                  });

                  if (existingWallet.currency !== selectedCurrency) {
                    await supabase
                      .from('wallets')
                      .update({ currency: selectedCurrency, updated_at: new Date().toISOString() })
                      .eq('id', existingWallet.id);
                    existingWallet.currency = selectedCurrency;
                  }

                  set({ wallet: existingWallet, selectedCurrency, isLoading: false });
                  logger.debug('✅ Wallet fetched after duplicate conflict:', existingWallet);
                  return;
                }

                throw new Error(`Failed to create wallet: ${createError.message}`);
              }

              const selectedCurrency = resolvePreferredCurrency({
                walletCurrency: newWallet.currency,
                profileCurrency: fallbackProfileCurrency,
                country: fallbackCountry,
                countryCode: fallbackCountryCode,
              });
              
              set({ wallet: newWallet, selectedCurrency, isLoading: false });
              logger.debug('✅ Wallet created successfully:', newWallet);
            } else {
              throw new Error(`Failed to fetch wallet: ${walletError.message}`);
            }
          } else {
            const selectedCurrency = resolvePreferredCurrency({
              walletCurrency: walletData?.currency,
              profileCurrency: fallbackProfileCurrency,
              country: fallbackCountry,
              countryCode: fallbackCountryCode,
            });

            if (walletData?.currency !== selectedCurrency) {
              const updatedAt = new Date().toISOString();
              await supabase
                .from('wallets')
                .update({ currency: selectedCurrency, updated_at: updatedAt })
                .eq('id', walletData.id);
              walletData.currency = selectedCurrency;
              walletData.updated_at = updatedAt;
            }

            set({ wallet: walletData, selectedCurrency, isLoading: false });
            logger.debug('✅ Wallet fetched successfully:', walletData);
          }
        } catch (error: any) {
          logger.warn('Wallet fetch unavailable:', error);
          set({ error: error?.message || 'Wallet is temporarily unavailable', isLoading: false });
        }
      },
      
      fetchTransactions: async (options = {}) => {
        const silent = options.silent === true;
        set(silent ? { isBackgroundSyncing: true, error: null } : { isLoading: true, error: null });
        try {
          let { wallet } = get();
          if (!wallet) {
            logger.debug('⚠️ No wallet loaded - fetching wallet before transactions');
            await get().fetchWallet();
            wallet = get().wallet;

            if (!wallet) {
              logger.debug('⚠️ No wallet found - skipping transactions fetch');
              set(silent ? { transactions: [], isBackgroundSyncing: false } : { transactions: [], isLoading: false });
              return;
            }
          }
          
          logger.debug('🔍 Fetching transactions for wallet:', wallet.id);

          const { user } = useAuthStore.getState();
          const isBusinessUser = !!user?.isBusinessAccount;
          const shouldAttemptBusinessReconciliation = isBusinessUser || !!get().businessBankAccount;

          // Auto-reconcile pending Paystack withdrawals before reading local ledger.
          if (isBusinessUser) {
            try {
              const { data: withdrawalReconcileData, error: withdrawalReconcileError } = await supabase.functions.invoke('paystack-reconcile-withdrawals', {
                body: { limit: 20 },
              });
              if (withdrawalReconcileError) {
                throw withdrawalReconcileError;
              }
              logger.debug('✅ Withdrawal reconciliation completed:', withdrawalReconcileData);
            } catch (reconcileError: any) {
              logger.warn('⚠️ Withdrawal reconciliation unavailable:', reconcileError?.message || reconcileError);
            }

            try {
              const { data: settlementData, error: settlementError } = await supabase.functions.invoke(
                'paystack-reconcile-subaccount-settlements',
                { body: { days: 90 } }
              );
              if (settlementError) throw settlementError;
              logger.debug('✅ Paystack bank settlement reconciliation completed:', settlementData);
            } catch (settlementError: any) {
              logger.warn('⚠️ Paystack settlement reconciliation unavailable:', settlementError?.message || settlementError);
            }
          }

          if (shouldAttemptBusinessReconciliation && user?.id) {
            const now = Date.now();
            const lastRunAt = businessReconciliationLastRunAt.get(user.id) || 0;

            if (now - lastRunAt >= BUSINESS_RECONCILIATION_COOLDOWN_MS) {
              set({ isReconcilingBusinessWallet: true });
              try {
                if (isBusinessUser) {
                  const { data: gatewayReconcileData, error: gatewayReconcileError } = await supabase.functions.invoke(
                    'paystack-reconcile-business-sales',
                    { body: { days: 45 } }
                  );
                  if (gatewayReconcileError) {
                    logger.warn('⚠️ Paystack sales reconciliation unavailable:', gatewayReconcileError.message);
                  } else {
                    logger.debug('✅ Paystack sales reconciliation completed:', gatewayReconcileData);
                  }
                }
                await get().reconcileBusinessWalletBalance();
                businessReconciliationLastRunAt.set(user.id, now);
                set({
                  lastBusinessReconciledAt: new Date(now).toISOString(),
                  lastBusinessReconcileStatus: 'success',
                });
              } catch (reconcileError: any) {
                logger.warn('⚠️ Business settlement reconciliation unavailable:', reconcileError?.message || reconcileError);
                set({
                  lastBusinessReconcileStatus: 'failed',
                });
              } finally {
                set({ isReconcilingBusinessWallet: false });
              }
            }
          }

          // Fetch transactions from Supabase after reconciliation so new withdrawal entries are included.
          const { data: transactionsData, error: transactionsError } = await supabase
            .from('transactions')
            .select('*')
            .eq('wallet_id', wallet.id)
            .order('created_at', { ascending: false });

          if (transactionsError) {
            throw new Error(`Failed to fetch transactions: ${transactionsError.message}`);
          }

          const mappedTransactions = (transactionsData || []).map((row: TransactionRow) => mapTransactionRow(row));
          const hasOwnerCreditTransactions = mappedTransactions.some(isOwnerCreditTransaction);
          const hasLinkedBusinessBankAccount = !!get().businessBankAccount;
          const hasLegacyBusinessBuyerDebit = (transactionsData || []).some((row: TransactionRow) => {
            const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
            const entry = String(metadata.entry || '').trim();
            const isLegacyBackfill = isLegacyBusinessPaymentDebit(row);
            if (entry !== 'buyer_debit' && !isLegacyBackfill) return false;

            const ownerId = metadata.owner_id || metadata.ownerId || metadata.business_id || metadata.businessId;
            return !!ownerId && String(ownerId) === user?.id;
          });
          const shouldUseBusinessClaimableBalance =
            isBusinessUser ||
            hasLinkedBusinessBankAccount ||
            hasOwnerCreditTransactions ||
            hasLegacyBusinessBuyerDebit;
          const existingOwnerCreditOrderIds = new Set(
            mappedTransactions
              .filter(isOwnerCreditTransaction)
              .map((tx) => (tx.metadata as any)?.order_id || (tx.metadata as any)?.orderId)
              .filter((value): value is string => !!value)
          );
          const derivedOwnerCredits = shouldUseBusinessClaimableBalance
            ? (transactionsData || [])
              .map((row: TransactionRow) => {
                const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
                const ownerId = metadata.owner_id || metadata.ownerId || metadata.business_id || metadata.businessId;
                if (ownerId && String(ownerId) !== user?.id) return null;
                if (!ownerId) return null;

                const orderId = metadata.order_id || metadata.orderId;
                if (orderId && existingOwnerCreditOrderIds.has(String(orderId))) return null;

                return createOwnerCreditFromBuyerDebit(row, get().selectedCurrency);
              })
              .filter((tx): tx is Transaction => !!tx)
            : [];
          const businessDisplayTransactions = [...mappedTransactions, ...derivedOwnerCredits]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          const transactionsForState = shouldUseBusinessClaimableBalance
            ? businessDisplayTransactions
            : mappedTransactions;
          const transactionCurrency = transactionsForState
            .map((tx) => (tx.metadata as any)?.currency)
            .find((currency) => isSupportedCurrencyCode(String(currency || '').toUpperCase()));
          const businessBankCurrency = resolveBusinessBankCurrency(get().businessBankAccount);
          const resolvedWalletCurrency=normalizeCurrencyCode(wallet.currency,get().selectedCurrency);
          // The database wallet includes active holds and is the authoritative available balance.
          set({
            transactions: transactionsForState,
            ...(silent ? { isBackgroundSyncing: false } : { isLoading: false }),
            selectedCurrency: resolvedWalletCurrency,
          });
          logger.debug('✅ Transactions fetched successfully:', transactionsData);
        } catch (error: any) {
          logger.warn('Transactions fetch unavailable:', error);
          set({
            error: error?.message || 'Transactions are temporarily unavailable',
            ...(silent ? { isBackgroundSyncing: false } : { isLoading: false }),
          });
        }
      },

      reconcileBusinessWalletBalance: async () => {
        await get().fetchWallet();
      },
      manualReconcileBusinessWallet: async () => {
        const { user } = useAuthStore.getState();
        if (!user?.id) {
          set({ error: 'User not authenticated' });
          return false;
        }

        set({
          isReconcilingBusinessWallet: true,
          lastBusinessReconcileStatus: 'idle',
          error: null,
        });

        try {
          await get().reconcileBusinessWalletBalance();

          const reconciledAt = new Date().toISOString();
          businessReconciliationLastRunAt.set(user.id, Date.now());
          set({
            lastBusinessReconciledAt: reconciledAt,
            lastBusinessReconcileStatus: 'success',
          });

          await get().fetchTransactions();
          return true;
        } catch (error: any) {
          set({
            lastBusinessReconcileStatus: 'failed',
            error: error?.message || 'Business wallet reconciliation failed',
          });
          return false;
        } finally {
          set({ isReconcilingBusinessWallet: false });
        }
      },
      
      fetchPaymentMethods: async () => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          if (!user) {
            logger.debug('⚠️ No user found - skipping payment methods fetch');
            set({ paymentMethods: [], isLoading: false });
            return;
          }
          
          logger.debug('🔍 Fetching payment methods for user:', user.id);
          const { data: paymentMethodsData, error: paymentMethodsError } = await withTimeout<any>(
            supabase
              .from('payment_methods')
              .select('*')
              .eq('user_id', user.id)
              .eq('is_active', true)
              .order('created_at', { ascending: false }),
            8000,
            'Payment methods fetch timeout'
          );
          
          if (paymentMethodsError) {
            if (paymentMethodsError.message === 'Payment methods fetch timeout') {
              logger.debug('⏰ Payment methods fetch timeout - using empty array');
            } else {
              logger.debug('⚠️ Payment methods fetch error:', paymentMethodsError.message);
            }
            set({ paymentMethods: [], isLoading: false });
            return;
          }
          
          set({ paymentMethods: paymentMethodsData || [], isLoading: false });
          logger.debug('✅ Payment methods fetched successfully:', paymentMethodsData);
        } catch (error: any) {
          if (error?.message === 'Payment methods fetch timeout') {
            logger.debug('⏰ Payment methods fetch timeout - using empty array');
          } else {
            logger.warn('⚠️ Payment methods fetch error:', error?.message || error);
          }
          // Don't fail completely, just show empty state
          set({ paymentMethods: [], isLoading: false, error: null });
        }
      },
      
      fetchBusinessBankAccount: async () => {
        set({isLoading:true,error:null});
        try {
          const {data:auth,error:authError}=await supabase.auth.getUser();
          if(authError||!auth.user) throw new Error('Authentication required');
          const {data,error}=await supabase.from('business_bank_accounts').select('*').eq('user_id',auth.user.id).eq('is_active',true).maybeSingle();
          if(error) throw error;
          set({businessBankAccount:data?mapBusinessBankAccountRow(data as BusinessBankAccountRow):null,isLoading:false});
        } catch(error:unknown) {
          set({businessBankAccount:null,error:error instanceof Error?error.message:'Bank account unavailable',isLoading:false});
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
          
          const {data,error}=await supabase.from('withdrawal_requests').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);
          if(error) throw error;
          const requests: WithdrawalRequest[]=(data||[]).map(row=>({id:row.id,userId:row.user_id,amount:Number(row.amount),status:row.status,businessBankAccountId:row.business_bank_account_id,createdAt:row.created_at}));
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
        const { wallet } = get();
        set({
          selectedCurrency: currency,
          wallet: wallet ? { ...wallet, currency, updatedAt: new Date().toISOString() } : wallet,
        });

        if (wallet) {
          supabase
            .from('wallets')
            .update({ currency, updated_at: new Date().toISOString() })
            .eq('id', wallet.id)
            .then(({ error }) => {
              if (error) {
                logger.warn('⚠️ Failed to update wallet currency:', error.message);
              }
            });
        }
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
          
          logger.debug('Paystack payment initialized:', paymentData);
          
          // Return success with reference
          set({ 
            isLoading: false,
            error: null
          });
          
          return true;
        } catch (error: any) {
          logger.error('Paystack payment error:', error);
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
            logger.debug('Paystack payment verified successfully:', verification.data);
            set({ isLoading: false });
            return true;
          } else {
            throw new Error(`Payment verification failed: ${verification.data.status}`);
          }
        } catch (error: any) {
          logger.error('Paystack verification error:', error);
          set({ error: error.message, isLoading: false });
          return false;
        }
      },
      
      makePayment: async (_amount: number, _description: string, _metadata: any) => {
        set({isLoading:false,error:'Legacy payment simulation is retired. Complete a server-verified checkout.'});
        return false;
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
        set({isLoading:true,error:null});
        try {
          const bank=get().businessBankAccount;
          if(!bank || !isUuidLike(bank.id)) throw new Error('Save and verify your bank account first');
          // Persist retries across lost responses; the server checks the amount and destination too.
          const storageKey=`withdrawal-attempt:${useAuthStore.getState().user?.id}:${bank.id}:${amount}`;
          let idempotencyKey=await AsyncStorage.getItem(storageKey);
          if(!idempotencyKey) {
            idempotencyKey='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3)|8).toString(16);});
            await AsyncStorage.setItem(storageKey,idempotencyKey);
          }
          const route=bank.payoutProvider==='paystack'?'paystack-direct-transfer':'stripe-withdraw-business-bank-account';
          const {data,error}=await supabase.functions.invoke(route,{body:{amount,businessBankAccountId:bank.id,idempotencyKey}});
          if(error || data?.success===false) throw new Error(data?.error||'Withdrawal could not be confirmed. Retry to check the same request.');
          await AsyncStorage.removeItem(storageKey);
          await Promise.all([get().fetchWallet(),get().fetchTransactions(),get().fetchWithdrawalRequests()]);
          set({isLoading:false});
          return {success:true,payoutSubmitted:true,ledgerRecorded:true,providerQueued:data.status==='pending'};
        } catch(error: unknown) {
          set({error:error instanceof Error?error.message:'Withdrawal failed',isLoading:false});
          return {success:false,payoutSubmitted:false,ledgerRecorded:false,providerQueued:false};
        }
      },
      addPaymentMethod: async (paymentMethod, userParam) => {
        logger.debug("=== WALLET STORE: addPaymentMethod ===");
        logger.debug("Input paymentMethod:", paymentMethod);
        logger.debug("Input userParam:", userParam);
        
        set({ isLoading: true, error: null });
        try {
          // Use passed user parameter or get from store
          const user = userParam || useAuthStore.getState().user;
          
          logger.debug("User:", user);
          
          if (!user) {
            throw new Error("User must be authenticated to add payment method");
          }
          
          // If this is set as default, update other payment methods first
          if (paymentMethod.isDefault) {
            logger.debug("🔄 Setting other payment methods as non-default");
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
          
          logger.debug("✅ Payment method added to Supabase:", newPaymentMethod);
          
          // Refresh payment methods from database
          await get().fetchPaymentMethods();
          
          logger.debug("✅ Payment method added successfully");
          return true;
        } catch (error: any) {
          logger.debug("❌ Error adding payment method:", error);
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
        set({isLoading:true,error:null});
        try {
          const {user}=useAuthStore.getState();
          if(!user?.isBusinessAccount) throw new Error('Business account required');
          const provider=bankAccount.payoutProvider||'stripe';
          const {data,error}=await supabase.functions.invoke(`${provider}-verify-business-bank-account`,{body:{...bankAccount,currency:bankAccount.currency||get().selectedCurrency}});
          if(error || data?.verificationStatus==='failed') throw new Error(data?.verificationReason||'Bank verification failed');
          const {data:row,error:readError}=await supabase.from('business_bank_accounts').select('*').eq('user_id',user.id).single();
          if(readError) throw readError;
          set({businessBankAccount:mapBusinessBankAccountRow(row as BusinessBankAccountRow),isLoading:false});
          return true;
        } catch(error: unknown) {
          set({error:error instanceof Error?error.message:'Bank verification failed',isLoading:false});
          return false;
        }
      },
      updateBusinessBankAccount: async (bankAccount) => {
        const current=get().businessBankAccount;
        if(!current) return false;
        return get().addBusinessBankAccount({...current,...bankAccount});
      },
    }),
    {
      name: 'wallet-storage',
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
      migrate: (persistedState: any, version: number) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState;
        }

        const nextState = { ...persistedState };

        if (version < 3) {
          delete nextState.wallet;
        }

        return {
          ...nextState,
          selectedCurrency: normalizeCurrencyCode(
            nextState?.selectedCurrency || persistedState?.wallet?.currency,
            DEFAULT_CURRENCY
          ),
        };
      },
      partialize: (state) => ({
        paymentMethods: state.paymentMethods,
        businessBankAccount: state.businessBankAccount,
      }),
    }
  )
);
