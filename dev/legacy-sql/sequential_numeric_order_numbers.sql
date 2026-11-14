-- Sequential order references requested by the order-management UI.
-- The supplied example (0000001) contains seven digits, so this migration
-- uses a seven-character, digits-only display value.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START WITH 1 INCREMENT BY 1;

-- Move every existing value out of the way before assigning the new sequence,
-- preserving chronological order for historical orders.
UPDATE public.orders
SET order_number = 'MIG-' || id::text;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at NULLS FIRST, id) AS number
  FROM public.orders
)
UPDATE public.orders AS orders
SET order_number = lpad(numbered.number::text, 7, '0')
FROM numbered
WHERE orders.id = numbered.id;

SELECT setval(
  'public.order_number_seq',
  GREATEST((SELECT count(*) FROM public.orders), 1),
  EXISTS (SELECT 1 FROM public.orders)
);

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_number bigint;
BEGIN
  next_number := nextval('public.order_number_seq');
  IF next_number > 9999999 THEN
    RAISE EXCEPTION 'Order number sequence exhausted';
  END IF;
  RETURN lpad(next_number::text, 7, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_order_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
    NEW.order_number := public.generate_order_number();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_order_number ON public.orders;
CREATE TRIGGER trigger_set_order_number
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.set_order_number();

-- Keep already-issued ticket/product receipts aligned with their parent order.
UPDATE public.ticket_receipts AS receipt
SET order_number = orders.order_number
FROM public.orders AS orders
WHERE receipt.order_id = orders.id
  AND receipt.order_number IS DISTINCT FROM orders.order_number;

COMMIT;
