ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending','confirmed','open','partially_completed','completed','failed','refunded','cancelled'));
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
    SET status = CASE WHEN has_active_receipts THEN 'partially_completed' ELSE 'completed' END,
        completed_at = CASE WHEN has_active_receipts THEN NULL ELSE COALESCE(completed_at, NEW.redeemed_at, now()) END,
        updated_at = now()
    WHERE id = NEW.order_id AND status <> 'cancelled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_ticket(receipt_qr_code text)
RETURNS TABLE (
  receipt_id uuid,
  order_id uuid,
  order_number text,
  ticket_title text,
  event_name text,
  buyer_id uuid,
  redeemed_at timestamptz,
  order_status text,
  receipt_kind text,
  quantity integer,
  unit_price numeric,
  total_price numeric,
  currency text,
  product_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  receipt public.ticket_receipts%ROWTYPE;
  remaining_count integer;
  next_order_status text;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
  END IF;

  IF NULLIF(btrim(receipt_qr_code), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase QR code';
  END IF;

  SELECT * INTO receipt
  FROM public.ticket_receipts tr
  WHERE tr.qr_code_data = receipt_qr_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Purchase receipt not found';
  END IF;

  IF receipt.owner_id <> actor_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This purchase belongs to another organizer';
  END IF;

  IF receipt.is_active IS NOT TRUE OR receipt.redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Purchase has already been verified';
  END IF;

  -- Serialize scans for different receipts in the same order.
  PERFORM 1 FROM public.orders WHERE id = receipt.order_id FOR UPDATE;

  UPDATE public.ticket_receipts tr
  SET is_active = false,
      redeemed_at = now(),
      redeemed_by = actor_id,
      updated_at = now()
  WHERE tr.id = receipt.id
  RETURNING tr.redeemed_at INTO receipt.redeemed_at;

  SELECT count(*) INTO remaining_count
  FROM public.ticket_receipts tr
  WHERE tr.order_id = receipt.order_id AND tr.is_active = true;

  next_order_status := CASE WHEN remaining_count = 0 THEN 'completed' ELSE 'partially_completed' END;

  UPDATE public.orders o
  SET status = next_order_status, completed_at = CASE WHEN remaining_count = 0 THEN now() ELSE NULL END, updated_at = now()
  WHERE o.id = receipt.order_id;

  RETURN QUERY SELECT
    receipt.id,
    receipt.order_id,
    receipt.order_number,
    receipt.ticket_title,
    receipt.event_name,
    receipt.buyer_id,
    receipt.redeemed_at,
    next_order_status,
    receipt.receipt_kind,
    receipt.quantity,
    receipt.unit_price,
    receipt.total_price,
    receipt.currency,
    receipt.product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_ticket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_ticket(text) TO authenticated, service_role;

UPDATE public.orders o SET status = 'partially_completed' WHERE status = 'open' AND EXISTS (SELECT 1 FROM public.ticket_receipts r WHERE r.order_id=o.id AND r.redeemed_at IS NOT NULL) AND EXISTS (SELECT 1 FROM public.ticket_receipts r WHERE r.order_id=o.id AND r.is_active);

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
          WHEN status IN ('cancelled', 'completed', 'partially_completed') THEN status
          ELSE 'open'
        END,
        updated_at = COALESCE(NEW.completed_at, NEW.updated_at, now())
    WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

