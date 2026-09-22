ALTER TABLE public.business_bank_accounts
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

UPDATE public.business_bank_accounts
SET
  paystack_subaccount_code = COALESCE(
    paystack_subaccount_code,
    NULLIF(metadata->>'paystack_subaccount_code', '')
  ),
  paystack_subaccount_id = COALESCE(
    paystack_subaccount_id,
    NULLIF(metadata->>'paystack_subaccount_id', '')
  )
WHERE
  paystack_subaccount_code IS NULL
  OR paystack_subaccount_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_bank_accounts_paystack_subaccount_code
  ON public.business_bank_accounts(paystack_subaccount_code)
  WHERE paystack_subaccount_code IS NOT NULL;
