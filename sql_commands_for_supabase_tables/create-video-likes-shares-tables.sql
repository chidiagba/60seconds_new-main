-- ====================================================
-- Video Likes Table (one like per user per video)
-- ====================================================
CREATE TABLE IF NOT EXISTS public.video_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT video_likes_unique_user_video UNIQUE (video_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_video_likes_video_id ON public.video_likes(video_id);
CREATE INDEX IF NOT EXISTS idx_video_likes_user_id ON public.video_likes(user_id);

ALTER TABLE public.video_likes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.video_likes TO authenticated;
GRANT SELECT ON public.video_likes TO anon;

DROP POLICY IF EXISTS "Anyone can read likes" ON public.video_likes;
CREATE POLICY "Anyone can read likes"
ON public.video_likes
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can insert own likes" ON public.video_likes;
CREATE POLICY "Users can insert own likes"
ON public.video_likes
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own likes" ON public.video_likes;
CREATE POLICY "Users can delete own likes"
ON public.video_likes
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ====================================================
-- Video Shares Table
-- ====================================================
CREATE TABLE IF NOT EXISTS public.video_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_shares_video_id ON public.video_shares(video_id);
CREATE INDEX IF NOT EXISTS idx_video_shares_user_id ON public.video_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_video_shares_source ON public.video_shares(source);

ALTER TABLE public.video_shares ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.video_shares TO authenticated;
GRANT SELECT ON public.video_shares TO anon;

DROP POLICY IF EXISTS "Anyone can read shares" ON public.video_shares;
CREATE POLICY "Anyone can read shares"
ON public.video_shares
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can insert own shares" ON public.video_shares;
CREATE POLICY "Users can insert own shares"
ON public.video_shares
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- ====================================================
-- Trigger: keep videos.likes_count in sync
-- ====================================================
CREATE OR REPLACE FUNCTION public.sync_video_likes_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos
    SET likes_count = likes_count + 1
    WHERE id = NEW.video_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos
    SET likes_count = GREATEST(0, likes_count - 1)
    WHERE id = OLD.video_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_video_likes_count ON public.video_likes;
CREATE TRIGGER trg_sync_video_likes_count
AFTER INSERT OR DELETE ON public.video_likes
FOR EACH ROW EXECUTE FUNCTION public.sync_video_likes_count();

-- ====================================================
-- Trigger: keep videos.shares_count in sync
-- ====================================================
CREATE OR REPLACE FUNCTION public.sync_video_shares_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos
    SET shares_count = shares_count + 1
    WHERE id = NEW.video_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_video_shares_count ON public.video_shares;
CREATE TRIGGER trg_sync_video_shares_count
AFTER INSERT ON public.video_shares
FOR EACH ROW EXECUTE FUNCTION public.sync_video_shares_count();

SELECT 'video_likes and video_shares ready' AS result;
