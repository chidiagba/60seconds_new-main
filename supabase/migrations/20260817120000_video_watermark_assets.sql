alter table public.videos
  add column if not exists watermarked_video_url text,
  add column if not exists watermark_status text not null default 'pending';

alter table public.videos drop constraint if exists videos_watermark_status_check;
alter table public.videos add constraint videos_watermark_status_check
  check (watermark_status in ('pending', 'processing', 'ready', 'failed'));
