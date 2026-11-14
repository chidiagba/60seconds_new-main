BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='3s';
SELECT jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),'audited_at',now(),
 'target_orders',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',o.id,'order_number',o.order_number,'user_id',o.user_id,'business_id',o.business_id,'created_at',o.created_at,
 'status',o.status,'payment_status',o.payment_status,'currency',o.currency,'total_amount',o.total_amount,'subtotal',o.subtotal,'platform_fee',o.platform_fee,
 'items',o.items,'provider',o.payment_provider,'method',o.payment_method,'payment_reference',o.payment_reference,'transaction_id',o.payment_transaction_id,
 'voucher_id',to_jsonb(o)->>'voucher_id','discount_amount',to_jsonb(o)->>'discount_amount',
 'voucher_in_notes',substring(o.notes from 'Voucher applied: ([^[:space:]]+)'),
 'saved_voucher_id',o.payment_metadata->>'voucher_id','saved_voucher_code',o.payment_metadata->>'voucher_code',
 'saved_discount',o.payment_metadata->>'discount_amount','saved_markup',o.payment_metadata->>'markup_amount',
 'saved_original_subtotal',o.payment_metadata->>'original_subtotal','saved_total',o.payment_metadata->>'total_amount',
 'metadata_keys',(select jsonb_agg(key) from jsonb_object_keys(coalesce(o.payment_metadata,'{}')) key)
 )), '[]') from public.orders o where regexp_replace(o.order_number,'[^0-9]','','g') ~ '^0*19$'),
 'target_vouchers',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.vouchers v where upper(trim(v.code))='HJSDGUBY'),
 'target_payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'order_id',p.order_id,'user_id',p.user_id,'organizer_id',p.organizer_id,
 'provider',p.payment_provider,'reference',p.provider_reference,'gateway_reference',p.gateway_reference,'transaction_id',p.transaction_id,
 'status',p.status,'provider_status',p.provider_status,'amount',p.amount,'currency',p.currency,'fee',p.processing_fee,'net',p.net_amount,'created_at',p.created_at,'completed_at',p.completed_at,'paid_at',p.paid_at)), '[]')
 from public.payments p where p.order_id in(select id from public.orders where regexp_replace(order_number,'[^0-9]','','g') ~ '^0*19$')),
 'target_receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'order_id',r.order_id,'buyer_id',r.buyer_id,'owner_id',r.owner_id,'product_id',r.product_id,'event_id',r.event_id,'quantity',r.quantity,'is_active',r.is_active,'issued_at',r.issued_at,'redeemed_at',r.redeemed_at)), '[]') from public.ticket_receipts r where r.order_id in(select id from public.orders where regexp_replace(order_number,'[^0-9]','','g') ~ '^0*19$')),
 'current_products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'business_id',p.business_id,'event_id',p.event_id,'name',p.name,'type',p.type,'price',p.price,'currency',p.currency,'available',p.available_quantity,'sold',p.sold_quantity,'active',p.is_active,'event_status',e.status,'start_date',e.start_date,'end_date',e.end_date)), '[]') from public.products p left join public.events e on e.id=p.event_id where p.id::text in(select i->>'product_id' from public.orders o cross join lateral jsonb_array_elements(o.items) i where regexp_replace(o.order_number,'[^0-9]','','g') ~ '^0*19$')),
 'redemption_table_exists',to_regclass('public.voucher_redemptions') is not null,
 'all_orders',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'number',o.order_number,'status',o.status,'payment_status',o.payment_status,'amount',o.total_amount,'currency',o.currency,'created_at',o.created_at,
 'has_reference',nullif(o.payment_reference,'') is not null,'method',o.payment_method,
 'associated_voucher',coalesce(to_jsonb(o)->>'voucher_id',o.payment_metadata->>'voucher_id',substring(o.notes from 'Voucher applied: ([^[:space:]]+)')),
 'receipt_count',(select count(*) from public.ticket_receipts r where r.order_id=o.id),
 'wrong_ticket_owner',(select count(*) from public.ticket_receipts r where r.order_id=o.id and r.buyer_id<>o.user_id),
 'completed_payments',(select count(*) from public.payments p where p.order_id=o.id and p.status='completed')) order by o.created_at), '[]') from public.orders o),
 'all_voucher_counts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'used',usage_count,'limit',usage_limit)),'[]') from public.vouchers),
 'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'type',permissive,'roles',roles,'cmd',cmd,'using',qual,'check',with_check)) from pg_policies where schemaname='public' and tablename in('orders','vouchers','payments','ticket_receipts','products','events')),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid))) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('orders','vouchers','payments','ticket_receipts','products','events'))
) AS audit;
COMMIT;
