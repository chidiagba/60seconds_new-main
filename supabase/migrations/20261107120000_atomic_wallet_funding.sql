-- One transaction handles replay detection, wallet locking, credit and ledger insertion.
CREATE OR REPLACE FUNCTION public.finalize_paystack_wallet_funding(
 target_user uuid, payment_reference text, payment_transaction_id text, amount numeric, currency text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE target_wallet public.wallets; entry_id uuid;
BEGIN
 IF amount IS NULL OR amount <= 0 OR payment_reference IS NULL OR payment_reference='' OR target_user IS NULL THEN
  RAISE EXCEPTION 'Invalid funding input';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('paystack-funding:' || payment_reference,0));
 SELECT id INTO entry_id FROM public.transactions WHERE metadata->>'entry'='wallet_funding' AND metadata->>'payment_reference'=payment_reference;
 IF FOUND THEN RETURN jsonb_build_object('success',true,'alreadySettled',true); END IF;
 INSERT INTO public.wallets(user_id,balance,currency,is_active) VALUES(target_user,0,currency,true)
 ON CONFLICT(user_id) DO UPDATE SET is_active=true RETURNING * INTO target_wallet;
 -- ON CONFLICT above holds a row lock, serializing credits from different references too.
 IF upper(target_wallet.currency) <> upper(currency) THEN RAISE EXCEPTION 'Wallet currency mismatch'; END IF;
 UPDATE public.wallets SET balance=balance+amount,updated_at=now() WHERE id=target_wallet.id;
 INSERT INTO public.transactions(wallet_id,amount,type,status,description,transaction_fee,metadata)
 VALUES(target_wallet.id,amount,'deposit','completed','Paystack wallet funding',0,
 jsonb_build_object('entry','wallet_funding','payment_provider','paystack','payment_reference',payment_reference,'payment_transaction_id',payment_transaction_id,'currency',currency,'user_id',target_user));
 RETURN jsonb_build_object('success',true,'alreadySettled',false);
END $$;
REVOKE ALL ON FUNCTION public.finalize_paystack_wallet_funding(uuid,text,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_paystack_wallet_funding(uuid,text,text,numeric,text) TO service_role;

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
    IF tx.entry IN ('owner_credit', 'wallet_funding') THEN
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


-- Retain the verified settlement currency on newly created wallets.
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
  INSERT INTO wallets(user_id,currency,is_verified,is_active,updated_at) VALUES(p_owner_id,p_currency,true,true,now())
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,updated_at=now()
    RETURNING * INTO owner_wallet;
  IF upper(owner_wallet.currency) <> upper(p_currency) THEN RAISE EXCEPTION 'Wallet currency mismatch'; END IF;
  new_balance := round((coalesce(owner_wallet.balance,0)+p_net)::numeric,2);
  UPDATE wallets SET balance=new_balance,updated_at=now() WHERE id=owner_wallet.id;
  INSERT INTO transactions(wallet_id,amount,type,status,description,transaction_fee,metadata,created_at,updated_at)
  VALUES(owner_wallet.id,p_net,'deposit','completed','Payment received and sent to Paystack subaccount',0,
    p_metadata || jsonb_build_object('entry','owner_credit','payment_provider','paystack','payment_reference',p_reference,
      'payment_transaction_id',p_transaction_id,'order_id',p_order_id,'owner_id',p_owner_id,'buyer_id',p_buyer_id,
      'gross_amount',p_gross,'net_amount',p_net,'platform_fee_amount',p_fee,'currency',p_currency),now(),now())
  RETURNING id INTO existing_tx;
  INSERT INTO wallets(user_id,currency,is_active,updated_at) VALUES(p_buyer_id,p_currency,true,now())
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
