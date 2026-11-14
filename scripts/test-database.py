"""Rebuild a dedicated EMPTY test database, then run auth/RLS/settlement assertions."""
import os, subprocess
from pathlib import Path
url = os.environ.get('TEST_DATABASE_URL')
if not url:
    raise SystemExit('Set TEST_DATABASE_URL to a dedicated empty PostgreSQL database')
def execute(sql):
    result = subprocess.run(['psql', url, '-v', 'ON_ERROR_STOP=1', '-At'], input=sql, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(result.stderr)
    return result.stdout
count = execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public';").strip()
if count != '0':
    raise SystemExit('Refusing to run: test database must be empty')
bootstrap = Path('tests/review-bootstrap.sql').read_text()
# Supabase roles may already be present in a local installation.
bootstrap = bootstrap.replace('CREATE ROLE anon;', "DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;")
bootstrap = bootstrap.replace('CREATE ROLE authenticated;', "DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;")
bootstrap = bootstrap.replace('CREATE ROLE service_role BYPASSRLS;', "DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;")
execute(bootstrap)
for migration in sorted(Path('supabase/migrations').glob('*.sql')):
    execute(migration.read_text())
print('All ordered migrations rebuilt successfully')
execute(Path('tests/review-security.sql').read_text())
print('OTP, ownership and atomic payment settlement assertions passed')

# Concurrent duplicate deliveries and different references share the same wallet.
from concurrent.futures import ThreadPoolExecutor
execute("INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000003','concurrency@example.test'); INSERT INTO public.profiles(id,email,country_code) VALUES('00000000-0000-0000-0000-000000000003','concurrency@example.test','NG');")
def fund(index):
    reference = 'parallel-' + str(index % 8)
    execute("SELECT public.finalize_paystack_wallet_funding('00000000-0000-0000-0000-000000000003','" + reference + "','" + reference + "',1,'NGN');")
with ThreadPoolExecutor(max_workers=8) as workers:
    list(workers.map(fund, range(32)))
assert execute("SELECT balance FROM wallets WHERE user_id='00000000-0000-0000-0000-000000000003';").strip() == '8.00'
assert execute("SELECT count(*) FROM transactions WHERE metadata->>'payment_reference' LIKE 'parallel-%';").strip() == '8'
print('32 concurrent funding deliveries produced exactly 8 credits')
