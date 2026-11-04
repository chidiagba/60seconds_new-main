\set ON_ERROR_STOP on
\ir ../supabase/migrations/20261004100000_random_video_feed.sql
begin;
alter table videos add column created_at timestamptz default now();
insert into videos(id,created_at) select gen_random_uuid(),now()-n*interval '90 days' from generate_series(1,40) n;
do $$ declare a uuid[]; b uuid[]; c uuid[]; second_page uuid[]; begin
 select array_agg(id) into a from random_video_feed('open-1',20,0);
 select array_agg(id) into b from random_video_feed('open-1',20,0);
 select array_agg(id) into c from random_video_feed('open-2',20,0);
 select array_agg(id) into second_page from random_video_feed('open-1',20,20);
 if a is distinct from b then raise exception 'Session order is unstable'; end if;
 if a=c then raise exception 'Reopen did not change feed'; end if;
 if a && second_page then raise exception 'Pagination duplicated videos'; end if;
 if not exists(select 1 from videos where id=any(a) and created_at < now()-interval '1 year') then raise exception 'Older videos excluded'; end if;
end $$;
rollback;
