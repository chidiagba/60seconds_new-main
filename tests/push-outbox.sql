-- Additional fixture checks in the isolated acceptance database.
\set ON_ERROR_STOP on
alter table public.profiles add column full_name text,add column username text;
create table public.chats(id uuid primary key,user1_id uuid,user2_id uuid);
create table public.messages(id uuid primary key,chat_id uuid,sender_id uuid);
create table public.follows(follower_id uuid,following_id uuid);
create table public.group_chat_members(id uuid primary key,group_chat_id uuid,user_id uuid);
create table public.group_chat_messages(id uuid primary key,group_chat_id uuid,sender_id uuid);
\ir ../supabase/migrations/20261004120000_push_notifications.sql
begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000021','sender@example.test',now()),('00000000-0000-0000-0000-000000000022','receiver@example.test',now());
insert into profiles(id,user_type,full_name) values ('00000000-0000-0000-0000-000000000021','private','Sender');
insert into chats values ('10000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022');
insert into messages values (gen_random_uuid(),'10000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000021'),(gen_random_uuid(),'10000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000021');
insert into follows values ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022');
insert into group_chat_members values (gen_random_uuid(),'10000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000022'),(gen_random_uuid(),'10000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000021');
insert into group_chat_messages values (gen_random_uuid(),'10000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000021');
do $$ begin
 if (select count(*) from push_outbox where data->>'kind'='message')<>3 then raise exception 'Each direct/group message needs a push'; end if;
 if (select count(*) from push_outbox where data->>'kind'='follower' and data->>'userId'='00000000-0000-0000-0000-000000000021')<>1 then raise exception 'Follower notification missing profile target'; end if;
 if exists(select 1 from push_outbox where user_id='00000000-0000-0000-0000-000000000021') then raise exception 'Sender notified about own action'; end if;
 if exists(select 1 from push_outbox where data->>'kind'='message' and data->>'chatId' is null) then raise exception 'Missing chat target'; end if;
end $$;
rollback;
