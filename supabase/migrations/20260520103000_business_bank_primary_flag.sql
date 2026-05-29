ALTER TABLE public.business_bank_accounts
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT TRUE;

UPDATE public.business_bank_accounts
SET is_primary = TRUE
WHERE is_primary IS NULL;

ALTER TABLE public.business_bank_accounts
  ALTER COLUMN is_primary SET DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_bank_accounts_one_primary_per_user
  ON public.business_bank_accounts(user_id)
  WHERE is_primary = TRUE AND is_active = TRUE;
