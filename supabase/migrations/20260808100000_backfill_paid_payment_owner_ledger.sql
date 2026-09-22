-- Repair fulfilled orders whose organizer ledger row was never created.
-- Issued purchase receipts and completed order statuses are authoritative evidence.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH order_item_owners AS (
  SELECT
    o.id AS order_id,
    min(p.business_id::text)::uuid AS owner_id,
    COALESCE(NULLIF(max(upper(p.currency)), ''), 'USD') AS currency
  FROM public.orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(to_jsonb(o.items)) = 'array'
      THEN to_jsonb(o.items) ELSE '[]'::jsonb END
  ) item(value)
  JOIN public.products p
    ON p.id::text = COALESCE(item.value->>'product_id', item.value->>'productId', item.value->>'id')
  WHERE p.business_id IS NOT NULL
  GROUP BY o.id
  HAVING count(DISTINCT p.business_id) = 1
), fulfilled_orders AS (
  SELECT
    receipt.order_id,
    min(receipt.created_at) AS fulfilled_at,
    COALESCE(NULLIF(max(upper(receipt.currency)), ''), 'USD') AS receipt_currency
  FROM public.ticket_receipts receipt
  WHERE receipt.order_id IS NOT NULL
  GROUP BY receipt.order_id
), candidates AS (
  SELECT
    o.id AS order_id,
    o.user_id AS buyer_id,
    COALESCE(o.business_id, oio.owner_id) AS owner_id,
    o.total_amount::numeric AS gross_amount,
    COALESCE(fo.receipt_currency, oio.currency, 'USD') AS currency,
    COALESCE(NULLIF(lower(o.payment_method), ''), 'paystack') AS provider,
    o.video_id,
    o.items,
    COALESCE(fo.fulfilled_at, o.created_at) AS paid_at
  FROM public.orders o
  LEFT JOIN order_item_owners oio ON oio.order_id = o.id
  LEFT JOIN fulfilled_orders fo ON fo.order_id = o.id
  WHERE COALESCE(o.business_id, oio.owner_id) IS NOT NULL
    AND o.total_amount > 0
    AND (
      fo.order_id IS NOT NULL
      OR lower(COALESCE(o.status::text, '')) IN
        ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
      OR lower(COALESCE(to_jsonb(o)->>'payment_status', '')) IN
        ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
    )
), missing_wallets AS (
  INSERT INTO public.wallets (user_id, balance, is_active, updated_at)
  SELECT DISTINCT owner_id, 0, true, now()
  FROM candidates
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id, user_id
), owner_wallets AS (
  SELECT id, user_id FROM public.wallets
  UNION ALL
  SELECT id, user_id FROM missing_wallets
), inserted AS (
  INSERT INTO public.transactions (
    id, wallet_id, amount, type, status, description, transaction_fee,
    metadata, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    w.id,
    round((c.gross_amount / 1.04)::numeric, 2),
    'deposit',
    'completed',
    CASE WHEN c.provider = 'paystack' THEN 'Paystack sale settlement' ELSE 'Sale settlement' END,
    0,
    jsonb_build_object(
      'entry', 'owner_credit',
      'source', 'successful_payment_ledger_repair',
      'payment_provider', c.provider,
      'owner_id', c.owner_id,
      'buyer_id', c.buyer_id,
      'order_id', c.order_id,
      'video_id', c.video_id,
      'payment_reference', NULL,
      'payment_transaction_id', NULL,
      'gross_amount', round(c.gross_amount, 2),
      'platform_fee_amount', round(c.gross_amount - (c.gross_amount / 1.04), 2),
      'net_amount', round(c.gross_amount / 1.04, 2),
      'currency', c.currency,
      'items', to_jsonb(c.items),
      'reconciled_at', now()
    ),
    c.paid_at,
    now()
  FROM candidates c
  JOIN owner_wallets w ON w.user_id = c.owner_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.transactions tx
    WHERE tx.metadata->>'entry' = 'owner_credit'
      AND tx.metadata->>'order_id' = c.order_id::text
  )
  RETURNING wallet_id
)
SELECT count(*) FROM inserted;

-- Make successfully paid legacy orders discoverable by normal app queries.
WITH order_item_owners AS (
  SELECT o.id AS order_id, min(p.business_id::text)::uuid AS owner_id
  FROM public.orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(to_jsonb(o.items)) = 'array'
      THEN to_jsonb(o.items) ELSE '[]'::jsonb END
  ) item(value)
  JOIN public.products p
    ON p.id::text = COALESCE(item.value->>'product_id', item.value->>'productId', item.value->>'id')
  WHERE p.business_id IS NOT NULL
  GROUP BY o.id
  HAVING count(DISTINCT p.business_id) = 1
), fulfilled_order_ids AS (
  SELECT DISTINCT order_id
  FROM public.ticket_receipts
  WHERE order_id IS NOT NULL
)
UPDATE public.orders o
SET
  business_id = COALESCE(o.business_id, oio.owner_id),
  status = 'completed',
  updated_at = now()
FROM order_item_owners oio
JOIN fulfilled_order_ids fulfilled ON fulfilled.order_id = oio.order_id
WHERE o.id = oio.order_id;

-- Keep the withdrawal authority (wallet.balance) synchronized with the ledger.
WITH ledger_balances AS (
  SELECT
    w.id AS wallet_id,
    round(COALESCE(sum(
      CASE
        WHEN tx.status = 'completed' AND tx.metadata->>'entry' = 'owner_credit'
          THEN GREATEST(tx.amount, 0)
        WHEN tx.status IN ('pending', 'processing', 'completed')
          AND (tx.type = 'withdrawal' OR tx.metadata->>'entry' = 'owner_withdrawal')
          THEN -abs(tx.amount)
        ELSE 0
      END
    ), 0)::numeric, 2) AS balance
  FROM public.wallets w
  JOIN public.transactions owner_tx
    ON owner_tx.wallet_id = w.id AND owner_tx.metadata->>'entry' = 'owner_credit'
  LEFT JOIN public.transactions tx ON tx.wallet_id = w.id
  GROUP BY w.id
)
UPDATE public.wallets w
SET balance = lb.balance, updated_at = now()
FROM ledger_balances lb
WHERE w.id = lb.wallet_id;
