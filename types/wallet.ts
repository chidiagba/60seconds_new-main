import { User } from './index';

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  walletId: string;
  amount: number;
  type: 'deposit' | 'withdrawal' | 'payment' | 'refund' | 'transfer' | 'fee';
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  description: string;
  transactionFee?: number; // Fee amount for this transaction
  metadata?: {
    productId?: string;
    videoId?: string;
    recipientId?: string;
    senderId?: string;
    paymentMethodId?: string;
    originalTransactionId?: string; // Reference to the transaction this fee is for
    feeRecipientId?: string; // ID of the platform account receiving the fee
    businessId?: string; // ID of the business receiving the payment
    subtotal?: number; // Original amount before fee
    paymentProvider?: 'internal' | 'twint' | 'paystack'; // Payment provider used
    twintTransactionId?: string; // Twint-specific transaction ID
    paystackReference?: string; // Paystack-specific reference
    paystackTransactionId?: string; // Paystack-specific transaction ID
  };
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  type: 'credit_card' | 'bank_account' | 'paypal' | 'twint' | 'paystack' | 'worldline' | 'datatrans';
  isDefault: boolean;
  lastFour?: string;
  expiryDate?: string;
  cardType?: 'visa' | 'mastercard' | 'amex' | 'discover';
  bankName?: string;
  accountType?: 'checking' | 'savings';
  nickname: string;
  twintPhoneNumber?: string; // Phone number associated with Twint account
  paystackEmail?: string; // Email associated with Paystack account
  paystackAuthCode?: string; // Authorization code for recurring payments
  worldlineCustomerId?: string; // Customer ID in Worldline system
  worldlinePaymentMethodId?: string; // Payment method ID in Worldline system
  createdAt: string;
}

export interface BusinessBankAccount {
  id: string;
  userId: string;
  isPrimary?: boolean;
  payoutProvider?: 'stripe' | 'paystack';
  accountName: string;
  accountNumber: string;
  routingNumber?: string;
  iban?: string;
  swiftCode?: string;
  bankName: string;
  bankCode?: string;
  country?: string;
  countryCode?: string;
  currency?: string;
  isVerified: boolean;
  verificationStatus?: 'pending' | 'verified' | 'failed';
  verificationReason?: string;
  paystackRecipientCode?: string;
  paystackRecipientId?: string;
  paystackSubaccountCode?: string;
  paystackSubaccountId?: string;
  stripeExternalAccountId?: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  businessBankAccountId: string;
  createdAt: string;
}

// Platform account for collecting fees
export const PLATFORM_ACCOUNT_ID = "platform_account";
export const PLATFORM_WALLET_ID = "platform_wallet";
export const TRANSACTION_FEE_PERCENTAGE = 0.04; // 4% fee

// Twint configuration
export const TWINT_MERCHANT_ID = "60seconds_merchant";
export const TWINT_API_KEY = "twint_api_key_placeholder";

// Paystack configuration
export const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || "pk_test_your_public_key_here";
export const PAYSTACK_MERCHANT_ID = "60seconds_paystack_merchant";
