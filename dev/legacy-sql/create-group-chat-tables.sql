-- Group chat tables and RLS policies
-- Run this in Supabase SQL Editor before testing multi-device group chat.

CREATE TABLE IF NOT EXISTS public.group_chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  avatar_color TEXT NOT NULL DEFAULT '#6366F1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_chat_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_chat_id UUID NOT NULL REFERENCES public.group_chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.group_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_chat_id UUID NOT NULL REFERENCES public.group_chats(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'video', 'event')),
  text TEXT,
  video_id UUID REFERENCES public.videos(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT group_chat_messages_payload_check CHECK (
    (message_type = 'text' AND NULLIF(BTRIM(COALESCE(text, '')), '') IS NOT NULL AND video_id IS NULL AND event_id IS NULL) OR
    (message_type = 'video' AND video_id IS NOT NULL AND event_id IS NULL) OR
    (message_type = 'event' AND event_id IS NOT NULL AND video_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_group_chat_members_user_id ON public.group_chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_chat_members_group_id ON public.group_chat_members(group_chat_id);
CREATE INDEX IF NOT EXISTS idx_group_chat_messages_group_id_created_at ON public.group_chat_messages(group_chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_chats_updated_at ON public.group_chats(updated_at DESC);

CREATE OR REPLACE FUNCTION public.group_chat_is_member(target_group_id UUID, target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_chat_members member
    WHERE member.group_chat_id = target_group_id
      AND member.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.group_chat_is_admin(target_group_id UUID, target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_chat_members member
    WHERE member.group_chat_id = target_group_id
      AND member.user_id = target_user_id
      AND member.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.touch_group_chat_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.group_chats
  SET updated_at = NOW()
  WHERE id = NEW.group_chat_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_touch_group_chat_from_message ON public.group_chat_messages;
CREATE TRIGGER trigger_touch_group_chat_from_message
AFTER INSERT ON public.group_chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_group_chat_from_message();

ALTER TABLE public.group_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_chat_messages ENABLE ROW LEVEL SECURITY;

-- Ensure Supabase client roles can access these tables (RLS still restricts rows).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_chats TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_chat_members TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_chat_messages TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.group_chat_is_member(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.group_chat_is_admin(UUID, UUID) TO anon, authenticated, service_role;

-- Ensure realtime subscriptions deliver inserts/updates for groups, members, and messages.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chats;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_chat_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chat_members;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chat_messages;
  END IF;
END
$$;

DROP POLICY IF EXISTS "Group members can read group chats" ON public.group_chats;
CREATE POLICY "Group members can read group chats" ON public.group_chats
  FOR SELECT USING (public.group_chat_is_member(id, auth.uid()));

DROP POLICY IF EXISTS "Creators can read group chats" ON public.group_chats;
CREATE POLICY "Creators can read group chats" ON public.group_chats
  FOR SELECT USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can create group chats" ON public.group_chats;
CREATE POLICY "Users can create group chats" ON public.group_chats
  FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Admins can update group chats" ON public.group_chats;
CREATE POLICY "Admins can update group chats" ON public.group_chats
  FOR UPDATE USING (public.group_chat_is_admin(id, auth.uid()));

DROP POLICY IF EXISTS "Owners can delete group chats" ON public.group_chats;
CREATE POLICY "Owners can delete group chats" ON public.group_chats
  FOR DELETE USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Group members can read memberships" ON public.group_chat_members;
CREATE POLICY "Group members can read memberships" ON public.group_chat_members
  FOR SELECT USING (public.group_chat_is_member(group_chat_id, auth.uid()));

DROP POLICY IF EXISTS "Admins can add memberships" ON public.group_chat_members;
CREATE POLICY "Admins can add memberships" ON public.group_chat_members
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1
      FROM public.group_chats chat
      WHERE chat.id = group_chat_id
        AND chat.created_by = auth.uid()
    ) OR
    public.group_chat_is_admin(group_chat_id, auth.uid())
  );

DROP POLICY IF EXISTS "Members can update their read timestamp" ON public.group_chat_members;
CREATE POLICY "Members can update their read timestamp" ON public.group_chat_members
  FOR UPDATE USING (
    auth.uid() = user_id OR public.group_chat_is_admin(group_chat_id, auth.uid())
  ) WITH CHECK (
    auth.uid() = user_id OR public.group_chat_is_admin(group_chat_id, auth.uid())
  );

DROP POLICY IF EXISTS "Admins can remove memberships" ON public.group_chat_members;
CREATE POLICY "Admins can remove memberships" ON public.group_chat_members
  FOR DELETE USING (public.group_chat_is_admin(group_chat_id, auth.uid()));

-- Allow any member to delete their own row (leave the group).
DROP POLICY IF EXISTS "Members can leave group" ON public.group_chat_members;
CREATE POLICY "Members can leave group" ON public.group_chat_members
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Group members can read messages" ON public.group_chat_messages;
CREATE POLICY "Group members can read messages" ON public.group_chat_messages
  FOR SELECT USING (public.group_chat_is_member(group_chat_id, auth.uid()));

DROP POLICY IF EXISTS "Members can insert messages" ON public.group_chat_messages;
CREATE POLICY "Members can insert messages" ON public.group_chat_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND public.group_chat_is_member(group_chat_id, auth.uid())
  );

DROP POLICY IF EXISTS "Members can update own messages" ON public.group_chat_messages;
CREATE POLICY "Members can update own messages" ON public.group_chat_messages
  FOR UPDATE USING (
    auth.uid() = sender_id AND public.group_chat_is_member(group_chat_id, auth.uid())
  ) WITH CHECK (
    auth.uid() = sender_id AND public.group_chat_is_member(group_chat_id, auth.uid())
  );

DROP POLICY IF EXISTS "Members can delete own messages" ON public.group_chat_messages;
CREATE POLICY "Members can delete own messages" ON public.group_chat_messages
  FOR DELETE USING (
    auth.uid() = sender_id AND public.group_chat_is_member(group_chat_id, auth.uid())
  );
