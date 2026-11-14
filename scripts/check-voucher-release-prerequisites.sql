-- Read-only gate BEFORE any approved voucher migration. No deployment performed.
-- This gate checks prerequisites; it does not certify legacy endpoints or RLS.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
DO $$
DECLARE item record; missing text[]:=array[]::text[];
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('voucher_redemptions','order_id'),('voucher_redemptions','voucher_id'),
 ('push_outbox','user_id'),('push_outbox','title'),('push_outbox','body'),('push_outbox','data'),
 ('orders','voucher_id'),('orders','discount_amount'),('orders','payment_metadata'),('orders','subtotal'),
 ('vouchers','discount_type'),('vouchers','discount_value'),('vouchers','min_purchase_amount'),
 ('vouchers','max_discount_amount'),('vouchers','minimum_order_amount'),('vouchers','maximum_discount_amount'),
 ('vouchers','currency'),('vouchers','applicable_products'),('vouchers','applicable_categories'),
 ('payments','provider_reference'),('payments','organizer_id'),('payments','paid_at'),
 ('wallets','user_id'),('wallets','currency'),('wallets','balance'),
 ('transactions','wallet_id'),('transactions','metadata'),('transactions','transaction_fee'),
 ('ticket_receipts','receipt_kind'),('ticket_receipts','is_active')
 ) AS required(table_name,column_name) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
   AND c.relname=item.table_name AND a.attname=item.column_name AND NOT a.attisdropped) THEN
   missing:=array_append(missing,item.table_name||'.'||item.column_name);
  END IF;
 END LOOP;
 IF cardinality(missing)>0 THEN RAISE EXCEPTION 'Voucher release blocked: missing prerequisites %',array_to_string(missing,', '); END IF;
END $$;
COMMIT;
