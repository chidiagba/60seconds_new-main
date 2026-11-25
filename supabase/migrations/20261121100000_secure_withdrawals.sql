-- Payout destinations and funds are controlled exclusively by trusted server code.
ALTER TABLE public.business_bank_accounts ADD COLUMN IF NOT EXISTS stripe_connected_account_id text;
ALTER TABLE public.business_bank_accounts ADD COLUMN IF NOT EXISTS verification_source text;
-- Existing client-writable verification is untrusted. Reverification is required without deleting account details.
UPDATE public.business_bank_accounts SET is_verified=false,verification_status='pending',verified_at=null
WHERE verification_source IS NULL;
ALTER TABLE public.business_bank_accounts ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='business_bank_accounts' LOOP
 EXECUTE format('DROP POLICY %I ON public.business_bank_accounts',p.policyname); END LOOP;
END $$;
REVOKE ALL ON public.business_bank_accounts FROM anon,authenticated;
GRANT SELECT ON public.business_bank_accounts TO authenticated;
CREATE POLICY bank_owner_read ON public.business_bank_accounts FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT ALL ON public.business_bank_accounts TO service_role;

CREATE TABLE public.withdrawal_holds (
 reference text PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id),
 wallet_id uuid NOT NULL REFERENCES public.wallets(id), transaction_id uuid NOT NULL REFERENCES public.transactions(id),
 bank_account_id uuid NOT NULL, provider text NOT NULL CHECK(provider IN ('paystack','stripe')),
 amount numeric(15,2) NOT NULL CHECK(amount>0), currency text NOT NULL,
 idempotency_key uuid NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','failed','reversed')),
 destination jsonb NOT NULL, provider_data jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key)
);
ALTER TABLE public.withdrawal_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.withdrawal_holds FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.withdrawal_holds TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_withdrawal(p_user uuid,p_amount numeric,p_bank uuid,p_provider text,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.wallets; b public.business_bank_accounts; h public.withdrawal_holds; ref text; tx uuid;
BEGIN
 IF p_provider IS NULL OR p_provider NOT IN ('paystack','stripe') THEN RAISE EXCEPTION 'Invalid provider'; END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_key IS NULL THEN RAISE EXCEPTION 'Invalid withdrawal'; END IF;
 SELECT * INTO w FROM public.wallets WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR NOT coalesce(w.is_active,false) THEN RAISE EXCEPTION 'Wallet unavailable'; END IF;
 SELECT * INTO h FROM public.withdrawal_holds WHERE user_id=p_user AND idempotency_key=p_key;
 IF FOUND THEN
  IF h.amount<>p_amount OR h.bank_account_id<>p_bank OR h.provider<>p_provider THEN RAISE EXCEPTION 'Idempotency conflict'; END IF;
  RETURN to_jsonb(h)||jsonb_build_object('alreadyReserved',true);
 END IF;
 SELECT * INTO b FROM public.business_bank_accounts WHERE id=p_bank AND user_id=p_user AND is_active AND is_verified
 AND verification_status='verified' AND verification_source='server_v2' FOR SHARE;
 IF NOT FOUND OR b.payout_provider<>p_provider THEN RAISE EXCEPTION 'Verified bank account required'; END IF;
 IF w.currency IS NULL OR b.currency IS NULL OR upper(w.currency)<>upper(b.currency) THEN RAISE EXCEPTION 'Wallet currency mismatch'; END IF;
 IF p_provider='paystack' AND (b.country_code IS DISTINCT FROM 'NG' OR upper(b.currency) IS DISTINCT FROM 'NGN' OR coalesce(b.paystack_recipient_code,'')='') THEN RAISE EXCEPTION 'Invalid Paystack destination'; END IF;
 IF p_provider='stripe' AND (coalesce(b.stripe_connected_account_id,'')='' OR coalesce(b.stripe_external_account_id,'')='') THEN RAISE EXCEPTION 'Invalid Stripe destination'; END IF;
 IF upper(w.currency) IN ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF') AND p_amount<>trunc(p_amount) THEN RAISE EXCEPTION 'Invalid currency precision'; END IF;
 IF w.balance IS NULL OR w.balance<p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
 INSERT INTO public.withdrawal_requests(id,user_id,amount,business_bank_account_id,status) VALUES(p_key,p_user,p_amount,p_bank,'processing');
 ref:='wd_'||replace(gen_random_uuid()::text,'-','');
 UPDATE public.wallets SET balance=balance-p_amount,updated_at=now() WHERE id=w.id;
 INSERT INTO public.transactions(wallet_id,amount,type,status,description,transaction_fee,metadata)
 VALUES(w.id,p_amount,'withdrawal','pending','Withdrawal (held)',0,jsonb_build_object('entry','owner_withdrawal','reference',ref,'payout_provider',p_provider,'currency',w.currency)) RETURNING id INTO tx;
 INSERT INTO public.withdrawal_holds(reference,user_id,wallet_id,transaction_id,bank_account_id,provider,amount,currency,idempotency_key,destination)
 VALUES(ref,p_user,w.id,tx,b.id,p_provider,p_amount,w.currency,p_key,jsonb_build_object('recipient',b.paystack_recipient_code,'connected_account',b.stripe_connected_account_id,'external_account',b.stripe_external_account_id)) RETURNING * INTO h;
 RETURN to_jsonb(h)||jsonb_build_object('alreadyReserved',false);
END $$;

CREATE OR REPLACE FUNCTION public.finish_withdrawal(p_reference text,p_state text,p_data jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h public.withdrawal_holds;
BEGIN
 -- Always lock wallet before hold/ledger rows, matching reservation and recalculation.
 PERFORM 1 FROM public.wallets WHERE id=(SELECT wallet_id FROM public.withdrawal_holds WHERE reference=p_reference) FOR UPDATE;
 SELECT * INTO h FROM public.withdrawal_holds WHERE reference=p_reference FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_state NOT IN ('pending','completed','failed','reversed') THEN RAISE EXCEPTION 'Invalid withdrawal state'; END IF;
 IF h.state IN ('failed','reversed') OR (h.state='completed' AND p_state<>'reversed') THEN RETURN; END IF;
 IF p_state IN ('failed','reversed') THEN
  UPDATE public.wallets SET balance=balance+h.amount,updated_at=now() WHERE id=h.wallet_id;
 END IF;
 UPDATE public.withdrawal_requests SET status=CASE WHEN p_state='reversed' THEN 'failed' WHEN p_state='pending' THEN 'processing' ELSE p_state END,processed_at=CASE WHEN p_state='pending' THEN NULL ELSE now() END,updated_at=now() WHERE id=h.idempotency_key AND user_id=h.user_id;
 UPDATE public.withdrawal_holds SET state=p_state,provider_data=provider_data||p_data,updated_at=now() WHERE reference=p_reference;
 UPDATE public.transactions SET status=CASE WHEN p_state='reversed' THEN 'failed' ELSE p_state END,
 metadata=metadata||p_data||jsonb_build_object('withdrawal_state',p_state),updated_at=now() WHERE id=h.transaction_id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_withdrawal(uuid,numeric,uuid,text,uuid),public.finish_withdrawal(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_withdrawal(uuid,numeric,uuid,text,uuid),public.finish_withdrawal(text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.recalculate_owner_wallet_balance(target_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx record;
  running_balance numeric := 0;
BEGIN
  -- Serialize recalculations for this wallet.
  PERFORM 1 FROM public.wallets WHERE id = target_wallet_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE wallet_id = target_wallet_id AND metadata->>'entry' = 'owner_credit'
  ) THEN RETURN; END IF;

  FOR tx IN
    SELECT amount, type, metadata->>'entry' AS entry
    FROM public.transactions
    WHERE wallet_id = target_wallet_id
      AND (lower(trim(status::text)) IN ('completed', 'success', 'successful', 'paid') OR (status='pending' AND metadata->>'entry'='owner_withdrawal'))
    ORDER BY CASE WHEN metadata->>'entry' = 'paystack_bank_settlement'
      THEN COALESCE(NULLIF(metadata->>'settlement_date', '')::timestamptz, created_at)
      ELSE created_at END,
      CASE WHEN metadata->>'entry' = 'paystack_bank_settlement' THEN 1 ELSE 0 END,
      id
  LOOP
    IF tx.entry IN ('owner_credit', 'wallet_funding') THEN
      running_balance := running_balance + GREATEST(0, round(tx.amount::numeric, 2));
    ELSIF tx.entry = 'paystack_bank_settlement' THEN
      running_balance := GREATEST(0, running_balance - abs(round(tx.amount::numeric, 2)));
    ELSIF tx.entry = 'owner_withdrawal' OR tx.type = 'withdrawal' THEN
      running_balance := running_balance - abs(round(tx.amount::numeric, 2));
    END IF;
  END LOOP;
  UPDATE public.wallets SET balance = GREATEST(0, running_balance), updated_at = now()
  WHERE id = target_wallet_id;
END;
$$;



NOTIFY pgrst, 'reload schema';

REVOKE INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES ON public.withdrawal_requests FROM anon,authenticated;

-- Table revokes alone do not remove pre-existing column grants.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('business_bank_accounts','withdrawal_requests') LOOP
 EXECUTE format('REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM anon,authenticated',c.column_name,c.column_name,c.column_name,c.table_name);
 END LOOP;
END $$;
