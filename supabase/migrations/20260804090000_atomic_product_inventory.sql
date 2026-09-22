-- Reconcile stock against issued receipts while holding a row lock. Receipts
-- are the durable proof of a paid sale, making this safe to retry and safe when
-- two payment callbacks arrive concurrently.
CREATE OR REPLACE FUNCTION public.reconcile_product_inventory(target_product_id uuid)
RETURNS TABLE (available_quantity integer, sold_quantity integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_product public.products%ROWTYPE;
  receipt_quantity integer;
  missing_sales integer;
BEGIN
  SELECT * INTO current_product
  FROM public.products
  WHERE id = target_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not exist', target_product_id;
  END IF;

  SELECT COALESCE(SUM(GREATEST(quantity, 1)), 0)::integer
  INTO receipt_quantity
  FROM public.ticket_receipts
  WHERE product_id = target_product_id;

  missing_sales := GREATEST(0, receipt_quantity - COALESCE(current_product.sold_quantity, 0));

  RETURN QUERY
  UPDATE public.products
  SET available_quantity = GREATEST(0, products.available_quantity - missing_sales),
      sold_quantity = COALESCE(products.sold_quantity, 0) + missing_sales,
      updated_at = now()
  WHERE products.id = target_product_id
  RETURNING products.available_quantity, products.sold_quantity;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_product_inventory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_product_inventory(uuid) TO authenticated, service_role;
