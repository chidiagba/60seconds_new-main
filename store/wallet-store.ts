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

const isWithdrawalTransaction = (tx: Transaction): boolean => {
  return tx.type === 'withdrawal' || String((tx.metadata as any)?.entry || '').trim() === 'owner_withdrawal';
};

const isPaidSettlementStatus = (row?: { payment_status?: string | null; status?: string | null }): boolean => {
  const paymentStatus = String(row?.payment_status || '').trim().toLowerCase();
  const status = String(row?.status || '').trim().toLowerCase();
  return ['paid', 'completed', 'success', 'successful'].includes(paymentStatus) || ['paid', 'completed', 'success', 'successful'].includes(status);
};

const calculateBusinessClaimableBalance = (transactions: Transaction[]): number => {
  const isCompletedLike = (status?: string) => {
    const normalized = String(status || '').trim().toLowerCase();
    return normalized === 'completed' || normalized === 'success' || normalized === 'successful' || normalized === 'paid';
  };

  return roundMoney(
    transactions
      .filter((tx) => isCompletedLike(tx.status))
      .reduce((sum, tx) => {
        const amount = Number(tx.amount || 0);
        const metadata = (tx.metadata || {}) as Record<string, any>;
        const entry = String(metadata.entry || '').trim();
        const provider = String(metadata.paymentProvider || metadata.payment_provider || '').trim().toLowerCase();
        const description = String(tx.description || '').trim().toLowerCase();

        if (isOwnerCreditTransaction(tx)) {
          return sum + Math.max(0, amount);
        }

        if (isWithdrawalTransaction(tx)) {
          return sum - Math.abs(amount);
        }

        if (
          amount < 0 &&
          (
            entry === 'buyer_debit' ||
            description.includes('paystack purchase') ||
            description.includes('purchase (backfill)') ||
            provider === 'paystack'
          )
        ) {
          return sum;
        }

        // Legacy business transactions may miss owner_credit metadata.
        // Include completed non-fee rows so available balance matches transaction history.
        if (tx.type !== 'fee') {
          return sum + amount;
        }

        return sum;
      }, 0)
  );
};

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
  verificationReason: row.verification_reason || undefined,
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
    verificationReason: payload.verification_reason || undefined,
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
  error: string | null;
  selectedCurrency: CurrencyCode;
  
  // Actions
  fetchWallet: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  reconcileBusinessWalletBalance: () => Promise<void>;
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
      error: null,
      selectedCurrency: DEFAULT_CURRENCY,
      
      fetchWallet: async () => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          const { data: authUserData } = await supabase.auth.getUser();
          const effectiveUserId = authUserData.user?.id || user?.id;

          if (!effectiveUserId) {
            console.log('⚠️ No user found - skipping wallet fetch');
            set({ wallet: null, isLoading: false });
            return;
          }
          
          console.log('🔍 Fetching wallet for user:', effectiveUserId);

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
              console.log('📝 Creating new wallet for user:', effectiveUserId);
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
                  console.log('✅ Wallet fetched after duplicate conflict:', existingWallet);
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
              console.log('✅ Wallet created successfully:', newWallet);
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
            console.log('✅ Wallet fetched successfully:', walletData);
          }
        } catch (error: any) {
          console.warn('Wallet fetch unavailable:', error);
          set({ error: error?.message || 'Wallet is temporarily unavailable', isLoading: false });
        }
      },
      
      fetchTransactions: async () => {
        set({ isLoading: true, error: null });
        try {
          let { wallet } = get();
          if (!wallet) {
            console.log('⚠️ No wallet loaded - fetching wallet before transactions');
            await get().fetchWallet();
            wallet = get().wallet;

            if (!wallet) {
              console.log('⚠️ No wallet found - skipping transactions fetch');
              set({ transactions: [], isLoading: false });
              return;
            }
          }
          
          console.log('🔍 Fetching transactions for wallet:', wallet.id);

          const { user } = useAuthStore.getState();
          const isBusinessUser = !!user?.isBusinessAccount;

          // Auto-reconcile pending Paystack withdrawals before reading local ledger.
          if (isBusinessUser) {
            try {
              await supabase.functions.invoke('paystack-reconcile-withdrawals', {
                body: { limit: 20 },
              });
            } catch (reconcileError: any) {
              console.warn('⚠️ Withdrawal reconciliation unavailable:', reconcileError?.message || reconcileError);
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
          const resolvedBusinessBalance = shouldUseBusinessClaimableBalance
            ? calculateBusinessClaimableBalance(transactionsForState)
            : roundMoney(Number(wallet.balance || 0));
          const resolvedWalletCurrency = shouldUseBusinessClaimableBalance
            ? normalizeCurrencyCode(
              transactionCurrency,
              normalizeCurrencyCode(
                businessBankCurrency,
                normalizeCurrencyCode(wallet.currency, get().selectedCurrency)
              )
            )
            : normalizeCurrencyCode(wallet.currency, get().selectedCurrency);
          const shouldSyncWalletBalance = Math.abs(Number(wallet.balance || 0) - resolvedBusinessBalance) >= 0.01;
          const shouldSyncWalletCurrency = wallet.currency !== resolvedWalletCurrency;

          if (shouldUseBusinessClaimableBalance) {
            const staleOwnerCreditRows = (transactionsData || [])
              .map((row: TransactionRow) => ({
                row,
                mapped: mapTransactionRow(row),
              }))
              .filter(({ row, mapped }) => {
                const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
                const entry = String(metadata.entry || '').trim();
                return entry === 'owner_credit' && Math.abs(Number(row.amount || 0) - Number(mapped.amount || 0)) >= 0.01;
              });

            if (staleOwnerCreditRows.length) {
              await Promise.all(
                staleOwnerCreditRows.map(({ row, mapped }) =>
                  supabase
                    .from('transactions')
                    .update({
                      amount: mapped.amount,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', row.id)
                )
              );
            }
          }

          if (shouldSyncWalletBalance || shouldSyncWalletCurrency) {
            const updatedAt = new Date().toISOString();

            const walletUpdatePayload: Record<string, any> = {
              updated_at: updatedAt,
            };
            if (shouldSyncWalletBalance) {
              walletUpdatePayload.balance = resolvedBusinessBalance;
            }
            if (shouldSyncWalletCurrency) {
              walletUpdatePayload.currency = resolvedWalletCurrency;
            }

            const { error: walletUpdateError } = await supabase
              .from('wallets')
              .update(walletUpdatePayload)
              .eq('id', wallet.id);

            if (walletUpdateError) {
              console.warn('⚠️ Failed to sync wallet snapshot from transactions:', walletUpdateError.message);
            }

            const nextWallet: any = {
              ...wallet,
              balance: resolvedBusinessBalance,
              updatedAt,
              updated_at: updatedAt,
            };

            if (shouldSyncWalletCurrency) {
              nextWallet.currency = resolvedWalletCurrency;
            }

            set({
              wallet: nextWallet,
              selectedCurrency: resolvedWalletCurrency,
            });
          }
          set({
            transactions: transactionsForState,
            isLoading: false,
            selectedCurrency: resolvedWalletCurrency,
          });
          console.log('✅ Transactions fetched successfully:', transactionsData);
        } catch (error: any) {
          console.warn('Transactions fetch unavailable:', error);
          set({ error: error?.message || 'Transactions are temporarily unavailable', isLoading: false });
        }
      },

      reconcileBusinessWalletBalance: async () => {
        const { user } = useAuthStore.getState();
        if (!user?.id) return;

        let { wallet } = get();
        if (!wallet) {
          await get().fetchWallet();
          wallet = get().wallet;
        }

        if (!wallet) return;

        try {
          const { data: receiptRows, error: receiptError } = await supabase
            .from('ticket_receipts')
            .select('order_id,product_id,video_id,quantity,unit_price,total_price,currency,created_at')
            .eq('owner_id', user.id);

          if (receiptError) {
            console.warn('⚠️ Ticket receipt reconciliation unavailable; trying paid orders and wallet metadata:', receiptError.message);
          }

          const receipts = (receiptRows || []) as TicketReceiptSettlementRow[];
          const receiptOrderIds = new Set(
            receipts.map((receipt) => receipt.order_id).filter((value): value is string => !!value)
          );

          const { data: productRows, error: productError } = await supabase
            .from('products')
            .select('id,price,currency,event_id')
            .eq('business_id', user.id);

          if (productError) {
            console.warn('⚠️ Business product lookup skipped for wallet reconciliation:', productError.message);
          }

          const businessProducts = ((productRows || []) as BusinessProductSettlementRow[])
            .filter((product) => !!product.id);
          const productById = new Map(businessProducts.map((product) => [String(product.id), product]));
          const productIds = new Set(productById.keys());

          const { data: orderRows, error: orderError } = await supabase
            .from('orders')
            .select('id,total_amount,currency,video_id,created_at,payment_method,payment_status,status,items')
            .eq('business_id', user.id)
            .order('created_at', { ascending: false })
            .limit(500);

          if (orderError) {
            console.warn('⚠️ Business order reconciliation skipped:', orderError.message);
          }

          const orderBackedReceipts: TicketReceiptSettlementRow[] = ((orderRows || []) as BusinessOrderSettlementRow[])
            .filter((order) => !receiptOrderIds.has(order.id))
            .filter(isPaidSettlementStatus)
            .filter((order) => Number(order.total_amount || 0) > 0)
            .map((order) => ({
              order_id: order.id,
              video_id: order.video_id || null,
              quantity: 1,
              unit_price: Number(order.total_amount || 0),
              total_price: Number(order.total_amount || 0),
              currency: order.currency || null,
              created_at: order.created_at || null,
            }));

          const knownProductSettlementOrderIds = new Set(
            [...receiptOrderIds, ...orderBackedReceipts.map((receipt) => receipt.order_id)]
              .filter((value): value is string => !!value)
          );

          const productOrderBackedReceipts: TicketReceiptSettlementRow[] = [];
          if (productIds.size) {
            const { data: paidOrderRows, error: paidOrderError } = await supabase
              .from('orders')
              .select('id,total_amount,currency,video_id,created_at,payment_method,payment_status,status,items,business_id')
              .order('created_at', { ascending: false })
              .limit(500);

            if (paidOrderError) {
              console.warn('⚠️ Product order reconciliation skipped:', paidOrderError.message);
            } else {
              for (const order of (paidOrderRows || []) as BusinessOrderSettlementRow[]) {
                if (!order?.id || knownProductSettlementOrderIds.has(order.id)) continue;

                if (!isPaidSettlementStatus(order)) continue;

                const items = Array.isArray(order.items) ? order.items : [];
                for (const item of items) {
                  const productId = String(item?.product_id || item?.productId || item?.id || '');
                  const product = productById.get(productId);
                  if (!product) continue;

                  const quantity = Math.max(1, Number(item?.quantity || 1));
                  const unitGrossAmount = Number(item?.unit_price ?? item?.unitPrice ?? item?.price ?? 0);
                  const explicitLineTotal = Number(item?.total_price ?? item?.totalPrice ?? item?.total ?? 0);
                  const grossAmount = roundMoney(
                    explicitLineTotal > 0
                      ? explicitLineTotal
                      : unitGrossAmount > 0
                        ? unitGrossAmount * quantity
                        : Number(order.total_amount || 0)
                  );
                  const netAmount = roundMoney(Number(product.price || 0) * quantity);

                  if (!(grossAmount > 0) && !(netAmount > 0)) continue;

                  productOrderBackedReceipts.push({
                    order_id: order.id,
                    product_id: productId,
                    video_id: order.video_id || product.event_id || null,
                    quantity,
                    unit_price: grossAmount > 0 ? roundMoney(grossAmount / quantity) : Number(product.price || 0),
                    total_price: grossAmount > 0 ? grossAmount : roundMoney(netAmount * (1 + BUSINESS_PLATFORM_FEE_RATE)),
                    net_price: netAmount > 0 ? netAmount : null,
                    currency: order.currency || product.currency || null,
                    created_at: order.created_at || null,
                  });
                }
              }
            }
          }

          const knownSettlementOrderIds = new Set(
            [...receipts, ...orderBackedReceipts, ...productOrderBackedReceipts]
              .map((receipt) => receipt.order_id)
              .filter((value): value is string => !!value)
          );

          const { data: buyerDebitRows, error: buyerDebitError } = await supabase
            .from('transactions')
            .select('id,amount,type,status,description,metadata,created_at')
            .eq('wallet_id', wallet.id)
            .order('created_at', { ascending: false })
            .limit(500);

          if (buyerDebitError) {
            console.warn('⚠️ Business buyer-debit reconciliation skipped:', buyerDebitError.message);
          }

          const buyerDebitBackedReceipts: TicketReceiptSettlementRow[] = ((buyerDebitRows || []) as any[])
            .map((row) => {
              const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
              if (!isLegacyBusinessPaymentDebit(row as TransactionRow)) return null;

              const ownerId = metadata.owner_id || metadata.ownerId || metadata.business_id || metadata.businessId;
              if (ownerId && String(ownerId) !== user.id) return null;

              const orderId = metadata.order_id || metadata.orderId || null;
              if (orderId && knownSettlementOrderIds.has(String(orderId))) return null;

              const grossAmount = Math.abs(Number(metadata.gross_amount ?? metadata.grossAmount ?? row.amount ?? 0));
              if (!(grossAmount > 0)) return null;

              return {
                order_id: orderId ? String(orderId) : `buyer-debit:${row.id}`,
                product_id: metadata.product_id || metadata.productId || null,
                video_id: metadata.video_id || metadata.videoId || null,
                quantity: 1,
                unit_price: grossAmount,
                total_price: grossAmount,
                currency: metadata.currency || null,
                created_at: row.created_at || null,
              } as TicketReceiptSettlementRow;
            })
            .filter((receipt): receipt is TicketReceiptSettlementRow => !!receipt);

          const settlementRows = [...receipts, ...orderBackedReceipts, ...productOrderBackedReceipts, ...buyerDebitBackedReceipts];
          if (!settlementRows.length) return;

          const orderIds = Array.from(
            new Set(settlementRows.map((receipt) => receipt.order_id).filter((value): value is string => !!value))
          );

          const existingSettledOrderIds = new Set<string>();
          if (orderIds.length) {
            const { data: existingRows, error: existingError } = await supabase
              .from('transactions')
              .select('metadata')
              .eq('wallet_id', wallet.id)
              .eq('metadata->>entry', 'owner_credit')
              .in('metadata->>order_id', orderIds);

            if (existingError) {
              console.warn('⚠️ Failed to check existing business settlements:', existingError.message);
            } else {
              for (const row of existingRows || []) {
                const orderId = (row as any)?.metadata?.order_id || (row as any)?.metadata?.orderId;
                if (orderId) existingSettledOrderIds.add(String(orderId));
              }
            }
          }

          const groupedReceipts = new Map<string, TicketReceiptSettlementRow[]>();
          for (const receipt of settlementRows) {
            const key = receipt.order_id || `receipt:${receipt.product_id || 'unknown'}:${receipt.created_at || ''}`;
            if (!groupedReceipts.has(key)) groupedReceipts.set(key, []);
            groupedReceipts.get(key)!.push(receipt);
          }

          const transactionsToInsert: any[] = [];
          const nowIso = new Date().toISOString();

          for (const [groupKey, group] of groupedReceipts.entries()) {
            const orderId = group[0]?.order_id || groupKey;
            if (group[0]?.order_id && existingSettledOrderIds.has(group[0].order_id)) {
              continue;
            }

            const grossAmount = roundMoney(
              group.reduce((sum, receipt) => sum + Number(receipt.total_price || 0), 0)
            );
            if (!(grossAmount > 0)) continue;

            const explicitNetAmount = roundMoney(
              group.reduce((sum, receipt) => sum + Number(receipt.net_price || 0), 0)
            );
            const netAmount = explicitNetAmount > 0 ? explicitNetAmount : deriveBusinessNetAmount(grossAmount);
            const platformFeeAmount = roundMoney(Math.max(0, grossAmount - netAmount));
            const currency = normalizeCurrencyCode(group.find((receipt) => receipt.currency)?.currency, get().selectedCurrency);
            const firstCreatedAt = group.find((receipt) => receipt.created_at)?.created_at || nowIso;

            transactionsToInsert.push({
              wallet_id: wallet.id,
              amount: netAmount,
              type: 'deposit',
              status: 'completed',
              description: 'Sale settlement',
              transaction_fee: 0,
              metadata: {
                entry: 'owner_credit',
                source: 'business_wallet_reconciliation',
                owner_id: user.id,
                order_id: orderId,
                video_id: group.find((receipt) => receipt.video_id)?.video_id || null,
                gross_amount: grossAmount,
                platform_fee_amount: platformFeeAmount,
                net_amount: netAmount,
                currency,
                items: group.map((receipt) => ({
                  productId: receipt.product_id,
                  quantity: receipt.quantity || 1,
                  unitPrice: receipt.unit_price,
                  totalPrice: receipt.total_price,
                  netPrice: receipt.net_price,
                })),
                reconciled_at: nowIso,
              },
              created_at: firstCreatedAt,
              updated_at: nowIso,
            });
          }

          if (!transactionsToInsert.length) return;

          const { error: insertError } = await supabase
            .from('transactions')
            .insert(transactionsToInsert);

          if (insertError) {
            console.warn('⚠️ Failed to create missing business wallet settlements:', insertError.message);
            return;
          }

          const { data: refreshedTransactionRows, error: refreshedTransactionsError } = await supabase
            .from('transactions')
            .select('*')
            .eq('wallet_id', wallet.id);

          if (refreshedTransactionsError) {
            console.warn('⚠️ Failed to refresh business wallet ledger after reconciliation:', refreshedTransactionsError.message);
          }

          const refreshedTransactions = (refreshedTransactionRows || transactionsToInsert).map((row: TransactionRow) =>
            mapTransactionRow(row)
          );
          const updatedBalance = calculateBusinessClaimableBalance(refreshedTransactions);
          const reconciledCurrency = normalizeCurrencyCode(
            transactionsToInsert.find((transaction) => transaction?.metadata?.currency)?.metadata?.currency,
            get().selectedCurrency
          );
          const updatedAt = new Date().toISOString();

          const { error: walletUpdateError } = await supabase
            .from('wallets')
            .update({ balance: updatedBalance, currency: reconciledCurrency, updated_at: updatedAt })
            .eq('id', wallet.id);

          if (walletUpdateError) {
            console.warn('⚠️ Failed to update reconciled business wallet balance:', walletUpdateError.message);
          }

          set({
            wallet: {
              ...wallet,
              balance: updatedBalance,
              currency: reconciledCurrency,
              updatedAt,
            },
            selectedCurrency: reconciledCurrency,
          });
        } catch (error: any) {
          console.warn('⚠️ Business wallet reconciliation failed:', error?.message || error);
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
          if (error?.message === 'Payment methods fetch timeout') {
            console.log('⏰ Payment methods fetch timeout - using empty array');
          } else {
            console.warn('⚠️ Payment methods fetch error:', error?.message || error);
          }
          // Don't fail completely, just show empty state
          set({ paymentMethods: [], isLoading: false, error: null });
        }
      },
      
      fetchBusinessBankAccount: async () => {
        set({ isLoading: true, error: null });
        try {
          const { user } = useAuthStore.getState();
          const { data: authUserData } = await supabase.auth.getUser();
          const effectiveUserId = authUserData.user?.id || user?.id;

          if (!effectiveUserId) {
            throw new Error('User not authenticated');
          }
          
          const { data, error } = await withTimeout<{ data: any; error: any }>(
            (supabase as any)
              .from('business_bank_accounts')
              .select('*')
              .eq('user_id', effectiveUserId)
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
            let mappedFromMetadata = mapBusinessBankAccountMetadata(effectiveUserId, metadataPayload || {});

            if (shouldAutoSyncPaystackBankAccount(mappedFromMetadata)) {
              const verification = await verifyBusinessBankAccountWithPaystack({
                accountName: mappedFromMetadata.accountName,
                accountNumber: mappedFromMetadata.accountNumber,
                bankName: mappedFromMetadata.bankName,
                bankCode: mappedFromMetadata.bankCode,
                currency: mappedFromMetadata.currency,
                countryCode: mappedFromMetadata.countryCode,
                refreshOnly: true,
                paystackRecipientCode: mappedFromMetadata.paystackRecipientCode,
                paystackSubaccountCode: mappedFromMetadata.paystackSubaccountCode,
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
                paystack_subaccount_code: verification.paystackSubaccountCode || mappedFromMetadata.paystackSubaccountCode,
                paystack_subaccount_id: verification.paystackSubaccountId || mappedFromMetadata.paystackSubaccountId,
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
                effectiveUserId,
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

          if (shouldAutoSyncPaystackBankAccount(mappedFromTable)) {
            const verification = await verifyBusinessBankAccountWithPaystack({
              accountName: mappedFromTable.accountName,
              accountNumber: mappedFromTable.accountNumber,
              bankName: mappedFromTable.bankName,
              bankCode: mappedFromTable.bankCode,
              currency: mappedFromTable.currency,
              countryCode: mappedFromTable.countryCode,
              refreshOnly: true,
              paystackRecipientCode: mappedFromTable.paystackRecipientCode,
              paystackSubaccountCode: mappedFromTable.paystackSubaccountCode,
            });

            const verificationUpdatePayload = {
              is_verified: verification.verified,
              verification_status: verification.verificationStatus,
              verification_reason: verification.verificationReason || null,
              payout_provider: 'paystack',
              bank_code: verification.bankCode || mappedFromTable.bankCode || null,
              paystack_recipient_code: verification.paystackRecipientCode || mappedFromTable.paystackRecipientCode || null,
              paystack_recipient_id: verification.paystackRecipientId || mappedFromTable.paystackRecipientId || null,
              paystack_subaccount_code: verification.paystackSubaccountCode || mappedFromTable.paystackSubaccountCode || null,
              paystack_subaccount_id: verification.paystackSubaccountId || mappedFromTable.paystackSubaccountId || null,
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
              paystackSubaccountCode: verification.paystackSubaccountCode || mappedFromTable.paystackSubaccountCode,
              paystackSubaccountId: verification.paystackSubaccountId || mappedFromTable.paystackSubaccountId,
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
                console.warn('⚠️ Failed to update wallet currency:', error.message);
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
            if (metadata.externalPaymentVerified === true) {
              if (metadata.orderId) {
                const provider = isTwintPayment ? 'twint' : 'paystack';
                const paymentReference = metadata.twintPaymentId || metadata.twintTransactionId || metadata.paystackReference || null;
                const paymentTransactionId = metadata.twintTransactionId || metadata.paystackReference || null;

                const settlement = await settleExternalOrderPayment({
                  orderId: metadata.orderId,
                  provider,
                  paymentReference,
                  paymentTransactionId,
                  recipientId: metadata.recipientId || metadata.businessId || null,
                  grossAmount: Number(metadata.grossAmount ?? amount),
                  netAmount: Number(metadata.netAmount ?? NaN),
                  currency: metadata.currency || DEFAULT_CURRENCY,
                  videoId: metadata.videoId || null,
                  items: Array.isArray(metadata.items)
                    ? metadata.items
                    : Array.isArray(metadata.cartItems)
                      ? metadata.cartItems.map((item: any) => ({
                          productId: item.productId || item.product_id || item.id,
                          quantity: Number(item.quantity || 1),
                          unitPrice: Number(item.unitPrice || item.unit_price || item.price || 0),
                          currency: metadata.currency || DEFAULT_CURRENCY,
                          ownerId: metadata.recipientId || metadata.businessId || null,
                        }))
                      : [],
                  metadata,
                });

                if (!settlement.success) {
                  throw new Error(settlement.error || 'Failed to settle verified external order');
                }
              }

              set({ isLoading: false });
              return true;
            }

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
          const { data: authUserData } = await supabase.auth.getUser();
          const effectiveUserId = authUserData.user?.id || user?.id;
          const isBusinessUser =
            Boolean(user?.isBusinessAccount) ||
            Boolean((authUserData.user?.user_metadata as any)?.isBusinessAccount) ||
            Boolean((authUserData.user?.user_metadata as any)?.is_business_account);
          
          if (!wallet) {
            throw new Error('Wallet not initialized');
          }
          
          if (!effectiveUserId) {
            throw new Error('User not authenticated');
          }

          if (!isBusinessUser) {
            throw new Error('Only business accounts can withdraw funds');
          }
          
          if (!businessBankAccount) {
            throw new Error('No bank account linked to your profile');
          }

          if (!businessBankAccount.isVerified) {
            const reason = businessBankAccount.verificationReason || 'Your bank account is still pending Stripe verification.';
            throw new Error(`Bank account not verified. ${reason}`);
          }

          const normalizedCountryCode = String(businessBankAccount.countryCode || '').trim().toUpperCase();
          const usesPaystackPayout = normalizedCountryCode === 'NG' || businessBankAccount.payoutProvider === 'paystack';
          const payoutFunctionName = usesPaystackPayout ? 'paystack-direct-transfer' : 'stripe-withdraw-business-bank-account';

          if (usesPaystackPayout) {
            const hasRecipientCode = Boolean(String(businessBankAccount.paystackRecipientCode || '').trim());
            const hasSubaccountCode = Boolean(String(businessBankAccount.paystackSubaccountCode || '').trim());

            if (!hasRecipientCode || !hasSubaccountCode) {
              throw new Error(
                'Paystack payout routing is incomplete. Please update and verify your bank details to generate recipient and subaccount routing before withdrawing.'
              );
            }
          }

          // Metadata-backed records use synthetic ids like meta_<uid> and cannot be inserted into UUID columns.
          let resolvedBusinessBankAccountId: string | null = isUuidLike(businessBankAccount.id)
            ? businessBankAccount.id
            : null;

          if (!resolvedBusinessBankAccountId) {
            const { data: bankRow, error: bankRowError } = await (supabase as any)
              .from('business_bank_accounts')
              .select('id')
              .eq('user_id', effectiveUserId)
              .eq('is_active', true)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (bankRowError && !isBusinessBankTableUnavailableError(bankRowError)) {
              throw new Error(`Failed to resolve bank account for withdrawal: ${bankRowError.message}`);
            }

            if (isUuidLike(bankRow?.id)) {
              resolvedBusinessBankAccountId = bankRow.id;
            }
          }

          let withdrawalRequest: WithdrawalRequest | null = null;
          const { data, error } = await (supabase as any)
            .from('withdrawal_requests')
            .insert({
              user_id: effectiveUserId,
              amount,
              status: 'pending',
              business_bank_account_id: resolvedBusinessBankAccountId,
              processing_fee: 0,
            })
            .select('*')
            .single();

          if (error || !data) {
            const missingTable = String(error?.message || '').toLowerCase().includes('withdrawal_requests');

            if (!missingTable) {
              throw new Error(`Failed to create withdrawal request: ${error?.message || 'unknown error'}`);
            }
          } else {
            withdrawalRequest = {
              id: data.id,
              userId: data.user_id,
              amount: Number(data.amount || amount),
              status: data.status,
              businessBankAccountId: data.business_bank_account_id || resolvedBusinessBankAccountId || businessBankAccount.id,
              createdAt: data.created_at,
            };
          }

          const payoutPayload: Record<string, any> = {
            amount,
            withdrawalRequestId: withdrawalRequest?.id,
            businessBankAccountId: resolvedBusinessBankAccountId || undefined,
            payoutProvider: businessBankAccount.payoutProvider || 'paystack',
            bankName: businessBankAccount.bankName,
            accountName: businessBankAccount.accountName,
            accountNumber: businessBankAccount.accountNumber,
            bankCode: businessBankAccount.bankCode || '',
            paystackRecipientCode: businessBankAccount.paystackRecipientCode || '',
            stripeExternalAccountId: businessBankAccount.stripeExternalAccountId || '',
            countryCode: businessBankAccount.countryCode || '',
            currency: usesPaystackPayout && normalizedCountryCode === 'NG'
              ? 'NGN'
              : (businessBankAccount.currency || get().selectedCurrency || DEFAULT_CURRENCY),
          };

          const { data: payoutData, error: payoutError } = await supabase.functions.invoke(payoutFunctionName, {
            body: payoutPayload,
          });

          if (payoutError || payoutData?.success === false) {
            if (withdrawalRequest?.id) {
              await (supabase as any)
                .from('withdrawal_requests')
                .update({ status: 'failed' })
                .eq('id', withdrawalRequest.id);
            }

            const providerName = usesPaystackPayout ? 'Paystack' : 'Stripe';
            const rawPayoutError = String(
              payoutError?.message ||
              payoutData?.error ||
              `Failed to initiate ${providerName} withdrawal`
            );

            if (usesPaystackPayout && /not enough to fulfil this request/i.test(rawPayoutError)) {
              throw new Error(
                'Paystack transfer balance is currently low. Your app wallet balance is available, but the payout provider cannot process transfer right now. Please top up Paystack transfer balance and retry.'
              );
            }

            throw new Error(
              rawPayoutError
            );
          }

          if (payoutData?.status && withdrawalRequest?.id) {
            await (supabase as any)
              .from('withdrawal_requests')
              .update({ status: payoutData.status })
              .eq('id', withdrawalRequest.id);
          }

          const withdrawalStatus = payoutData?.status || 'processing';

          if (withdrawalRequest) {
            set({
              withdrawalRequests: [{ ...withdrawalRequest, status: withdrawalStatus }, ...withdrawalRequests],
              isLoading: false,
            });
          } else {
            set({ isLoading: false });
          }
          
          return {
            success: true,
            payoutSubmitted: true,
            ledgerRecorded: withdrawalRequest !== null,
            providerQueued: Boolean(payoutData?.queuedForProviderBalance),
          };
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return {
            success: false,
            payoutSubmitted: false,
            ledgerRecorded: false,
            providerQueued: false,
          };
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
              paystackSubaccountCode: bankAccount.paystackSubaccountCode,
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
              paystack_subaccount_code: verification.paystackSubaccountCode || null,
              paystack_subaccount_id: verification.paystackSubaccountId || null,
            };

            let data: any = null;
            let error: any = null;

            ({ data, error } = await withTimeout<{ data: any; error: any }>(
              (supabase as any)
                .from('business_bank_accounts')
                .upsert(paystackExtendedPayload, { onConflict: 'user_id' })
                .select('*')
                .single(),
              12000,
              'Bank account save timeout'
            ));

            if (error && /column|bank_code|paystack_|iban|swift_code|schema cache/i.test(error.message || '')) {
              ({ data, error } = await withTimeout<{ data: any; error: any }>(
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
                paystack_subaccount_code: verification.paystackSubaccountCode || undefined,
                paystack_subaccount_id: verification.paystackSubaccountId || undefined,
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
            paystack_subaccount_code: null,
            paystack_subaccount_id: null,
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

          ({ data, error } = await withTimeout<{ data: any; error: any }>(
            (supabase as any)
              .from('business_bank_accounts')
              .upsert(extendedPayload, { onConflict: 'user_id' })
              .select('*')
              .single(),
            12000,
            'Bank account save timeout'
          ));

          if (error && /column|iban|swift_code/i.test(error.message || '')) {
            ({ data, error } = await withTimeout<{ data: any; error: any }>(
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
              paystack_subaccount_code: undefined,
              paystack_subaccount_id: undefined,
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

          const resolvedExistingBankAccountId = normalizeBusinessBankAccountId(businessBankAccount.id);

          const resolveTableBusinessBankAccountId = async (): Promise<string | null> => {
            if (isUuidLike(resolvedExistingBankAccountId)) {
              return normalizeBusinessBankAccountId(resolvedExistingBankAccountId);
            }

            const { data: bankRow, error: bankRowError } = await (supabase as any)
              .from('business_bank_accounts')
              .select('id')
              .eq('user_id', user.id)
              .eq('is_active', true)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (bankRowError && !isBusinessBankTableUnavailableError(bankRowError)) {
              throw new Error(`Failed to resolve bank account for update: ${bankRowError.message}`);
            }

            if (isUuidLike(bankRow?.id)) {
              return normalizeBusinessBankAccountId(bankRow.id);
            }

            return null;
          };

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
              paystackSubaccountCode: businessBankAccount.paystackSubaccountCode,
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
              paystack_subaccount_code: verification.paystackSubaccountCode || businessBankAccount.paystackSubaccountCode || null,
              paystack_subaccount_id: verification.paystackSubaccountId || businessBankAccount.paystackSubaccountId || null,
            };

            const tableBusinessBankAccountId = await resolveTableBusinessBankAccountId();
            const shouldUpsertByUser = !tableBusinessBankAccountId;

            const paystackExtendedWritePayload: Record<string, any> = shouldUpsertByUser
              ? {
                  user_id: user.id,
                  is_active: true,
                  ...paystackExtendedPayload,
                }
              : paystackExtendedPayload;

            const paystackBaseWritePayload: Record<string, any> = shouldUpsertByUser
              ? {
                  user_id: user.id,
                  is_active: true,
                  ...paystackBasePayload,
                }
              : paystackBasePayload;

            let data: any = null;
            let error: any = null;

            if (shouldUpsertByUser) {
              ({ data, error } = await withTimeout<{ data: any; error: any }>(
                (supabase as any)
                  .from('business_bank_accounts')
                  .upsert(paystackExtendedWritePayload, { onConflict: 'user_id' })
                  .select('*')
                  .single(),
                12000,
                'Bank account update timeout'
              ));
            } else {
              ({ data, error } = await withTimeout<{ data: any; error: any }>(
                (supabase as any)
                  .from('business_bank_accounts')
                  .update(paystackExtendedWritePayload)
                  .eq('id', tableBusinessBankAccountId)
                  .select('*')
                  .single(),
                12000,
                'Bank account update timeout'
              ));
            }

            if (error && /column|bank_code|paystack_|iban|swift_code|schema cache/i.test(error.message || '')) {
              if (shouldUpsertByUser) {
                ({ data, error } = await withTimeout<{ data: any; error: any }>(
                  (supabase as any)
                    .from('business_bank_accounts')
                    .upsert(paystackBaseWritePayload, { onConflict: 'user_id' })
                    .select('*')
                    .single(),
                  12000,
                  'Bank account update timeout'
                ));
              } else {
                ({ data, error } = await withTimeout<{ data: any; error: any }>(
                  (supabase as any)
                    .from('business_bank_accounts')
                    .update(paystackBaseWritePayload)
                    .eq('id', tableBusinessBankAccountId)
                    .select('*')
                    .single(),
                  12000,
                  'Bank account update timeout'
                ));
              }
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
                paystack_subaccount_code: verification.paystackSubaccountCode || businessBankAccount.paystackSubaccountCode,
                paystack_subaccount_id: verification.paystackSubaccountId || businessBankAccount.paystackSubaccountId,
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
              paystack_subaccount_code: undefined,
              paystack_subaccount_id: undefined,
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
          updatePayload.paystack_subaccount_code = null;
          updatePayload.paystack_subaccount_id = null;
          updatePayload.verified_at = new Date().toISOString();

          let data: any = null;
          let error: any = null;

          ({ data, error } = await withTimeout<{ data: any; error: any }>(
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
            ({ data, error } = await withTimeout<{ data: any; error: any }>(
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
