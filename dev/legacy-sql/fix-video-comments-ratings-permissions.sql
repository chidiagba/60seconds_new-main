-- ================================================================
-- Fix permissions for video_comments, video_ratings, video_likes and video_shares tables
-- Run this in Supabase SQL editor if you get "permission denied"
-- ================================================================

-- Grant table-level access to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_ratings  TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.video_likes TO authenticated;
GRANT SELECT, INSERT ON public.video_shares TO authenticated;

-- Allow anon role to read visible comments/ratings (public feed)
GRANT SELECT ON public.video_comments TO anon;
GRANT SELECT ON public.video_ratings  TO anon;
GRANT SELECT ON public.video_likes TO anon;
GRANT SELECT ON public.video_shares TO anon;

-- ── Re-create RLS policies cleanly ──────────────────────────────

ALTER TABLE public.video_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_ratings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_shares ENABLE ROW LEVEL SECURITY;

-- video_comments policies
DROP POLICY IF EXISTS "Anyone can read visible comments"   ON public.video_comments;
DROP POLICY IF EXISTS "Users can insert own comments"      ON public.video_comments;
DROP POLICY IF EXISTS "Users can update own comments"      ON public.video_comments;
DROP POLICY IF EXISTS "Users can delete own comments"      ON public.video_comments;
DROP POLICY IF EXISTS "Video owner can hide comments"      ON public.video_comments;

CREATE POLICY "Anyone can read visible comments"
  ON public.video_comments FOR SELECT
  USING (is_hidden = false);

CREATE POLICY "Users can insert own comments"
  ON public.video_comments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own comments"
  ON public.video_comments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments"
  ON public.video_comments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Video owner can hide comments"
  ON public.video_comments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.videos
      WHERE videos.id = video_comments.video_id
        AND videos.user_id = auth.uid()
    )
  );

-- video_ratings policies
DROP POLICY IF EXISTS "Anyone can read visible ratings" ON public.video_ratings;
DROP POLICY IF EXISTS "Users can insert own rating"     ON public.video_ratings;
DROP POLICY IF EXISTS "Users can update own rating"     ON public.video_ratings;
DROP POLICY IF EXISTS "Users can delete own rating"     ON public.video_ratings;
DROP POLICY IF EXISTS "Video owner can hide ratings"    ON public.video_ratings;

CREATE POLICY "Anyone can read visible ratings"
  ON public.video_ratings FOR SELECT
  USING (is_hidden = false);

CREATE POLICY "Users can insert own rating"
  ON public.video_ratings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rating"
  ON public.video_ratings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own rating"
  ON public.video_ratings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Video owner can hide ratings"
  ON public.video_ratings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.videos
      WHERE videos.id = video_ratings.video_id
        AND videos.user_id = auth.uid()
    )
  );

-- video_likes policies
DROP POLICY IF EXISTS "Anyone can read likes" ON public.video_likes;
DROP POLICY IF EXISTS "Users can insert own likes" ON public.video_likes;
DROP POLICY IF EXISTS "Users can delete own likes" ON public.video_likes;

CREATE POLICY "Anyone can read likes"
  ON public.video_likes FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own likes"
  ON public.video_likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own likes"
  ON public.video_likes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- video_shares policies
DROP POLICY IF EXISTS "Anyone can read shares" ON public.video_shares;
DROP POLICY IF EXISTS "Users can insert own shares" ON public.video_shares;

CREATE POLICY "Anyone can read shares"
  ON public.video_shares FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own shares"
  ON public.video_shares FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

SELECT 'Permissions fixed for video comments, ratings, likes and shares' AS result;
