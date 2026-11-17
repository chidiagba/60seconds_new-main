-- Read-only discovery: no relationship embeds and no exposure of booking/customer rows.
create or replace function public.public_deals_events(page_size integer default 60, page_offset integer default 0)
returns jsonb language sql stable security definer set search_path = public
as $$
  with eligible as (
    select e.*, offers.product_count, inventory.table_count
    from public.events e
    cross join lateral (
      select count(*)::integer as product_count from public.products p
      where p.event_id = e.id and p.is_active and p.available_quantity > 0 and p.price > 0
    ) offers
    cross join lateral (
      select count(*)::integer as table_count from public.event_tables t
      where t.event_id = e.id and t.is_active and t.seat_price > 0
        and t.seats - coalesce((select sum(b.seats) from public.event_table_bookings b
          where b.table_id = t.id and b.state in ('held', 'confirmed')), 0)
          >= case when t.whole_table then t.seats else 1 end
    ) inventory
    where e.is_public and e.status in ('open', 'published')
      and coalesce(e.end_date, e.start_date) > now()
      and (offers.product_count > 0 or inventory.table_count > 0)
  ), page as (
    select * from eligible order by created_at desc, id
    limit least(greatest(page_size, 1), 100) + 1 offset greatest(page_offset, 0)
  ), visible as (
    select * from page order by created_at desc, id limit least(greatest(page_size, 1), 100)
  )
  select jsonb_build_object(
    'hasMore', (select count(*) from page) > least(greatest(page_size, 1), 100),
    'events', coalesce((select jsonb_agg((select jsonb_object_agg(field.key, field.value)
      from jsonb_each(to_jsonb(e)) field where field.key = any(array[
        'id','user_id','creator_id','event_name','description','start_date','end_date',
        'location_name','location_city','location_latitude','location_longitude',
        'max_attendees','current_attendees','ticket_price','currency','image_url',
        'category','hashtags','video_id','business_id','is_public','requires_approval',
        'status','created_at','updated_at','product_count','table_count'
      ])) || jsonb_build_object(
      'has_products', e.product_count > 0, 'has_tables', e.table_count > 0,
      'video', (select jsonb_build_object('id', v.id, 'title', v.title, 'thumbnail_url', v.thumbnail_url, 'video_url', v.video_url)
        from public.videos v where v.id = e.video_id),
      'creator', (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
        from public.profiles p where p.id = coalesce(e.creator_id, e.user_id))
    ) order by e.created_at desc, e.id) from visible e), '[]'::jsonb)
  );
$$;
revoke all on function public.public_deals_events(integer, integer) from public, anon, authenticated;
grant execute on function public.public_deals_events(integer, integer) to service_role;
