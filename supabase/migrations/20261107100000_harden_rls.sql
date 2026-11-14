-- Remove anonymous writes even if a legacy script granted table privileges.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON storage.objects FROM anon;
GRANT SELECT ON storage.objects TO anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public, storage FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;

-- Remove permissive legacy policies: permissive policies combine with OR.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE (schemaname = 'public' AND tablename IN ('products','group_chats','group_chat_members','group_chat_messages'))
       OR (schemaname = 'storage' AND tablename = 'objects' AND cmd <> 'SELECT')
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename); END LOOP;
END $$;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;
CREATE POLICY products_read ON public.products FOR SELECT USING (is_active OR business_id = auth.uid());
CREATE POLICY products_insert ON public.products FOR INSERT TO authenticated WITH CHECK (
  business_id = auth.uid() AND (event_id IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.user_id = auth.uid()))
);
CREATE POLICY products_update ON public.products FOR UPDATE TO authenticated USING (business_id = auth.uid()) WITH CHECK (
  business_id = auth.uid() AND (event_id IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.user_id = auth.uid()))
);
CREATE POLICY products_delete ON public.products FOR DELETE TO authenticated USING (business_id = auth.uid());

CREATE OR REPLACE FUNCTION public.group_chat_is_member(target_group_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT target_user_id = auth.uid() AND EXISTS(SELECT 1 FROM public.group_chat_members m WHERE m.group_chat_id = target_group_id AND m.user_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.group_chat_is_admin(target_group_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT target_user_id = auth.uid() AND EXISTS(SELECT 1 FROM public.group_chat_members m WHERE m.group_chat_id = target_group_id AND m.user_id = auth.uid() AND m.role IN ('owner','admin'));
$$;
REVOKE ALL ON FUNCTION public.group_chat_is_member(uuid,uuid), public.group_chat_is_admin(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_chat_is_member(uuid,uuid), public.group_chat_is_admin(uuid,uuid) TO authenticated;
ALTER TABLE public.group_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_chat_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_chats, public.group_chat_members, public.group_chat_messages TO authenticated;
CREATE POLICY groups_read ON public.group_chats FOR SELECT TO authenticated USING (created_by = auth.uid() OR public.group_chat_is_member(id, auth.uid()));
CREATE POLICY groups_insert ON public.group_chats FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY groups_update ON public.group_chats FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
CREATE POLICY groups_delete ON public.group_chats FOR DELETE TO authenticated USING (created_by = auth.uid());
CREATE POLICY members_read ON public.group_chat_members FOR SELECT TO authenticated USING (public.group_chat_is_member(group_chat_id, auth.uid()) OR EXISTS(SELECT 1 FROM public.group_chats g WHERE g.id = group_chat_id AND g.created_by = auth.uid()));
-- Users cannot join arbitrary groups or promote themselves to administrator.
CREATE POLICY members_insert ON public.group_chat_members FOR INSERT TO authenticated WITH CHECK (EXISTS(SELECT 1 FROM public.group_chats g WHERE g.id = group_chat_id AND g.created_by = auth.uid()));
CREATE POLICY members_delete ON public.group_chat_members FOR DELETE TO authenticated USING (user_id = auth.uid() OR EXISTS(SELECT 1 FROM public.group_chats g WHERE g.id = group_chat_id AND g.created_by = auth.uid()));
-- Self updates are restricted to read timestamps by column grants.
REVOKE UPDATE ON public.group_chat_members FROM authenticated;
GRANT UPDATE(last_read_at) ON public.group_chat_members TO authenticated;
CREATE POLICY members_read_timestamp ON public.group_chat_members FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY messages_read ON public.group_chat_messages FOR SELECT TO authenticated USING (public.group_chat_is_member(group_chat_id, auth.uid()));
CREATE POLICY messages_insert ON public.group_chat_messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid() AND public.group_chat_is_member(group_chat_id, auth.uid()));
CREATE POLICY messages_update ON public.group_chat_messages FOR UPDATE TO authenticated USING (sender_id = auth.uid() AND public.group_chat_is_member(group_chat_id, auth.uid())) WITH CHECK (sender_id = auth.uid() AND public.group_chat_is_member(group_chat_id, auth.uid()));
CREATE POLICY messages_delete ON public.group_chat_messages FOR DELETE TO authenticated USING (sender_id = auth.uid() AND public.group_chat_is_member(group_chat_id, auth.uid()));

-- Supabase sets object owner_id from the verified JWT at upload time.
CREATE POLICY objects_insert_owner ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY objects_update_owner ON storage.objects FOR UPDATE TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY objects_delete_owner ON storage.objects FOR DELETE TO authenticated USING (owner_id = auth.uid()::text);
