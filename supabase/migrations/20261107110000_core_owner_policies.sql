-- Canonical owner policies also apply to installations with legacy permissive policies.
DO $$ DECLARE p record; table_name text; BEGIN
  FOR p IN SELECT schemaname,tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN
    ('profiles','videos','events','vouchers','wallets','transactions','payment_methods','orders','payments','chats','messages')
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I',p.policyname,p.schemaname,p.tablename); END LOOP;
  FOREACH table_name IN ARRAY ARRAY['profiles','videos','events','vouchers','wallets','transactions','payment_methods','orders','payments','chats','messages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',table_name);
  END LOOP;
END $$;
GRANT SELECT ON public.profiles,public.videos,public.events,public.vouchers TO anon;
GRANT INSERT, UPDATE, DELETE ON public.profiles,public.videos,public.events,public.vouchers,public.payment_methods,public.chats,public.messages TO authenticated;
CREATE POLICY profiles_read ON public.profiles FOR SELECT USING (true);
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id=auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());
CREATE POLICY videos_read ON public.videos FOR SELECT USING ((is_public AND status='published') OR user_id=auth.uid());
CREATE POLICY videos_insert ON public.videos FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
CREATE POLICY videos_update ON public.videos FOR UPDATE TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY videos_delete ON public.videos FOR DELETE TO authenticated USING (user_id=auth.uid());
CREATE POLICY events_read ON public.events FOR SELECT USING (is_public OR user_id=auth.uid());
CREATE POLICY events_insert ON public.events FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
CREATE POLICY events_update ON public.events FOR UPDATE TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY events_delete ON public.events FOR DELETE TO authenticated USING (user_id=auth.uid());
CREATE POLICY vouchers_read ON public.vouchers FOR SELECT USING (is_active OR business_id=auth.uid());
CREATE POLICY vouchers_insert ON public.vouchers FOR INSERT TO authenticated WITH CHECK (business_id=auth.uid());
CREATE POLICY vouchers_update ON public.vouchers FOR UPDATE TO authenticated USING (business_id=auth.uid()) WITH CHECK (business_id=auth.uid());
CREATE POLICY vouchers_delete ON public.vouchers FOR DELETE TO authenticated USING (business_id=auth.uid());
CREATE POLICY methods_owner ON public.payment_methods FOR ALL TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY wallets_read ON public.wallets FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY transactions_read ON public.transactions FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.wallets w WHERE w.id=wallet_id AND w.user_id=auth.uid()));
CREATE POLICY payments_read ON public.payments FOR SELECT TO authenticated USING (user_id=auth.uid() OR organizer_id=auth.uid());
CREATE POLICY orders_read ON public.orders FOR SELECT TO authenticated USING (user_id=auth.uid() OR business_id=auth.uid());
-- Money movement and settlement fields can only be written by trusted server code.
REVOKE INSERT, UPDATE, DELETE ON public.wallets,public.transactions,public.payments FROM authenticated;
GRANT INSERT ON public.orders TO authenticated;
CREATE POLICY orders_insert ON public.orders FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND payment_status='pending' AND status='pending');
REVOKE UPDATE ON public.orders FROM authenticated;
GRANT UPDATE(notes) ON public.orders TO authenticated;
CREATE POLICY orders_update_notes ON public.orders FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY chats_owner ON public.chats FOR ALL TO authenticated USING (auth.uid() IN (user1_id,user2_id)) WITH CHECK (auth.uid() IN (user1_id,user2_id));
CREATE POLICY messages_read ON public.messages FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.chats c WHERE c.id=chat_id AND auth.uid() IN(c.user1_id,c.user2_id)));
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated WITH CHECK (sender_id=auth.uid() AND EXISTS(SELECT 1 FROM public.chats c WHERE c.id=chat_id AND auth.uid() IN(c.user1_id,c.user2_id)));
CREATE POLICY messages_update ON public.messages FOR UPDATE TO authenticated USING(sender_id=auth.uid()) WITH CHECK(sender_id=auth.uid() AND EXISTS(SELECT 1 FROM public.chats c WHERE c.id=chat_id AND auth.uid() IN(c.user1_id,c.user2_id)));
CREATE POLICY messages_delete ON public.messages FOR DELETE TO authenticated USING(sender_id=auth.uid());
