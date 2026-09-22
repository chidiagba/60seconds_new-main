-- Separate payment state from fulfilment state.
-- A successful payment opens an order; only fulfilment/redemption completes it.

CREATE OR REPLACE FUNCTION public.completed_payment_ensures_order_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_id IS NOT NULL
     AND lower(COALESCE(NEW.status::text, '')) IN
       ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved') THEN
    UPDATE public.orders
    SET payment_status = 'paid',
        status = CASE
          WHEN status IN ('cancelled', 'completed') AND completed_at IS NOT NULL THEN status
          ELSE 'open'
        END,
        updated_at = COALESCE(NEW.completed_at, NEW.updated_at, now())
    WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Protect future gateway/client code from confusing payment completion with
-- order fulfilment. Fulfilment paths set completed_at in the same transaction.
CREATE OR REPLACE FUNCTION public.enforce_paid_order_fulfilment_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(NEW.payment_status::text, '')) IN
       ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
     AND NEW.status = 'completed'
     AND NEW.completed_at IS NULL THEN
    NEW.status := 'open';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_paid_order_fulfilment_status ON public.orders;
CREATE TRIGGER trg_enforce_paid_order_fulfilment_status
BEFORE INSERT OR UPDATE OF status, payment_status, completed_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_paid_order_fulfilment_status();

-- Keep the order synchronized even when redemption is performed by an older
-- app version. The last active receipt being scanned is the completion event.
CREATE OR REPLACE FUNCTION public.sync_order_after_receipt_redemption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_active_receipts boolean;
BEGIN
  IF NEW.redeemed_at IS NOT NULL AND NEW.is_active IS NOT TRUE THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ticket_receipts
      WHERE order_id = NEW.order_id AND is_active IS TRUE
    ) INTO has_active_receipts;

    UPDATE public.orders
    SET status = CASE WHEN has_active_receipts THEN 'open' ELSE 'completed' END,
        completed_at = CASE WHEN has_active_receipts THEN NULL ELSE COALESCE(completed_at, NEW.redeemed_at, now()) END,
        updated_at = now()
    WHERE id = NEW.order_id AND status <> 'cancelled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_after_receipt_redemption ON public.ticket_receipts;
CREATE TRIGGER trg_sync_order_after_receipt_redemption
AFTER UPDATE OF redeemed_at, is_active ON public.ticket_receipts
FOR EACH ROW EXECUTE FUNCTION public.sync_order_after_receipt_redemption();

-- Historical repair: retain genuinely fulfilled orders, and reopen paid orders
-- that were marked completed merely because payment succeeded.
UPDATE public.orders o
SET completed_at = history.last_redeemed_at,
    status = 'completed',
    updated_at = now()
FROM (
  SELECT order_id, max(redeemed_at) AS last_redeemed_at
  FROM public.ticket_receipts
  GROUP BY order_id
  HAVING count(*) FILTER (WHERE is_active IS TRUE) = 0
     AND bool_and(redeemed_at IS NOT NULL)
) history
WHERE o.id = history.order_id
  AND o.status <> 'cancelled';

UPDATE public.orders o
SET status = 'open', completed_at = NULL, updated_at = now()
WHERE lower(COALESCE(o.payment_status::text, '')) IN
        ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
  AND o.status NOT IN ('cancelled', 'open')
  AND o.completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_management_status_created
  ON public.orders (business_id, status, created_at DESC);

-- Completion is intentionally not exposed as a manual status change. Business
-- users complete purchases through redeem_ticket/QR scanning; cancellation is
-- still available with the existing ownership and audit requirements.
CREATE OR REPLACE FUNCTION public.manage_business_order(
  target_order_id uuid,
  next_status text,
  cancellation_reason text DEFAULT NULL
)
RETURNS SETOF public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  current_order public.orders%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
  END IF;
  IF next_status <> 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Scan the purchase QR code to complete this order';
  END IF;
  IF NULLIF(btrim(cancellation_reason), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A cancellation reason is required';
  END IF;

  SELECT * INTO current_order FROM public.orders WHERE id = target_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Order not found'; END IF;
  IF current_order.status NOT IN ('open', 'confirmed') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Completed or cancelled orders are read-only';
  END IF;
  IF current_order.business_id IS DISTINCT FROM actor_id AND NOT EXISTS (
    SELECT 1 FROM public.ticket_receipts r
    WHERE r.order_id = target_order_id AND r.owner_id = actor_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This order belongs to another business';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = actor_id,
      cancellation_reason = btrim(cancellation_reason), updated_at = now()
  WHERE id = target_order_id
  RETURNING * INTO current_order;

  UPDATE public.ticket_receipts SET is_active = false, updated_at = now()
  WHERE order_id = target_order_id AND owner_id = actor_id;

  RETURN NEXT current_order;
END;
$$;
