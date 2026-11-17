-- Add the missing device registry without replaying historical social triggers.
create table if not exists public.push_devices (
 token text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 updated_at timestamptz not null default now()
);
alter table public.push_devices enable row level security;
drop policy if exists "Manage own push devices" on public.push_devices;
create policy "Manage own push devices" on public.push_devices for all to authenticated
 using (user_id=auth.uid()) with check (user_id=auth.uid());
revoke all on public.push_devices from anon;
grant select,insert,update,delete on public.push_devices to authenticated;
grant all on public.push_devices, public.push_outbox to service_role;
notify pgrst, 'reload schema';
