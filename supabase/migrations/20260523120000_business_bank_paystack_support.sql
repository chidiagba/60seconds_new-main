ALTER TABLE public.business_bank_accounts
  ADD COLUMN IF NOT EXISTS payout_provider TEXT DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS bank_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_recipient_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_recipient_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_bank_accounts_payout_provider_check'
  ) THEN
    ALTER TABLE public.business_bank_accounts
      ADD CONSTRAINT business_bank_accounts_payout_provider_check
      CHECK (payout_provider IN ('stripe', 'paystack'));
  END IF;
END $$;

ALTER TABLE public.business_bank_accounts
  ALTER COLUMN payout_provider SET DEFAULT 'stripe';

CREATE INDEX IF NOT EXISTS idx_business_bank_accounts_payout_provider
  ON public.business_bank_accounts(payout_provider);