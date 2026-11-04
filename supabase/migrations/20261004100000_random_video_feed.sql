-- Stable random pagination within a session, with RLS preserved.
create or replace function public.random_video_feed(feed_seed text, page_limit integer default 20, page_offset integer default 0)
returns setof public.videos language sql stable security invoker set search_path = public as $$
  select v.* from public.videos v
  order by md5(v.id::text || feed_seed), v.id
  limit least(greatest(page_limit, 1), 100) offset greatest(page_offset, 0);
$$;
grant execute on function public.random_video_feed(text, integer, integer) to anon, authenticated;
