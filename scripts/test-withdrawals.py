"""Local-only database assertions and real concurrent reservation attempts."""
import os,subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
url=os.environ['TEST_DATABASE_URL']
from urllib.parse import urlparse
parsed=urlparse(url)
if not (url.startswith('postgresql:///review_') or (parsed.hostname in ('localhost','127.0.0.1') and parsed.path=='/review_test')):raise SystemExit('Requires an isolated local review database')
def sql(query,check=True):
 r=subprocess.run(['psql',url,'-XAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True)
 if check and r.returncode:raise AssertionError(r.stderr)
 return r
sql(Path('tests/withdrawal-security.sql').read_text())
uid='61000000-0000-4000-8000-000000000001';bank='61000000-0000-4000-8000-000000000002'
sql(f"INSERT INTO auth.users(id,email) VALUES('{uid}','parallel-withdrawal@example.test'); INSERT INTO profiles(id,email,country_code) VALUES('{uid}','parallel-withdrawal@example.test','NG'); INSERT INTO wallets(user_id,balance,currency,is_active) VALUES('{uid}',100,'NGN',true) ON CONFLICT(user_id) DO UPDATE SET balance=100; INSERT INTO business_bank_accounts(id,user_id,bank_name,account_holder_name,account_number,country,country_code,currency,payout_provider,is_verified,verification_status,verification_source,paystack_recipient_code) VALUES('{bank}','{uid}','Bank','Owner','1234567890','Nigeria','NG','NGN','paystack',true,'verified','server_v2','RCP_test');")
def reserve(i):return sql(f"SELECT reserve_withdrawal('{uid}',60,'{bank}','paystack','62000000-0000-4000-8000-{i:012d}');",False)
with ThreadPoolExecutor(max_workers=8) as workers: results=list(workers.map(reserve,range(1,9)))
assert sum(r.returncode==0 for r in results)==1,[r.stderr for r in results]
assert sql(f"SELECT balance FROM wallets WHERE user_id='{uid}'").stdout.strip()=='40.00'
assert sql(f"SELECT count(*) FROM withdrawal_holds WHERE user_id='{uid}'").stdout.strip()=='1'
print('Withdrawal SQL assertions passed; 8 concurrent requests produced exactly 1 hold, balance 40.00')
