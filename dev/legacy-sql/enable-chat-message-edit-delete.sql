-- Enable edit/delete support for direct chat messages and group chat messages.
-- Run this in Supabase SQL Editor after deploying the app changes.

ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Senders can update direct messages" ON public.messages;
CREATE POLICY "Senders can update direct messages" ON public.messages
  FOR UPDATE USING (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1
      FROM public.chats chat
      WHERE chat.id = chat_id
        AND (chat.user1_id = auth.uid() OR chat.user2_id = auth.uid())
    )
  ) WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1
      FROM public.chats chat
      WHERE chat.id = chat_id
        AND (chat.user1_id = auth.uid() OR chat.user2_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Senders can delete direct messages" ON public.messages;
CREATE POLICY "Senders can delete direct messages" ON public.messages
  FOR DELETE USING (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1
      FROM public.chats chat
      WHERE chat.id = chat_id
        AND (chat.user1_id = auth.uid() OR chat.user2_id = auth.uid())
    )
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