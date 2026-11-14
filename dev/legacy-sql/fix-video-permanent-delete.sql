BEGIN;

ALTER TABLE IF EXISTS public.videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to delete their own videos" ON public.videos;
CREATE POLICY "Allow users to delete their own videos"
ON public.videos
FOR DELETE
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.delete_video_permanently(target_video_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  deleted_count integer := 0;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated to delete videos';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.videos
    WHERE id = target_video_id
      AND user_id = current_user_id
  ) THEN
    RETURN false;
  END IF;

  IF to_regclass('public.video_comments') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.video_comments WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.video_ratings') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.video_ratings WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.video_likes') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.video_likes WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.video_shares') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.video_shares WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.user_hidden_videos') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.user_hidden_videos WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.video_interactions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.video_interactions WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.events') IS NOT NULL THEN
    EXECUTE 'UPDATE public.events SET video_id = NULL WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.orders') IS NOT NULL THEN
    EXECUTE 'UPDATE public.orders SET video_id = NULL WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.reservations') IS NOT NULL THEN
    EXECUTE 'UPDATE public.reservations SET video_id = NULL WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.ticket_receipts') IS NOT NULL THEN
    EXECUTE 'UPDATE public.ticket_receipts SET video_id = NULL WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.event_attendees') IS NOT NULL THEN
    EXECUTE 'UPDATE public.event_attendees SET video_id = NULL WHERE video_id = $1'
    USING target_video_id;
  END IF;

  IF to_regclass('public.group_chat_messages') IS NOT NULL THEN
    EXECUTE 'UPDATE public.group_chat_messages SET video_id = NULL WHERE video_id = $1'
    USING target_video_id;
  END IF;

  DELETE FROM public.videos
  WHERE id = target_video_id
    AND user_id = current_user_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_video_permanently(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_video_permanently(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_video_permanently(uuid) TO service_role;

COMMIT;