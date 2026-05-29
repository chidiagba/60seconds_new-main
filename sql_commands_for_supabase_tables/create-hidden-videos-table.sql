-- ==============================================
-- CREATE HIDDEN VIDEOS TABLE FOR USER PREFERENCES
-- ==============================================
-- This table stores which videos each user has hidden.
-- When a non-owner user hides a video, it's recorded here.
-- This ensures the video stays hidden across devices for that user.

CREATE TABLE IF NOT EXISTS user_hidden_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  hidden_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, video_id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_hidden_videos_user_id ON user_hidden_videos(user_id);
CREATE INDEX IF NOT EXISTS idx_hidden_videos_video_id ON user_hidden_videos(video_id);

-- ==============================================
-- ROW LEVEL SECURITY (RLS)
-- ==============================================
-- Enable RLS on the hidden videos table
ALTER TABLE user_hidden_videos ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own hidden videos
CREATE POLICY "Users can view own hidden videos" 
  ON user_hidden_videos FOR SELECT 
  USING (auth.uid() = user_id);

-- Policy: Users can only insert their own hidden records
CREATE POLICY "Users can hide videos for themselves" 
  ON user_hidden_videos FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only delete their own hidden records
CREATE POLICY "Users can unhide videos" 
  ON user_hidden_videos FOR DELETE 
  USING (auth.uid() = user_id);

-- Policy: Users can update their own records (if unhiding is an update operation)
CREATE POLICY "Users can update own hidden records" 
  ON user_hidden_videos FOR UPDATE 
  USING (auth.uid() = user_id);

-- ==============================================
-- GRANTS
-- ==============================================
-- Allow authenticated users to access their own records
GRANT ALL ON user_hidden_videos TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
