create table if not exists public.push_devices (
 token text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 updated_at timestamptz not null default now()
);
alter table public.push_devices enable row level security;
create policy "Manage own push devices" on public.push_devices for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.push_outbox (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null, body text not null, data jsonb not null,
 created_at timestamptz not null default now(), delivered_at timestamptz, claimed_until timestamptz, attempts integer not null default 0
);
alter table public.push_outbox enable row level security;
create or replace function public.enqueue_social_push() returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid; actor uuid; label text; payload jsonb; message_body text;
begin
 if tg_table_name = 'follows' then
   recipient := new.following_id; actor := new.follower_id;
   payload := jsonb_build_object('kind','follower','userId',actor);
   message_body := 'Started following you';
 else
   actor := new.sender_id;
   select case when user1_id = actor then user2_id else user1_id end into recipient from public.chats where id = new.chat_id and actor in (user1_id,user2_id);
   payload := jsonb_build_object('kind','message','chatType','direct','chatId',new.chat_id,'otherUserId',actor);
   message_body := 'You have a new message';
 end if;
 if recipient is null or recipient = actor then return new; end if;
 select coalesce(nullif(full_name,''), nullif(username,''), '60seconds') into label from public.profiles where id=actor;
 insert into public.push_outbox(user_id,title,body,data) values(recipient,coalesce(label,'60seconds'),message_body,payload);
 return new;
end $$;
create trigger enqueue_message_push after insert on public.messages for each row execute function public.enqueue_social_push();
create trigger enqueue_follower_push after insert on public.follows for each row execute function public.enqueue_social_push();

create or replace function public.enqueue_group_push() returns trigger language plpgsql security definer set search_path = public as $$
begin
 insert into public.push_outbox(user_id,title,body,data)
 select user_id,'60seconds','You have a new group message',jsonb_build_object('kind','message','chatType','group','chatId',new.group_chat_id)
 from public.group_chat_members where group_chat_id=new.group_chat_id and user_id <> new.sender_id;
 return new;
end $$;
create trigger enqueue_group_message_push after insert on public.group_chat_messages for each row execute function public.enqueue_group_push();
