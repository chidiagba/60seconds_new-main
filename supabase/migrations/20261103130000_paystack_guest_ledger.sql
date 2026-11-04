-- Guest checkout has no buyer wallet until the buyer signs up.
CREATE OR REPLACE FUNCTION public.finalize_paystack_ledger(p_order_id uuid, p_reference text, p_transaction_id text, p_owner_id uuid, p_buyer_id uuid, p_gross numeric, p_net numeric, p_fee numeric, p_currency text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF p_buyer_id IS NOT NULL THEN
  INSERT INTO wallets(user_id,is_active,updated_at) VALUES(p_buyer_id,true,now())
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,updated_at=now() RETURNING * INTO buyer_wallet;
  INSERT INTO transactions(wallet_id,amount,type,status,description,transaction_fee,metadata,created_at,updated_at)
  VALUES(buyer_wallet.id,-p_gross,'payment','completed','Paystack purchase',p_fee,
    p_metadata || jsonb_build_object('entry','buyer_debit','payment_provider','paystack','payment_reference',p_reference,
      'payment_transaction_id',p_transaction_id,'order_id',p_order_id,'owner_id',p_owner_id,'buyer_id',p_buyer_id,
      'gross_amount',p_gross,'net_amount',p_net,'platform_fee_amount',p_fee,'currency',p_currency),now(),now());
  END IF;
  UPDATE payments SET status='completed',provider_status='success',transaction_id=p_transaction_id,
    gateway_reference=p_reference,net_amount=p_net,processing_fee=p_fee,completed_at=now(),paid_at=now(),updated_at=now()
    WHERE payment_provider='paystack' AND provider_reference=p_reference;
  UPDATE orders SET status='completed',payment_status='paid',payment_method='paystack',payment_provider='paystack',
    payment_reference=p_reference,payment_transaction_id=p_transaction_id,business_id=p_owner_id,updated_at=now()
    WHERE id=p_order_id;
  RETURN jsonb_build_object('alreadyFinalized',false,'transactionId',existing_tx,'walletId',owner_wallet.id,'walletBalance',new_balance);
END $function$
;
