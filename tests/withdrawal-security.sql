BEGIN;
INSERT INTO auth.users(id,email) VALUES('60000000-0000-4000-8000-000000000001','withdrawal@example.test');
INSERT INTO public.profiles(id,email,country_code) VALUES('60000000-0000-4000-8000-000000000001','withdrawal@example.test','NG');
INSERT INTO public.wallets(user_id,balance,currency,is_active) VALUES('60000000-0000-4000-8000-000000000001',100,'NGN',true) ON CONFLICT(user_id) DO UPDATE SET balance=100;
INSERT INTO public.business_bank_accounts(id,user_id,bank_name,account_holder_name,account_number,country,country_code,currency,payout_provider,is_verified,verification_status,verification_source,paystack_recipient_code)
VALUES('60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','Bank','Owner','1234567890','Nigeria','NG','NGN','paystack',true,'verified','server_v2','RCP_test');
DO $$ DECLARE h jsonb; h2 jsonb; b numeric; ref text; BEGIN
 IF has_function_privilege('authenticated','public.reserve_withdrawal(uuid,numeric,uuid,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Client can reserve'; END IF;
 IF has_table_privilege('authenticated','public.business_bank_accounts','INSERT') OR has_table_privilege('authenticated','public.business_bank_accounts','UPDATE') THEN RAISE EXCEPTION 'Client can verify bank'; END IF;
 BEGIN
  PERFORM public.reserve_withdrawal('60000000-0000-4000-8000-000000000001',101,'60000000-0000-4000-8000-000000000002','paystack','60000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'Overdraft permitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Insufficient balance' THEN RAISE; END IF; END;
 UPDATE public.business_bank_accounts SET is_verified=false WHERE id='60000000-0000-4000-8000-000000000002';
 BEGIN
  PERFORM public.reserve_withdrawal('60000000-0000-4000-8000-000000000001',60,'60000000-0000-4000-8000-000000000002','paystack','60000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'Unverified destination permitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Verified bank account required' THEN RAISE; END IF; END;
 UPDATE public.business_bank_accounts SET is_verified=true WHERE id='60000000-0000-4000-8000-000000000002';
 h:=public.reserve_withdrawal('60000000-0000-4000-8000-000000000001',60,'60000000-0000-4000-8000-000000000002','paystack','60000000-0000-4000-8000-000000000003');
 h2:=public.reserve_withdrawal('60000000-0000-4000-8000-000000000001',60,'60000000-0000-4000-8000-000000000002','paystack','60000000-0000-4000-8000-000000000003');
 IF h->>'reference'<>h2->>'reference' OR NOT (h2->>'alreadyReserved')::boolean THEN RAISE EXCEPTION 'Replay changed reference'; END IF;
 SELECT balance INTO b FROM public.wallets WHERE user_id='60000000-0000-4000-8000-000000000001';
 IF b<>40 THEN RAISE EXCEPTION 'Hold not debited'; END IF;
 ref:=h->>'reference';
 PERFORM public.finish_withdrawal(ref,'completed');
 PERFORM public.finish_withdrawal(ref,'pending'); -- delayed event cannot undo completion
 PERFORM public.finish_withdrawal(ref,'reversed');
 PERFORM public.finish_withdrawal(ref,'reversed');
 SELECT balance INTO b FROM public.wallets WHERE user_id='60000000-0000-4000-8000-000000000001';
 IF b<>100 THEN RAISE EXCEPTION 'Reversal not idempotent'; END IF;
 -- Trigger recalculation must continue subtracting held withdrawals.
 INSERT INTO public.transactions(wallet_id,amount,type,status,description,metadata)
 SELECT id,100,'deposit','completed','Test sale','{"entry":"owner_credit"}' FROM public.wallets WHERE user_id='60000000-0000-4000-8000-000000000001';
 h:=public.reserve_withdrawal('60000000-0000-4000-8000-000000000001',60,'60000000-0000-4000-8000-000000000002','paystack','60000000-0000-4000-8000-000000000004');
 PERFORM public.recalculate_owner_wallet_balance((h->>'wallet_id')::uuid);
 SELECT balance INTO b FROM public.wallets WHERE user_id='60000000-0000-4000-8000-000000000001';
 IF b<>40 THEN RAISE EXCEPTION 'Recalculation undid hold: %',b; END IF;
 PERFORM public.finish_withdrawal(h->>'reference','failed');
 PERFORM public.finish_withdrawal(h->>'reference','failed');
 SELECT balance INTO b FROM public.wallets WHERE user_id='60000000-0000-4000-8000-000000000001';
 IF b<>100 THEN RAISE EXCEPTION 'Failure release not idempotent'; END IF;
END $$;
ROLLBACK;
