ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS payout_provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_transfer_code TEXT,
  ADD COLUMN IF NOT EXISTS provider_transfer_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_last_status TEXT;

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_provider_reference
  ON public.withdrawal_requests(provider_reference);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_provider_status
  ON public.withdrawal_requests(payout_provider, status);
