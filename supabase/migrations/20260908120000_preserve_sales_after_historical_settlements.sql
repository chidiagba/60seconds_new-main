-- Historical Paystack payouts must not consume purchases made after the payout.
-- Pending payouts remain visible without reducing the wallet.
CREATE OR REPLACE FUNCTION public.recalculate_owner_wallet_balance(target_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx record;
  running_balance numeric := 0;
BEGIN
  -- Serialize recalculations for this wallet.
  PERFORM 1 FROM public.wallets WHERE id = target_wallet_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE wallet_id = target_wallet_id AND metadata->>'entry' = 'owner_credit'
  ) THEN RETURN; END IF;

  FOR tx IN
    SELECT amount, type, metadata->>'entry' AS entry
    FROM public.transactions
    WHERE wallet_id = target_wallet_id
      AND lower(trim(status::text)) IN ('completed', 'success', 'successful', 'paid')
    ORDER BY CASE WHEN metadata->>'entry' = 'paystack_bank_settlement'
      THEN COALESCE(NULLIF(metadata->>'settlement_date', '')::timestamptz, created_at)
      ELSE created_at END,
      CASE WHEN metadata->>'entry' = 'paystack_bank_settlement' THEN 1 ELSE 0 END,
      id
  LOOP
    IF tx.entry = 'owner_credit' THEN
      running_balance := running_balance + GREATEST(0, round(tx.amount::numeric, 2));
    ELSIF tx.entry = 'paystack_bank_settlement' THEN
      running_balance := GREATEST(0, running_balance - abs(round(tx.amount::numeric, 2)));
    ELSIF tx.entry = 'owner_withdrawal' OR tx.type = 'withdrawal' THEN
      running_balance := running_balance - abs(round(tx.amount::numeric, 2));
    END IF;
  END LOOP;
  UPDATE public.wallets SET balance = GREATEST(0, running_balance), updated_at = now()
  WHERE id = target_wallet_id;
END;
$$;

DO $$
DECLARE wallet_row record;
BEGIN
  FOR wallet_row IN
    SELECT DISTINCT wallet_id FROM public.transactions WHERE metadata->>'entry' = 'owner_credit'
  LOOP
    PERFORM public.recalculate_owner_wallet_balance(wallet_row.wallet_id);
  END LOOP;
END $$;
