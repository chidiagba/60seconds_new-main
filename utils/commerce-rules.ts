export const EVENT_SHARE_LIFETIME_MS = 48 * 60 * 60 * 1000;

export function eventShareExpired(endDate: string | null | undefined, startDate: string, now = Date.now()): boolean {
  const end = Date.parse(endDate || startDate);
  return !Number.isFinite(end) || now >= end + EVENT_SHARE_LIFETIME_MS;
}

export interface DiscountVoucher {
  businessId: string;
  productId?: string;
  isActive: boolean;
  expiryDate?: string | null;
  usageLimit?: number | null;
  usageCount: number;
  minPurchaseAmount?: number | null;
  maxDiscountAmount?: number | null;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}

export function voucherDiscount(v: DiscountVoucher, amount: number, productId?: string, businessId?: string, now = Date.now()): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Add products before applying a voucher');
  if (businessId && v.businessId !== businessId) throw new Error('Voucher belongs to another business');
  if (!v.isActive) throw new Error('Voucher is inactive');
  if (v.expiryDate && (!Number.isFinite(Date.parse(v.expiryDate)) || Date.parse(v.expiryDate) <= now)) throw new Error('Voucher has expired');
  if (v.usageLimit != null && v.usageCount >= v.usageLimit) throw new Error('Voucher usage limit reached');
  if (v.minPurchaseAmount != null && amount < v.minPurchaseAmount) throw new Error(`Minimum purchase amount is ${v.minPurchaseAmount.toFixed(2)}`);
  if (v.productId && v.productId !== productId) throw new Error('Voucher is only valid for specific products');
  if (!Number.isFinite(v.discountValue) || v.discountValue <= 0 || (v.discountType === 'percentage' && v.discountValue > 100)) throw new Error('Voucher has an invalid discount');
  let discount = v.discountType === 'percentage' ? amount * v.discountValue / 100 : v.discountValue;
  if (v.maxDiscountAmount != null) discount = Math.min(discount, v.maxDiscountAmount);
  return Math.round(Math.max(0, Math.min(amount, discount)) * 100) / 100;
}

const ZERO_DECIMAL_CURRENCIES = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']);
export const currencyDigits = (currency: string) => ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
export const toMinorUnits = (amount: number, currency: string) => Math.round(amount * 10 ** currencyDigits(currency));
export const markedPrice = (price: number, currency: string) => toMinorUnits(price * 1.04, currency) / 10 ** currencyDigits(currency);
