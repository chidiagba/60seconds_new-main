-- ====================================================
-- Video Comments Table
-- ====================================================
CREATE TABLE IF NOT EXISTS public.video_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.video_comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) > 0 AND char_length(text) <= 2000),
  likes_count INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_comments_video_id ON public.video_comments(video_id);
CREATE INDEX IF NOT EXISTS idx_video_comments_user_id ON public.video_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_video_comments_parent_id ON public.video_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_video_comments_created_at ON public.video_comments(created_at DESC);

ALTER TABLE public.video_comments ENABLE ROW LEVEL SECURITY;

-- Grant table-level access (required in addition to RLS policies)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_comments TO authenticated;
GRANT SELECT ON public.video_comments TO anon;

DROP POLICY IF EXISTS "Anyone can read visible comments" ON public.video_comments;
CREATE POLICY "Anyone can read visible comments"
ON public.video_comments
FOR SELECT
TO authenticated
USING (is_hidden = false);

DROP POLICY IF EXISTS "Users can insert own comments" ON public.video_comments;
CREATE POLICY "Users can insert own comments"
ON public.video_comments
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own comments" ON public.video_comments;
CREATE POLICY "Users can update own comments"
ON public.video_comments
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own comments" ON public.video_comments;
CREATE POLICY "Users can delete own comments"
ON public.video_comments
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Video owner can hide/unhide any comment on their videos
DROP POLICY IF EXISTS "Video owner can hide comments" ON public.video_comments;
CREATE POLICY "Video owner can hide comments"
ON public.video_comments
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.videos
    WHERE videos.id = video_comments.video_id
      AND videos.user_id = auth.uid()
  )
);

-- ====================================================
-- Video Ratings Table (one rating per user per video)
-- ====================================================
CREATE TABLE IF NOT EXISTS public.video_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT video_ratings_unique_user_video UNIQUE (video_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_video_ratings_video_id ON public.video_ratings(video_id);
CREATE INDEX IF NOT EXISTS idx_video_ratings_user_id ON public.video_ratings(user_id);

ALTER TABLE public.video_ratings ENABLE ROW LEVEL SECURITY;

-- Grant table-level access (required in addition to RLS policies)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_ratings TO authenticated;
GRANT SELECT ON public.video_ratings TO anon;

DROP POLICY IF EXISTS "Anyone can read visible ratings" ON public.video_ratings;
CREATE POLICY "Anyone can read visible ratings"
ON public.video_ratings
FOR SELECT
TO authenticated
USING (is_hidden = false);

DROP POLICY IF EXISTS "Users can insert own rating" ON public.video_ratings;
CREATE POLICY "Users can insert own rating"
ON public.video_ratings
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own rating" ON public.video_ratings;
CREATE POLICY "Users can update own rating"
ON public.video_ratings
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own rating" ON public.video_ratings;
CREATE POLICY "Users can delete own rating"
ON public.video_ratings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Video owner can hide ratings
DROP POLICY IF EXISTS "Video owner can hide ratings" ON public.video_ratings;
CREATE POLICY "Video owner can hide ratings"
ON public.video_ratings
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.videos
    WHERE videos.id = video_ratings.video_id
      AND videos.user_id = auth.uid()
  )
);

-- ====================================================
-- Trigger: keep videos.comments_count in sync
-- ====================================================
CREATE OR REPLACE FUNCTION public.sync_video_comments_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos
    SET comments_count = comments_count + 1
    WHERE id = NEW.video_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos
    SET comments_count = GREATEST(0, comments_count - 1)
    WHERE id = OLD.video_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_comments_count ON public.video_comments;
CREATE TRIGGER trg_sync_comments_count
AFTER INSERT OR DELETE ON public.video_comments
FOR EACH ROW EXECUTE FUNCTION public.sync_video_comments_count();

-- ====================================================
-- Trigger: keep videos.rating / rating_count in sync
-- ====================================================
CREATE OR REPLACE FUNCTION public.sync_video_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.videos
  SET
    rating_count = sub.cnt,
    rating = CASE WHEN sub.cnt = 0 THEN 0 ELSE ROUND(sub.avg_rating::numeric, 1) END
  FROM (
    SELECT COUNT(*) AS cnt, COALESCE(AVG(rating), 0) AS avg_rating
    FROM public.video_ratings
    WHERE video_id = COALESCE(NEW.video_id, OLD.video_id)
      AND is_hidden = false
  ) sub
  WHERE id = COALESCE(NEW.video_id, OLD.video_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_video_rating ON public.video_ratings;
CREATE TRIGGER trg_sync_video_rating
AFTER INSERT OR UPDATE OR DELETE ON public.video_ratings
FOR EACH ROW EXECUTE FUNCTION public.sync_video_rating();
