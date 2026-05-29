-- Ensure business bank accounts table exists (legacy projects may miss it)
CREATE TABLE IF NOT EXISTS public.business_bank_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  bank_name TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  routing_number TEXT,
  iban TEXT,
  swift_code TEXT,
  country TEXT NOT NULL,
  country_code TEXT,
  currency TEXT DEFAULT 'USD',
  is_verified BOOLEAN DEFAULT FALSE,
  is_primary BOOLEAN DEFAULT TRUE,
  verification_status TEXT DEFAULT 'pending',
  verification_reason TEXT,
  stripe_external_account_id TEXT,
  verified_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.business_bank_accounts
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_reason TEXT,
  ADD COLUMN IF NOT EXISTS stripe_external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_bank_accounts_verification_status_check'
  ) THEN
    ALTER TABLE public.business_bank_accounts
      ADD CONSTRAINT business_bank_accounts_verification_status_check
      CHECK (verification_status IN ('pending', 'verified', 'failed'));
  END IF;
END $$;

-- Optional profile field used by verification function if app stores connect id there.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connected_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_business_bank_accounts_verification_status
  ON public.business_bank_accounts(verification_status);
