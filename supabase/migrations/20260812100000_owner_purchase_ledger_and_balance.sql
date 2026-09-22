-- Make the organizer wallet ledger the durable source of truth for purchases.
-- Covers historical orders, future order status changes, and Paystack payouts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.ensure_paid_order_owner_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_json jsonb := to_jsonb(NEW);
  owner_id uuid;
  owner_wallet_id uuid;
  gross numeric;
  net numeric;
  fee numeric;
  resolved_currency text;
  provider text;
  enriched_items jsonb;
BEGIN
  IF lower(COALESCE(order_json->>'payment_status', '')) NOT IN
       ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
     AND lower(COALESCE(order_json->>'status', '')) NOT IN
       ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved') THEN
    RETURN NEW;
  END IF;

  gross := COALESCE(NULLIF(order_json->>'total_amount', '')::numeric, 0);
  IF gross <= 0 THEN RETURN NEW; END IF;

  owner_id := NULLIF(order_json->>'business_id', '')::uuid;
  IF owner_id IS NULL THEN
    SELECT min(p.business_id::text)::uuid
      INTO owner_id
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(order_json->'items') = 'array'
        THEN order_json->'items' ELSE '[]'::jsonb END
    ) item(value)
    JOIN public.products p
      ON p.id::text = COALESCE(item.value->>'product_id', item.value->>'productId', item.value->>'id')
    HAVING count(DISTINCT p.business_id) = 1;
  END IF;
  IF owner_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(jsonb_agg(
    item.value || jsonb_strip_nulls(jsonb_build_object(
      'product_id', p.id,
      'name', COALESCE(item.value->>'name', p.name),
      'type', p.type,
      'currency', p.currency,
      'quantity', COALESCE(NULLIF(item.value->>'quantity', '')::numeric, 1),
      'unit_price', COALESCE(
        NULLIF(item.value->>'unit_price', '')::numeric,
        NULLIF(item.value->>'unitPrice', '')::numeric,
        NULLIF(item.value->>'price', '')::numeric,
        p.price
      )
    )) ORDER BY ordinality
  ), '[]'::jsonb)
  INTO enriched_items
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(order_json->'items') = 'array'
      THEN order_json->'items' ELSE '[]'::jsonb END
  ) WITH ORDINALITY item(value, ordinality)
  LEFT JOIN public.products p
    ON p.id::text = COALESCE(item.value->>'product_id', item.value->>'productId', item.value->>'id');

  net := COALESCE(
    NULLIF(order_json#>>'{payment_metadata,net_amount}', '')::numeric,
    round((gross / 1.04)::numeric, 2)
  );
  fee := round(gross - net, 2);
  resolved_currency := upper(COALESCE(
    NULLIF(order_json->>'currency', ''),
    NULLIF(order_json#>>'{payment_metadata,currency}', ''),
    'NGN'
  ));
  provider := lower(COALESCE(
    NULLIF(order_json->>'payment_provider', ''),
    NULLIF(order_json->>'payment_method', ''),
    'paystack'
  ));

  INSERT INTO public.wallets (user_id, balance, currency, is_active, is_verified, updated_at)
  VALUES (owner_id, 0, resolved_currency, true, true, now())
  ON CONFLICT (user_id) DO UPDATE SET
    is_active = true,
    updated_at = now()
  RETURNING id INTO owner_wallet_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.transactions tx
    WHERE tx.metadata->>'entry' = 'owner_credit'
      AND tx.metadata->>'order_id' = NEW.id::text
  ) THEN
    INSERT INTO public.transactions (
      id, wallet_id, amount, type, status, description, transaction_fee,
      metadata, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), owner_wallet_id, net, 'deposit', 'completed',
      'Purchase payment received', 0,
      jsonb_strip_nulls(jsonb_build_object(
        'entry', 'owner_credit',
        'source', 'paid_order_ledger_trigger',
        'lifecycle_stage', CASE WHEN provider = 'paystack' THEN 'in_paystack_subaccount' ELSE 'received' END,
        'payment_provider', provider,
        'owner_id', owner_id,
        'buyer_id', NULLIF(order_json->>'user_id', '')::uuid,
        'order_id', NEW.id,
        'video_id', NULLIF(order_json->>'video_id', '')::uuid,
        'event_id', NULLIF(order_json->>'event_id', '')::uuid,
        'payment_reference', order_json->>'payment_reference',
        'payment_transaction_id', order_json->>'payment_transaction_id',
        'gross_amount', round(gross, 2),
        'platform_fee_amount', fee,
        'net_amount', net,
        'currency', resolved_currency,
        'items', enriched_items
      )),
      COALESCE(NEW.created_at, now()), now()
    );
  ELSE
    UPDATE public.transactions tx
    SET
      description = 'Purchase payment received',
      metadata = tx.metadata || jsonb_strip_nulls(jsonb_build_object(
        'buyer_id', NULLIF(order_json->>'user_id', '')::uuid,
        'gross_amount', round(gross, 2),
        'platform_fee_amount', fee,
        'net_amount', net,
        'currency', resolved_currency,
        'items', enriched_items
      )),
      updated_at = now()
    WHERE tx.metadata->>'entry' = 'owner_credit'
      AND tx.metadata->>'order_id' = NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_ensure_owner_ledger ON public.orders;
CREATE TRIGGER orders_ensure_owner_ledger
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.ensure_paid_order_owner_ledger();

-- Re-run the idempotent ledger function for every historical paid/fulfilled order.
-- Receipt issuance is authoritative payment evidence for older ticket orders.
UPDATE public.orders o
SET
  status = CASE WHEN EXISTS (
    SELECT 1 FROM public.ticket_receipts r WHERE r.order_id = o.id
  ) THEN 'completed' ELSE o.status END,
  updated_at = now()
WHERE lower(COALESCE(to_jsonb(o)->>'payment_status', '')) IN
        ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
   OR lower(COALESCE(o.status::text, '')) IN
        ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
   OR EXISTS (SELECT 1 FROM public.ticket_receipts r WHERE r.order_id = o.id);

CREATE OR REPLACE FUNCTION public.recalculate_owner_wallet_balance(target_wallet_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.wallets w
  SET balance = ledger.balance, updated_at = now()
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

CREATE OR REPLACE FUNCTION public.sync_owner_wallet_balance_from_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_owner_wallet_balance(COALESCE(NEW.wallet_id, OLD.wallet_id));
  IF TG_OP = 'UPDATE' AND NEW.wallet_id IS DISTINCT FROM OLD.wallet_id THEN
    PERFORM public.recalculate_owner_wallet_balance(OLD.wallet_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS transactions_sync_owner_wallet_balance ON public.transactions;
CREATE TRIGGER transactions_sync_owner_wallet_balance
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.sync_owner_wallet_balance_from_ledger();

DO $$
DECLARE wallet_row record;
BEGIN
  FOR wallet_row IN
    SELECT DISTINCT wallet_id FROM public.transactions WHERE metadata->>'entry' = 'owner_credit'
  LOOP
    PERFORM public.recalculate_owner_wallet_balance(wallet_row.wallet_id);
  END LOOP;
END $$;
