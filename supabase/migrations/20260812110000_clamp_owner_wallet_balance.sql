-- A wallet can never owe money after provider settlement. If historical payout
-- rows exceed repaired credits, expose zero until a new purchase arrives.
CREATE OR REPLACE FUNCTION public.recalculate_owner_wallet_balance(target_wallet_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.wallets w
  SET balance = GREATEST(0, ledger.balance), updated_at = now()
  FROM (
    SELECT round(COALESCE(sum(
      CASE
        WHEN tx.status = 'completed' AND tx.metadata->>'entry' = 'owner_credit'
          THEN GREATEST(tx.amount, 0)
        WHEN tx.status = 'completed' AND tx.metadata->>'entry' IN
          ('paystack_bank_settlement', 'owner_withdrawal')
          THEN -abs(tx.amount)
        ELSE 0
      END
    ), 0)::numeric, 2) AS balance
    FROM public.transactions tx
    WHERE tx.wallet_id = target_wallet_id
  ) ledger
  WHERE w.id = target_wallet_id
    AND EXISTS (
      SELECT 1 FROM public.transactions owner_tx
      WHERE owner_tx.wallet_id = target_wallet_id
        AND owner_tx.metadata->>'entry' = 'owner_credit'
    );
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
