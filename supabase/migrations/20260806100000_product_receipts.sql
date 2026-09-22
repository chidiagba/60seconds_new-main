-- Generalize paid purchase receipts so tickets and physical/service products
-- share the same secure QR verification flow.

ALTER TABLE public.ticket_receipts
  ADD COLUMN IF NOT EXISTS receipt_kind text;

UPDATE public.ticket_receipts
SET receipt_kind = CASE
  WHEN lower(COALESCE(ticket_type, 'ticket')) = 'ticket' THEN 'ticket'
  ELSE 'product'
END
WHERE receipt_kind IS NULL;

ALTER TABLE public.ticket_receipts
  ALTER COLUMN receipt_kind SET DEFAULT 'ticket',
  ALTER COLUMN receipt_kind SET NOT NULL;

ALTER TABLE public.ticket_receipts
  DROP CONSTRAINT IF EXISTS ticket_receipts_receipt_kind_check;
ALTER TABLE public.ticket_receipts
  ADD CONSTRAINT ticket_receipts_receipt_kind_check
  CHECK (receipt_kind IN ('ticket', 'product'));

CREATE INDEX IF NOT EXISTS idx_ticket_receipts_buyer_kind
  ON public.ticket_receipts (buyer_id, receipt_kind, issued_at DESC);

DROP FUNCTION IF EXISTS public.redeem_ticket(text);

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
