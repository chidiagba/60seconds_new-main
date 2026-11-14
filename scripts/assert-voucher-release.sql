-- Read-only postcondition gate after all three release migrations; no repairs.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
DO $$
BEGIN
 IF to_regclass('public.checkout_orders') IS NULL OR to_regclass('public.checkout_payment_evidence') IS NULL OR to_regclass('public.voucher_redemptions') IS NULL THEN RAISE EXCEPTION 'Missing private checkout state';END IF;
 IF has_function_privilege('authenticated','public.finalize_checkout_payment(uuid,text,text,numeric,text,text)','EXECUTE') OR has_function_privilege('authenticated','public.settle_verified_guest_payment(uuid,text,text,numeric,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Client has financial settlement privilege';END IF;
 IF NOT has_function_privilege('service_role','public.finalize_checkout_payment(uuid,text,text,numeric,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Missing server settlement grant';END IF;
 IF has_table_privilege('authenticated','public.ticket_receipts','INSERT') OR has_table_privilege('authenticated','public.ticket_receipts','UPDATE') OR has_table_privilege('authenticated','public.ticket_receipts','DELETE') THEN RAISE EXCEPTION 'Client retains receipt writes';END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='ticket_receipts' AND permissive='RESTRICTIVE' AND policyname IN('receipts_server_insert_only','receipts_server_update_only','receipts_server_delete_only'))<>3 THEN RAISE EXCEPTION 'Missing restrictive receipt policies';END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'D' AND tgname IN('guard_verified_order_transition','guard_verified_receipt'))<>2 THEN RAISE EXCEPTION 'Verified fulfillment triggers disabled/missing';END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN('public.checkout_orders'::regclass,'public.checkout_payment_evidence'::regclass,'public.voucher_redemptions'::regclass) AND NOT relrowsecurity) THEN RAISE EXCEPTION 'Private checkout RLS disabled';END IF;
END $$;
SELECT status,payment_status,count(*) FROM public.orders GROUP BY status,payment_status ORDER BY status,payment_status;
COMMIT;
