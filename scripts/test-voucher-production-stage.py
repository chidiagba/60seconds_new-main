"""Production-shaped LOCAL staging upgrade. No production connection or records.
Uses the captured public schema shape/history and synthetic historical fixtures.
"""
import os,subprocess,json,tempfile
from pathlib import Path
url=os.environ.get('TEST_DATABASE_URL')
if not url:raise SystemExit('Set TEST_DATABASE_URL to a dedicated EMPTY LOCAL database')
def sql(statement,allow_error=False):
 result=subprocess.run(['psql',url,'-X','-At','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True)
 if result.returncode and not allow_error:raise AssertionError(result.stderr)
 return result
if sql("select count(*) from information_schema.tables where table_schema='public'").stdout.strip()!='0':raise SystemExit('Refusing nonempty database')
fixture=json.loads(Path('tests/fixtures/voucher-production-schema.json').read_text())
bootstrap=Path('tests/review-bootstrap.sql').read_text()
for role,extra in [('anon',''),('authenticated',''),('service_role',' BYPASSRLS')]:
 bootstrap=bootstrap.replace(f'CREATE ROLE {role}{extra};',f'DO $$ BEGIN CREATE ROLE {role}{extra}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;')
sql(bootstrap)
versions=set(fixture['applied_versions'])
baseline={p.name:p for p in Path('supabase/migrations').glob('*.sql')}
baseline.update({p.name:p for p in Path('tests/fixtures/production-baseline').glob('*.sql')})
for path in sorted(baseline.values(),key=lambda p:p.name):
 if path.name.split('_')[0] in versions:
  if path.name.startswith('20261029140000'):
   # The checked-in core CREATE differs from production's original legacy
   # voucher table. These original fields predate its recorded normalizer.
   sql('alter table vouchers add column if not exists name text;alter table vouchers add column if not exists discount_amount numeric;alter table vouchers add column if not exists min_purchase_amount numeric;alter table vouchers add column if not exists max_discount_amount numeric;')
  sql(path.read_text())
def ident(value):return '"'+value.replace('"','""')+'"'
# Reproduce actual production's legacy table shape rather than trusting the
# current CREATE TABLE IF NOT EXISTS baseline from a clean install.
columns={}
for column in fixture['columns']:columns.setdefault(column['table'],{})[column['column']]=column
for table,expected in columns.items():
 if table=='checkout_orders':continue
 actual=sql(f"select column_name from information_schema.columns where table_schema='public' and table_name='{table}'").stdout.splitlines()
 for column in actual:
  if column not in expected:sql(f'alter table public.{ident(table)} drop column {ident(column)};')
 for name,column in expected.items():
  if name not in actual:
   kind='text[]' if column['type']=='ARRAY' else column['type']
   sql(f'alter table public.{ident(table)} add column {ident(name)} {kind};')
  if column['nullable']=='YES':sql(f'alter table public.{ident(table)} alter column {ident(name)} drop not null;')
sql('alter table vouchers alter column expiry_date type timestamptz using expiry_date::timestamp at time zone \'UTC\';')
# Remove clean-install-only voucher CHECKs; production uses its modern normalizer.
prod_checks={c['name'] for c in fixture['constraints'] if c['table']=='vouchers' and c['definition'].startswith('CHECK')}
for name in sql("select conname from pg_constraint where conrelid='vouchers'::regclass and contype='c'").stdout.splitlines():
 if name not in prod_checks:sql(f'alter table vouchers drop constraint {ident(name)};')
sql('alter table ticket_receipts enable row level security;grant select,insert,update,delete on ticket_receipts to authenticated;')
for policy in fixture['receipt_policies']:
 roles=','.join(ident(role) for role in policy['roles'])
 statement=f"create policy {ident(policy['name'])} on ticket_receipts as {policy['type']} for {policy['cmd']} to {roles}"
 if policy['using']:statement+=' using ('+policy['using']+')'
 if policy['check']:statement+=' with check ('+policy['check']+')'
 sql(statement+';')
# No customer identities from production are copied. Include the same dangerous
# status combination and one legacy zero-count voucher, without correcting it.
sql("""insert into auth.users(id,email) values('c1000000-0000-0000-0000-000000000001','stage-owner@example.test'),('c1000000-0000-0000-0000-000000000002','stage-buyer@example.test');
insert into profiles(id,email,country_code,user_type) values('c1000000-0000-0000-0000-000000000001','stage-owner@example.test','NG','business'),('c1000000-0000-0000-0000-000000000002','stage-buyer@example.test','NG','private');
insert into events(id,user_id,business_id,event_name,start_date,end_date,status,currency) values('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Stage event',now()+interval '1 day',now()+interval '2 days','published','NGN');
insert into products(id,business_id,event_id,name,type,price,currency,available_quantity) values('c3000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','Ticket','ticket',1000,'NGN',100);
insert into vouchers(business_id,code,name,discount_type,discount_value,usage_count,usage_limit,expiry_date) values('c1000000-0000-0000-0000-000000000001','STAGE_FREE','Legacy voucher','percentage',100,0,100,now()+interval '18 days');
insert into orders(user_id,business_id,items,subtotal,total_amount,currency,status,payment_status,payment_method,payment_metadata)
select 'c1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','[{"product_id":"c3000000-0000-0000-0000-000000000001","quantity":1,"type":"ticket","price":1000}]',1000,1040,'NGN','completed','pending','BankTransfer','{"voucher_id":null,"discount_amount":0}' from generate_series(1,22);
insert into ticket_receipts(order_id,order_number,buyer_id,owner_id,product_id,ticket_title,quantity,unit_price,total_price,currency,qr_code_data)
select id,order_number,user_id,business_id,'c3000000-0000-0000-0000-000000000001','Legacy receipt',1,1000,1000,'NGN',gen_random_uuid()::text from orders;
""")
snapshots={table:sql(f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from {table} t").stdout.strip() for table in ['orders','vouchers','ticket_receipts','payments','wallets','products']}
sql('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text);')
for version in versions:sql(f"insert into supabase_migrations.schema_migrations(version) values('{version}')")
with tempfile.TemporaryDirectory(prefix='checkout-release-') as output:
 subprocess.run(['node','scripts/prepare-checkout-release.cjs',output],check=True,capture_output=True)
 release=(Path(output)/'01_checkout_release.sql').read_text()
 rehearsal=(Path(output)/'01_checkout_release_REHEARSAL.sql').read_text()
 sql(rehearsal)
assert sql("select to_regclass('checkout_orders') is null").stdout.strip()=='t'
assert sql("select count(*) from supabase_migrations.schema_migrations where version='20261111080000'").stdout.strip()=='0'
print('Generated release rehearsal rolls back schema and migration history')
failed=sql(release.rsplit('COMMIT;',1)[0]+'select 1/0;commit;',True)
assert failed.returncode and 'division by zero' in failed.stderr,failed.stderr
assert sql("select to_regclass('checkout_orders') is null").stdout.strip()=='t'
print('Production-shaped staging: failed upgrade rolls back all release DDL')
sql(release)
replay=sql(release,True)
assert replay.returncode and 'partially/already applied' in replay.stderr,replay.stderr
print('Generated release applies exact migration history and refuses replay')
for table,before in snapshots.items():
 prior=json.loads(before);current=json.loads(sql(f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from {table} t").stdout.strip())
 assert len(prior)==len(current),(table,'row count changed')
 for old,new in zip(prior,current):assert all(new.get(k)==v for k,v in old.items()),(table,'historical field changed')
print('Bridge + atomic checkout + hardening preserve every existing field and all historical counts, including 22 completed/pending orders')
# Existing production INSERT permissions cannot bypass the new boundary.
result=sql("""begin;set local role authenticated;select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000002',true);
insert into ticket_receipts(order_id,order_number,buyer_id,owner_id,ticket_title,unit_price,total_price,qr_code_data)
select id,order_number,user_id,business_id,'forged',1000,1000,'forged' from orders limit 1;commit;""",True)
assert result.returncode and ('permission denied' in result.stderr or 'row-level security' in result.stderr),result.stderr
print('Actual production permissive receipt policy cannot bypass server-only issuance')
# Quote and paid/free operations execute against TIMESTAMPTZ and legacy aliases.
sql(Path('tests/voucher-checkout.sql').read_text())
print('Canonical checkout regression suite passed on production-shaped staging')
