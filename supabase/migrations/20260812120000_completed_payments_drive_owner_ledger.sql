-- Some successful gateway callbacks recorded public.payments but failed before
-- updating the order/issuing a receipt. Treat a completed payment as payment
-- authority and drive the same idempotent order-ledger trigger.

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
    SET status = 'completed', updated_at = COALESCE(NEW.completed_at, NEW.updated_at, now())
    WHERE id = NEW.order_id
      AND lower(COALESCE(status::text, '')) NOT IN
        ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved');

    -- Also touch an already-completed order so its ledger metadata is enriched
    -- if the payment row arrived after the order status callback.
    IF NOT FOUND THEN
      UPDATE public.orders SET updated_at = now() WHERE id = NEW.order_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  -- Older production projects may not have a payments table; Paystack
  -- reconciliation remains the authoritative fallback in that environment.
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS payments_ensure_owner_order_ledger ON public.payments';
    EXECUTE 'CREATE TRIGGER payments_ensure_owner_order_ledger
      AFTER INSERT OR UPDATE ON public.payments
      FOR EACH ROW EXECUTE FUNCTION public.completed_payment_ensures_order_ledger()';
    EXECUTE $repair$
      UPDATE public.orders o
      SET status = 'completed', updated_at = COALESCE(p.completed_at, p.updated_at, now())
      FROM public.payments p
      WHERE p.order_id = o.id
        AND lower(COALESCE(p.status::text, '')) IN
          ('paid', 'completed', 'success', 'successful', 'succeeded', 'captured', 'approved')
    $repair$;
  END IF;
END $$;
