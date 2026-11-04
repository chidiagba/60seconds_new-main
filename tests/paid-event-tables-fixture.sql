-- Minimal schema for an EMPTY disposable PostgreSQL database only.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table profiles(id uuid primary key,user_type text);
create table events(id uuid primary key default gen_random_uuid(),business_id uuid,user_id uuid,video_id uuid,is_public boolean default true,status text default 'published',event_name text,start_date timestamptz,end_date timestamptz,currency text,image_url text,location_name text);
create table products(id uuid primary key default gen_random_uuid(),event_id uuid,is_active boolean default true,name text,price numeric,currency text,available_quantity integer,sold_quantity integer default 0,type text);
create table orders(id uuid primary key default gen_random_uuid(),order_number text default gen_random_uuid()::text,user_id uuid not null,business_id uuid,event_id uuid,video_id uuid,items jsonb,subtotal numeric,total_amount numeric,currency text,status text,payment_status text,payment_method text,payment_reference text);
create table ticket_receipts(id uuid primary key default gen_random_uuid(),order_id uuid,order_number text,buyer_id uuid not null,owner_id uuid,event_id uuid,video_id uuid,product_id uuid,ticket_type text,receipt_kind text,ticket_title text,quantity integer,unit_price numeric,total_price numeric,currency text,qr_code_data text,ticket_image_url text,event_name text,event_start_date timestamptz,event_end_date timestamptz,location_name text);
create table table_reservations(id uuid);
grant usage on schema public,auth to authenticated,anon,service_role;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated,anon,service_role;
\ir ../supabase/migrations/20261004130000_guest_event_checkout.sql
\ir ../supabase/migrations/20261014100000_paid_event_tables.sql
