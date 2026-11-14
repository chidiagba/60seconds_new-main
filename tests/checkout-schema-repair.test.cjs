const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('cart resumes checkout through an authenticated RPC instead of PostgREST table discovery', () => {
  const app = fs.readFileSync('app/cart.tsx', 'utf8');
  assert.match(app, /rpc\('get_checkout_attempt'/);
  assert.doesNotMatch(app, /from\('checkout_orders'\)/);
});

test('forward cache migration repairs the empty table, owner reads, RPC and PostgREST cache', () => {
  const sql = fs.readFileSync('supabase/migrations/20261113110000_checkout_schema_cache_repair.sql', 'utf8');
  assert.match(sql, /create table if not exists public\.checkout_orders/);
  assert.match(sql, /alter table public\.checkout_orders enable row level security/);
  assert.match(sql, /user_id=auth\.uid\(\)/);
  assert.match(sql, /create or replace function public\.get_checkout_attempt/);
  assert.match(sql, /c\.user_id=auth\.uid\(\)/);
  assert.match(sql, /notify pgrst, 'reload schema'/i);
});
