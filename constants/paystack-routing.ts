export type PaystackRoutingConfig = {
  subaccount?: string;
  splitCode?: string;
  transactionCharge?: number;
  bearer?: 'account' | 'subaccount';
};

// Temporary owner->Paystack routing map until DB-backed fields are populated.
const PAYSTACK_ROUTING_BY_OWNER: Record<string, PaystackRoutingConfig> = {
  'bdd35e34-a864-4fea-9cff-8bbf0f1fa878': {
    subaccount: 'ACCT_g4udpjs9dnbj9p9',
    splitCode: 'SPL_ZAUEkl1dcl',
    bearer: 'account',
  },
};

export const getPaystackRoutingForOwner = (ownerId?: string | null): PaystackRoutingConfig => {
  const key = String(ownerId || '').trim();
  if (!key) return {};
  return PAYSTACK_ROUTING_BY_OWNER[key] || {};
};
