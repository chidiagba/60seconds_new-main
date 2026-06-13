CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH paid_order_items AS (
  SELECT
    o.id AS order_id,
    o.video_id,
    o.created_at,
    item.value AS item,
    item.value->>'product_id' AS product_id,
    GREATEST(COALESCE((item.value->>'quantity')::numeric, 1), 1) AS quantity,
    COALESCE((item.value->>'price')::numeric, 0) AS item_price
  FROM public.orders o
  CROSS JOIN LATERAL jsonb_array_elements(to_jsonb(o.items)) AS item(value)
  WHERE lower(COALESCE(o.status::text, '')) IN ('paid', 'completed', 'success', 'successful')
),
business_order_settlements AS (
  SELECT
    poi.order_id,
    p.business_id AS owner_id,
    w.id AS wallet_id,
    max(poi.video_id::text) AS video_id,
    max(poi.created_at) AS created_at,
    COALESCE(NULLIF(max(p.currency), ''), 'NGN') AS currency,
    round(sum(CASE WHEN poi.item_price > 0 THEN poi.item_price * poi.quantity ELSE p.price * 1.04 * poi.quantity END)::numeric, 2) AS gross_amount,
    round(sum(p.price * poi.quantity)::numeric, 2) AS net_amount,
    jsonb_agg(
      jsonb_build_object(
        'productId', p.id,
        'quantity', poi.quantity,
        'unitPrice', CASE WHEN poi.item_price > 0 THEN poi.item_price ELSE round((p.price * 1.04)::numeric, 2) END,
        'totalPrice', CASE WHEN poi.item_price > 0 THEN round((poi.item_price * poi.quantity)::numeric, 2) ELSE round((p.price * 1.04 * poi.quantity)::numeric, 2) END,
        'netPrice', round((p.price * poi.quantity)::numeric, 2)
      )
    ) AS items
  FROM paid_order_items poi
  JOIN public.products p ON p.id::text = poi.product_id
  JOIN public.wallets w ON w.user_id = p.business_id
  GROUP BY poi.order_id, p.business_id, w.id
),
inserted_owner_credits AS (
  INSERT INTO public.transactions (
    id,
    wallet_id,
    amount,
    type,
    status,
    description,
    transaction_fee,
    metadata,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    settlement.wallet_id,
    settlement.net_amount,
    'deposit',
    'completed',
    'Sale settlement',
    0,
    jsonb_build_object(
      'entry', 'owner_credit',
      'source', 'business_wallet_sql_backfill',
      'owner_id', settlement.owner_id,
      'order_id', settlement.order_id,
      'video_id', settlement.video_id,
      'gross_amount', settlement.gross_amount,
      'platform_fee_amount', round((settlement.gross_amount - settlement.net_amount)::numeric, 2),
      'net_amount', settlement.net_amount,
      'currency', settlement.currency,
      'items', settlement.items,
      'reconciled_at', now()
    ),
    settlement.created_at,
    now()
  FROM business_order_settlements settlement
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.transactions existing
    WHERE
      existing.wallet_id = settlement.wallet_id
      AND existing.metadata->>'entry' = 'owner_credit'
      AND existing.metadata->>'order_id' = settlement.order_id::text
  )
  RETURNING wallet_id
),
updated_existing_owner_credits AS (
  UPDATE public.transactions tx
  SET
    amount = settlement.net_amount,
    metadata = COALESCE(tx.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'entry', 'owner_credit',
        'owner_id', settlement.owner_id,
        'order_id', settlement.order_id,
        'gross_amount', settlement.gross_amount,
        'platform_fee_amount', round((settlement.gross_amount - settlement.net_amount)::numeric, 2),
        'net_amount', settlement.net_amount,
        'currency', settlement.currency,
        'items', settlement.items,
        'reconciled_at', now()
      ),
    updated_at = now()
  FROM business_order_settlements settlement
  WHERE
    tx.wallet_id = settlement.wallet_id
    AND tx.metadata->>'entry' = 'owner_credit'
    AND tx.metadata->>'order_id' = settlement.order_id::text
  RETURNING tx.wallet_id
),
business_wallet_balances AS (
  SELECT
    w.id AS wallet_id,
    round(
      COALESCE(sum(
        CASE
          WHEN tx.status = 'completed' AND tx.metadata->>'entry' = 'owner_credit' THEN GREATEST(tx.amount, 0)
          WHEN tx.status = 'completed' AND (tx.type = 'withdrawal' OR tx.metadata->>'entry' = 'owner_withdrawal') THEN -abs(tx.amount)
          ELSE 0
        END
      ), 0)::numeric,
      2
    ) AS balance,
    COALESCE(
      max(NULLIF(tx.metadata->>'currency', '')) FILTER (WHERE tx.metadata->>'entry' = 'owner_credit'),
      max(NULLIF(bba.currency, '')),
      'NGN'
    ) AS currency
  FROM public.wallets w
  LEFT JOIN public.transactions tx ON tx.wallet_id = w.id
  LEFT JOIN public.business_bank_accounts bba ON bba.user_id = w.user_id
  WHERE w.id IN (
    SELECT wallet_id FROM business_order_settlements
    UNION
    SELECT wallet_id FROM inserted_owner_credits
    UNION
    SELECT wallet_id FROM updated_existing_owner_credits
  )
  GROUP BY w.id
)
UPDATE public.wallets w
SET
  balance = business_wallet_balances.balance,
  currency = CASE
    WHEN lower(COALESCE(business_wallet_balances.currency, '')) IN ('ngn', 'ng', 'nga', 'nigeria') THEN 'NGN'
    ELSE business_wallet_balances.currency
  END,
  updated_at = now()
FROM business_wallet_balances
WHERE w.id = business_wallet_balances.wallet_id;

UPDATE public.wallets w
SET currency = 'NGN', updated_at = now()
FROM public.business_bank_accounts bba
WHERE
  bba.user_id = w.user_id
  AND (
    lower(COALESCE(bba.currency, '')) = 'ngn'
    OR lower(COALESCE(bba.country, '')) = 'nigeria'
    OR lower(COALESCE(bba.country_code, '')) IN ('ng', 'nga')
    OR lower(COALESCE(bba.payout_provider::text, '')) = 'paystack'
    OR lower(COALESCE(bba.bank_name, '')) LIKE '%opay%'
  );
