-- Atomic media edits, including adding the first video to a flyer-only event.
create or replace function public.save_event_media(event_key uuid, image_url_value text, video_url_value text, thumbnail_url_value text default null, duration_value numeric default null)
returns public.events language plpgsql security definer set search_path = public as $$
declare e public.events%rowtype; video_key uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and user_type='business') then
   raise exception 'Only business accounts can edit event media';
 end if;
 select * into e from public.events where id=event_key for update;
 if not found or (e.user_id is distinct from auth.uid() and e.business_id is distinct from auth.uid()) then
   raise exception 'You can only edit your own events';
 end if;
 image_url_value := nullif(trim(image_url_value),'');
 video_url_value := nullif(trim(video_url_value),'');
 if image_url_value is null and video_url_value is null then raise exception 'Keep an event image or video'; end if;
 if (image_url_value is not null and image_url_value !~ '^https://') or (video_url_value is not null and video_url_value !~ '^https://') then raise exception 'Upload media before saving'; end if;
 if duration_value is not null and (duration_value <= 0 or duration_value > 60) then raise exception 'Videos must be between 1 and 60 seconds'; end if;
 if video_url_value is not null then
   video_key := e.video_id;
   if video_key is null then
     insert into public.videos(user_id,business_id,title,event_name,description,video_url,thumbnail_url,duration,event_date,location_name,location_city,status)
     values(auth.uid(),auth.uid(),e.event_name,e.event_name,e.description,video_url_value,coalesce(image_url_value,thumbnail_url_value),duration_value,e.start_date,e.location_name,e.location_city,'published') returning id into video_key;
   else
     update public.videos set video_url=video_url_value, thumbnail_url=coalesce(image_url_value,thumbnail_url_value,thumbnail_url),
       duration=coalesce(duration_value,duration),
       watermarked_video_url=case when video_url is distinct from video_url_value then null else watermarked_video_url end
     where id=video_key and user_id=auth.uid();
     if not found then raise exception 'You can only replace your own video'; end if;
   end if;
 end if;
 update public.events set image_url=image_url_value, video_id=video_key, updated_at=now() where id=e.id returning * into e;
 return e;
end $$;
revoke all on function public.save_event_media(uuid,text,text,text,numeric) from public;
grant execute on function public.save_event_media(uuid,text,text,text,numeric) to authenticated;
