-- Run only when schema inspection confirms voucher_redemptions exists.
-- Read-only post-migration/post-repair verification; no mutation or provider call.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT v.id,v.code,v.usage_count,v.usage_limit,count(r.order_id) AS recorded_redemptions
FROM public.vouchers v LEFT JOIN public.voucher_redemptions r ON r.voucher_id=v.id
WHERE upper(trim(v.code))='HJSDGUBY' GROUP BY v.id;
SELECT r.order_id,r.voucher_id,to_jsonb(r)->>'user_id' AS customer,r.redeemed_at,
 o.order_number,o.payment_status,o.status,o.total_amount,o.payment_reference,
 (SELECT count(*) FROM public.ticket_receipts t WHERE t.order_id=o.id) AS tickets,
 (SELECT count(*) FROM public.ticket_receipts t WHERE t.order_id=o.id AND t.buyer_id<>o.user_id) AS wrong_owner
FROM public.voucher_redemptions r JOIN public.orders o ON o.id=r.order_id
WHERE r.voucher_id IN(SELECT id FROM public.vouchers WHERE upper(trim(code))='HJSDGUBY');
COMMIT;
