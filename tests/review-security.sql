\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, description text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',description; END IF; END $$;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000001','review-owner@example.test'),('00000000-0000-0000-0000-000000000002','review-other@example.test');
INSERT INTO public.profiles(id,email,user_type,country_code) VALUES('00000000-0000-0000-0000-000000000001','review-owner@example.test','business','NG'),('00000000-0000-0000-0000-000000000002','review-other@example.test','private','NG');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.wallets WHERE user_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002') AND balance=0 AND currency='NGN'),'profiles provision zero-balance wallets in their currency');
-- A code locks after five wrong guesses, is single-use, and is never publicly accessible.
SELECT public.issue_signup_otp('review-owner@example.test','00000000-0000-0000-0000-000000000001','123456');
DO $$ BEGIN FOR i IN 1..5 LOOP PERFORM pg_temp.assert_true(public.consume_signup_otp('review-owner@example.test','000000') IS NULL,'wrong code rejected'); END LOOP; END $$;
SELECT pg_temp.assert_true(public.consume_signup_otp('review-owner@example.test','123456') IS NULL,'locked code cannot be used');
SELECT public.issue_signup_otp('review-owner@example.test','00000000-0000-0000-0000-000000000001','234567');
SELECT pg_temp.assert_true(public.consume_signup_otp('review-owner@example.test','234567')='00000000-0000-0000-0000-000000000001','correct code accepted');
SELECT pg_temp.assert_true(public.consume_signup_otp('review-owner@example.test','234567') IS NULL,'code cannot be replayed');
SELECT pg_temp.assert_true(public.allow_otp_request('rate@example.test','test-ip'),'first request accepted');
SELECT pg_temp.assert_true(NOT public.allow_otp_request('rate@example.test','test-ip'),'immediate resend rate limited');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.consume_signup_otp(text,text)','EXECUTE'),'anon cannot consume codes directly');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.issue_signup_otp(text,uuid,text)','EXECUTE'),'user cannot create their own verification code');
-- Funding replay must not credit a second time; failed currency checks must roll back.
SELECT public.finalize_paystack_wallet_funding('00000000-0000-0000-0000-000000000002','review-ref-1','review-tx-1',100,'NGN');
SELECT public.finalize_paystack_wallet_funding('00000000-0000-0000-0000-000000000002','review-ref-1','review-tx-1',100,'NGN');
SELECT pg_temp.assert_true((SELECT balance=100 FROM public.wallets WHERE user_id='00000000-0000-0000-0000-000000000002'),'replayed funding does not double credit');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.transactions WHERE metadata->>'payment_reference'='review-ref-1'),'one ledger entry per reference');
DO $$ BEGIN
 BEGIN
  PERFORM public.finalize_paystack_wallet_funding('00000000-0000-0000-0000-000000000002','review-ref-bad','review-tx-bad',100,'CHF');
  RAISE EXCEPTION 'FAILED: currency mismatch accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAILED:%' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_true((SELECT balance=100 FROM public.wallets WHERE user_id='00000000-0000-0000-0000-000000000002'),'failed funding leaves balance intact');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.finalize_paystack_wallet_funding(uuid,text,text,numeric,text)','EXECUTE'),'clients cannot settle funds');
-- Canonical settlement creates one owner credit and receipt across verified replays.
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO events(id,user_id,business_id,event_name,start_date,end_date,status,currency) VALUES('20000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Verified event',now()+interval '1 day',now()+interval '2 days','published','NGN');
INSERT INTO products(id,business_id,name,type,price,currency,available_quantity,is_active,event_id) VALUES('10000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000001','Verified product','ticket',100,'NGN',10,true,'20000000-0000-0000-0000-000000000099');
CREATE TEMP TABLE review_checkout AS SELECT * FROM create_order_checkout('[{"productId":"10000000-0000-0000-0000-000000000099","quantity":1}]',null,'review-sale-checkout','paystack','00000000-0000-0000-0000-000000000002');
SELECT finalize_checkout_payment(id,'paystack',payment_reference,104,'NGN','review-sale-tx') FROM review_checkout;
SELECT finalize_checkout_payment(id,'paystack',payment_reference,104,'NGN','review-sale-tx') FROM review_checkout;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM transactions WHERE metadata->>'order_id'=(SELECT id::text FROM review_checkout) AND metadata->>'entry'='owner_credit'),'order replay produces one seller credit');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM ticket_receipts WHERE order_id=(SELECT id FROM review_checkout)),'settlement issues one receipt');
SELECT pg_temp.assert_true((SELECT payment_status='paid' FROM orders WHERE id=(SELECT id FROM review_checkout)),'settlement marks order paid');
SELECT public.finalize_paystack_wallet_funding('00000000-0000-0000-0000-000000000001','review-owner-funding','review-owner-funding-tx',10,'NGN');
SELECT pg_temp.assert_true((SELECT balance=110 FROM wallets WHERE user_id='00000000-0000-0000-0000-000000000001'),'owner wallet keeps both verified proceeds and funding');
-- Ownership enforcement is tested under the real client database role.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.events(id,user_id,event_name,start_date) VALUES('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Owned event',now());
INSERT INTO public.products(id,business_id,name,price,type,available_quantity,event_id) VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Owned product',10,'ticket',5,'20000000-0000-0000-0000-000000000001');
DO $$ BEGIN
 BEGIN
  INSERT INTO public.products(business_id,name,price,type,available_quantity,event_id) VALUES('00000000-0000-0000-0000-000000000002','Forged owner',10,'ticket',5,'20000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FAILED: forged product owner accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.wallets WHERE user_id='00000000-0000-0000-0000-000000000002'),'another user wallet is private');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.wallets','UPDATE'),'clients cannot change wallet balances');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','public.products','INSERT'),'anonymous product writes revoked');
-- Group creation is owner-scoped; knowing a group UUID does not allow joining it.
INSERT INTO public.group_chats(id,name,created_by) VALUES('40000000-0000-0000-0000-000000000001','Private review group','00000000-0000-0000-0000-000000000001');
INSERT INTO public.group_chat_members(group_chat_id,user_id,role) VALUES('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.group_chats WHERE id='40000000-0000-0000-0000-000000000001'),'nonmembers cannot read private groups');
DO $$ BEGIN
 BEGIN
  INSERT INTO public.group_chat_members(group_chat_id,user_id,role) VALUES('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','owner');
  RAISE EXCEPTION 'FAILED: nonmember joined group as owner';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','storage.objects','TRUNCATE'),'anonymous users cannot truncate storage');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','products','TRUNCATE'),'authenticated users cannot bypass RLS with truncate');
RESET ROLE;
ROLLBACK;
