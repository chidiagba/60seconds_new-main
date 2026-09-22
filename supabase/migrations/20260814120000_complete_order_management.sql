-- Complete buyer/business order visibility, sequential public numbers and an
-- audited, owner-only terminal status transition.
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START WITH 1;
GRANT USAGE, SELECT ON SEQUENCE public.order_number_seq TO authenticated, service_role;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS refund_status text;

CREATE INDEX IF NOT EXISTS idx_orders_business_created
  ON public.orders (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_created
  ON public.orders (user_id, created_at DESC);

-- Preserve existing public numbers. New records use the requested #0000001 format.
CREATE OR REPLACE FUNCTION public.assign_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NULLIF(btrim(NEW.order_number), '') IS NULL THEN
    NEW.order_number := '#' || lpad(nextval('public.order_number_seq')::text, 7, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill seller/event ownership from paid receipts without changing history.
UPDATE public.orders o
SET business_id = source.owner_id,
    event_id = COALESCE(o.event_id, source.event_id)
FROM (
  SELECT order_id, min(owner_id::text)::uuid AS owner_id, min(event_id::text)::uuid AS event_id
  FROM public.ticket_receipts
  GROUP BY order_id
) source
WHERE source.order_id = o.id
  AND (o.business_id IS NULL OR o.event_id IS NULL);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "buyers and sellers view orders" ON public.orders;
CREATE POLICY "buyers and sellers view orders" ON public.orders
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR business_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.ticket_receipts receipt
    WHERE receipt.order_id = orders.id AND receipt.owner_id = auth.uid()
  )
);

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
  IF next_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Status must be completed or cancelled';
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
  IF next_status = 'cancelled' AND NULLIF(btrim(cancellation_reason), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A cancellation reason is required';
  END IF;

  UPDATE public.orders
  SET status = next_status,
      completed_at = CASE WHEN next_status = 'completed' THEN now() ELSE completed_at END,
      cancelled_at = CASE WHEN next_status = 'cancelled' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN next_status = 'cancelled' THEN actor_id ELSE cancelled_by END,
      cancellation_reason = CASE WHEN next_status = 'cancelled' THEN btrim(cancellation_reason) ELSE orders.cancellation_reason END,
      updated_at = now()
  WHERE id = target_order_id
  RETURNING * INTO current_order;

  IF next_status = 'completed' THEN
    UPDATE public.ticket_receipts SET is_active = false, redeemed_at = COALESCE(redeemed_at, now()),
      redeemed_by = COALESCE(redeemed_by, actor_id), updated_at = now()
    WHERE order_id = target_order_id AND owner_id = actor_id AND is_active = true;
  ELSIF next_status = 'cancelled' THEN
    UPDATE public.ticket_receipts SET is_active = false, updated_at = now()
    WHERE order_id = target_order_id AND owner_id = actor_id;
  END IF;
  RETURN NEXT current_order;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_business_order(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_business_order(uuid,text,text) TO authenticated, service_role;
