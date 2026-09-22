ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_transaction_id text,
  ADD COLUMN IF NOT EXISTS payment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2),
  ADD COLUMN IF NOT EXISTS platform_fee numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_provider_reference_unique
  ON public.orders (payment_provider, payment_reference)
  WHERE payment_provider IS NOT NULL AND payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  organizer_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payment_provider text NOT NULL,
  provider_reference text NOT NULL,
  payment_method_id text,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_status text,
  transaction_id text,
  gateway_reference text,
  gateway_response jsonb,
  authorization_code text,
  processing_fee numeric(14,2) NOT NULL DEFAULT 0,
  net_amount numeric(14,2),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  completed_at timestamptz,
  paid_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_provider, provider_reference)
);
CREATE INDEX IF NOT EXISTS payments_order_created_idx ON public.payments(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_user_created_idx ON public.payments(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_transaction_unique
  ON public.payments(payment_provider, transaction_id) WHERE transaction_id IS NOT NULL;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment participants can read" ON public.payments FOR SELECT TO authenticated
USING (user_id = auth.uid() OR organizer_id = auth.uid());

DROP POLICY IF EXISTS "buyers and sellers view orders" ON public.orders;
CREATE POLICY "buyers and sellers view orders" ON public.orders FOR SELECT TO authenticated
USING (user_id = auth.uid() OR business_id = auth.uid() OR EXISTS (
  SELECT 1 FROM public.ticket_receipts receipt WHERE receipt.order_id = orders.id AND receipt.owner_id = auth.uid()
));

CREATE UNIQUE INDEX IF NOT EXISTS transactions_paystack_reference_entry_unique
  ON public.transactions ((metadata->>'payment_provider'), (metadata->>'payment_reference'), (metadata->>'entry'))
  WHERE metadata->>'payment_provider' = 'paystack' AND metadata->>'payment_reference' IS NOT NULL
    AND metadata->>'entry' IN ('owner_credit', 'buyer_debit');
CREATE INDEX IF NOT EXISTS ticket_receipts_order_idx ON public.ticket_receipts(order_id);
-- Payment completion is the customer-facing completed state; receipt issuance
-- must not downgrade it back to "open".
DROP TRIGGER IF EXISTS trg_open_order_when_receipt_is_issued ON public.ticket_receipts;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.finalize_paystack_ledger(
  p_order_id uuid, p_reference text, p_transaction_id text, p_owner_id uuid,
  p_buyer_id uuid, p_gross numeric, p_net numeric, p_fee numeric, p_currency text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner_wallet wallets%ROWTYPE; buyer_wallet wallets%ROWTYPE; existing_tx uuid; new_balance numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('paystack:' || p_reference, 0));
  SELECT id INTO existing_tx FROM transactions
    WHERE metadata->>'payment_provider'='paystack' AND metadata->>'payment_reference'=p_reference
      AND metadata->>'entry'='owner_credit' LIMIT 1;
  IF existing_tx IS NOT NULL THEN
    UPDATE transactions SET metadata = metadata || jsonb_build_object('order_id',p_order_id,'owner_id',p_owner_id,
      'buyer_id',p_buyer_id,'legacy_unlinked_payment',false,'reconciled_at',now()), updated_at=now()
      WHERE metadata->>'payment_provider'='paystack' AND metadata->>'payment_reference'=p_reference
        AND metadata->>'entry' IN ('owner_credit','buyer_debit');
    UPDATE payments SET status='completed',provider_status='success',transaction_id=p_transaction_id,
      gateway_reference=p_reference,net_amount=p_net,processing_fee=p_fee,completed_at=now(),paid_at=now(),updated_at=now()
      WHERE payment_provider='paystack' AND provider_reference=p_reference;
    UPDATE orders SET status='completed',payment_status='paid',payment_method='paystack',payment_provider='paystack',
      payment_reference=p_reference,payment_transaction_id=p_transaction_id,business_id=p_owner_id,updated_at=now()
      WHERE id=p_order_id;
    RETURN jsonb_build_object('alreadyFinalized', true, 'transactionId', existing_tx);
  END IF;
  INSERT INTO wallets(user_id,is_verified,is_active,updated_at) VALUES(p_owner_id,true,true,now())
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,updated_at=now()
    RETURNING * INTO owner_wallet;
  new_balance := round((coalesce(owner_wallet.balance,0)+p_net)::numeric,2);
  UPDATE wallets SET balance=new_balance,updated_at=now() WHERE id=owner_wallet.id;
  INSERT INTO transactions(wallet_id,amount,type,status,description,transaction_fee,metadata,created_at,updated_at)
  VALUES(owner_wallet.id,p_net,'deposit','completed','Payment received and sent to Paystack subaccount',0,
    p_metadata || jsonb_build_object('entry','owner_credit','payment_provider','paystack','payment_reference',p_reference,
      'payment_transaction_id',p_transaction_id,'order_id',p_order_id,'owner_id',p_owner_id,'buyer_id',p_buyer_id,
      'gross_amount',p_gross,'net_amount',p_net,'platform_fee_amount',p_fee,'currency',p_currency),now(),now())
  RETURNING id INTO existing_tx;
  INSERT INTO wallets(user_id,is_active,updated_at) VALUES(p_buyer_id,true,now())
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,updated_at=now() RETURNING * INTO buyer_wallet;
  INSERT INTO transactions(wallet_id,amount,type,status,description,transaction_fee,metadata,created_at,updated_at)
  VALUES(buyer_wallet.id,-p_gross,'payment','completed','Paystack purchase',p_fee,
    p_metadata || jsonb_build_object('entry','buyer_debit','payment_provider','paystack','payment_reference',p_reference,
      'payment_transaction_id',p_transaction_id,'order_id',p_order_id,'owner_id',p_owner_id,'buyer_id',p_buyer_id,
      'gross_amount',p_gross,'net_amount',p_net,'platform_fee_amount',p_fee,'currency',p_currency),now(),now());
  UPDATE payments SET status='completed',provider_status='success',transaction_id=p_transaction_id,
    gateway_reference=p_reference,net_amount=p_net,processing_fee=p_fee,completed_at=now(),paid_at=now(),updated_at=now()
    WHERE payment_provider='paystack' AND provider_reference=p_reference;
  UPDATE orders SET status='completed',payment_status='paid',payment_method='paystack',payment_provider='paystack',
    payment_reference=p_reference,payment_transaction_id=p_transaction_id,business_id=p_owner_id,updated_at=now()
    WHERE id=p_order_id;
  RETURN jsonb_build_object('alreadyFinalized',false,'transactionId',existing_tx,'walletId',owner_wallet.id,'walletBalance',new_balance);
END $$;
REVOKE ALL ON FUNCTION public.finalize_paystack_ledger(uuid,text,text,uuid,uuid,numeric,numeric,numeric,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_paystack_ledger(uuid,text,text,uuid,uuid,numeric,numeric,numeric,text,jsonb) TO service_role;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_receipts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
