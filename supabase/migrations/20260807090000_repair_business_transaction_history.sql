-- Repair historical owner ledger gaps.
-- Future payments are written by the settlement edge functions; this migration
-- is intentionally additive and never deletes or rewrites existing ledger rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Older orders did not always store business_id. Resolve it from product items
-- (supporting both snake_case and camelCase JSON written by past app versions).
WITH order_item_owners AS (
  SELECT
    o.id AS order_id,
    min(p.business_id::text)::uuid AS owner_id,
    COALESCE(NULLIF(max(upper(p.currency)), ''), 'USD') AS currency
  FROM public.orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(to_jsonb(o.items)) = 'array' THEN to_jsonb(o.items)
      ELSE '[]'::jsonb
    END
  ) item(value)
  JOIN public.products p
    ON p.id::text = COALESCE(item.value->>'product_id', item.value->>'productId', item.value->>'id')
  WHERE p.business_id IS NOT NULL
  GROUP BY o.id
  HAVING count(DISTINCT p.business_id) = 1
), paid_orders AS (
  SELECT
    o.id AS order_id,
    COALESCE(o.business_id, oio.owner_id) AS owner_id,
    o.total_amount::numeric AS gross_amount,
    oio.currency,
    o.video_id,
    o.created_at
  FROM public.orders o
  LEFT JOIN order_item_owners oio ON oio.order_id = o.id
  WHERE COALESCE(o.business_id, oio.owner_id) IS NOT NULL
    AND o.total_amount > 0
    AND (
      lower(COALESCE(to_jsonb(o)->>'payment_status', '')) IN
        ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
      OR lower(COALESCE(o.status::text, '')) IN
        ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
    )
), missing_wallets AS (
  INSERT INTO public.wallets (user_id, balance, is_active, updated_at)
  SELECT DISTINCT owner_id, 0, true, now()
  FROM paid_orders
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id, user_id
), owner_wallets AS (
  SELECT id, user_id FROM public.wallets
  UNION ALL
  SELECT id, user_id FROM missing_wallets
), prepared AS (
  SELECT
    po.*,
    w.id AS wallet_id,
    COALESCE(NULLIF(po.currency, ''), NULLIF(upper(to_jsonb(w)->>'currency'), ''), 'USD') AS resolved_currency,
    round((po.gross_amount / 1.04)::numeric, 2) AS net_amount
  FROM paid_orders po
  JOIN owner_wallets w ON w.user_id = po.owner_id
)
INSERT INTO public.transactions (
  id, wallet_id, amount, type, status, description, transaction_fee,
  metadata, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  p.wallet_id,
  p.net_amount,
  'deposit',
  'completed',
  'Sale settlement',
  0,
  jsonb_build_object(
    'entry', 'owner_credit',
    'source', 'paid_order_history_repair',
    'owner_id', p.owner_id,
    'order_id', p.order_id,
    'video_id', p.video_id,
    'gross_amount', round(p.gross_amount, 2),
    'platform_fee_amount', round(p.gross_amount - p.net_amount, 2),
    'net_amount', p.net_amount,
    'currency', p.resolved_currency,
    'reconciled_at', now()
  ),
  p.created_at,
  now()
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.transactions tx
  WHERE tx.metadata->>'entry' = 'owner_credit'
    AND tx.metadata->>'order_id' = p.order_id::text
);

-- Speed up the idempotency checks used by both settlement edge functions.
CREATE INDEX IF NOT EXISTS transactions_owner_credit_order_idx
  ON public.transactions ((metadata->>'order_id'))
  WHERE metadata->>'entry' = 'owner_credit'
    AND NULLIF(metadata->>'order_id', '') IS NOT NULL;
