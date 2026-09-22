-- Secure, idempotent ticket/product redemption by the business that owns it.
-- Payment settlement remains responsible for issuing receipts, crediting the
-- owner's wallet, and reconciling inventory. This migration owns check-in.

ALTER TABLE public.ticket_receipts
  ADD COLUMN IF NOT EXISTS redeemed_at timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number text;

UPDATE public.orders
SET order_number = 'ORD-' || upper(substr(replace(id::text, '-', ''), 1, 16))
WHERE order_number IS NULL OR btrim(order_number) = '';

ALTER TABLE public.orders ALTER COLUMN order_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number_unique
  ON public.orders (order_number);

CREATE OR REPLACE FUNCTION public.assign_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NULLIF(btrim(NEW.order_number), '') IS NULL THEN
    NEW.order_number := 'ORD-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 16));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_order_number ON public.orders;
CREATE TRIGGER trg_assign_order_number
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.assign_order_number();

CREATE INDEX IF NOT EXISTS idx_ticket_receipts_qr_code_data
  ON public.ticket_receipts (qr_code_data);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_receipts_qr_code_unique
  ON public.ticket_receipts (qr_code_data);

CREATE INDEX IF NOT EXISTS idx_ticket_receipts_owner_active
  ON public.ticket_receipts (owner_id, is_active);

-- Older schemas constrain order status to payment-oriented values. Paid orders
-- are open until the purchased item/ticket is redeemed.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%payment_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'open', 'completed', 'failed', 'refunded', 'cancelled'));

-- Receipts are only created after confirmed payment. Keep the order usable
-- until admission/fulfilment instead of treating payment as fulfilment.
UPDATE public.orders o
SET status = 'open', updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM public.ticket_receipts tr
  WHERE tr.order_id = o.id AND tr.is_active = true
);

CREATE OR REPLACE FUNCTION public.open_order_when_receipt_is_issued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders SET status = 'open', updated_at = now() WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_open_order_when_receipt_is_issued ON public.ticket_receipts;
CREATE TRIGGER trg_open_order_when_receipt_is_issued
AFTER INSERT ON public.ticket_receipts
FOR EACH ROW EXECUTE FUNCTION public.open_order_when_receipt_is_issued();

CREATE OR REPLACE FUNCTION public.redeem_ticket(receipt_qr_code text)
RETURNS TABLE (
  receipt_id uuid,
  order_id uuid,
  order_number text,
  ticket_title text,
  event_name text,
  buyer_id uuid,
  redeemed_at timestamptz,
  order_status text
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid QR code';
  END IF;

  SELECT * INTO receipt
  FROM public.ticket_receipts tr
  WHERE tr.qr_code_data = receipt_qr_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Ticket not found';
  END IF;

  IF receipt.owner_id <> actor_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This ticket belongs to another organizer';
  END IF;

  IF receipt.is_active IS NOT TRUE OR receipt.redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Ticket has already been redeemed';
  END IF;

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

  next_order_status := CASE WHEN remaining_count = 0 THEN 'completed' ELSE 'open' END;

  UPDATE public.orders o
  SET status = next_order_status, updated_at = now()
  WHERE o.id = receipt.order_id;

  RETURN QUERY SELECT
    receipt.id,
    receipt.order_id,
    receipt.order_number,
    receipt.ticket_title,
    receipt.event_name,
    receipt.buyer_id,
    receipt.redeemed_at,
    next_order_status;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_ticket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_ticket(text) TO authenticated, service_role;
