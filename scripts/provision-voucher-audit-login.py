"""Provision ONLY the audit login explicitly requested by the user.
Default is a plan; --apply changes audit-role grants/policies, never business rows.
Uses the existing authenticated Supabase CLI; never extracts its token.
"""
import base64
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit, urlunsplit, quote

project='rvvujgbaswecqohixgog'
role='voucher_audit_reader'
tables=['orders','vouchers','payments','ticket_receipts','products','events']
if '--apply' not in sys.argv:
    print('Plan: create a dedicated SELECT-only, non-admin login and role-specific SELECT policies for '+', '.join(tables)+'. No order/payment/voucher rows changed.')
    raise SystemExit(0)
if Path('supabase/.temp/project-ref').read_text().strip()!=project:
    raise SystemExit('Linked project mismatch; refusing.')
output=Path('.env.voucher-audit.local')
if output.exists():
    raise SystemExit('Audit connection file already exists; refusing to rotate or overwrite credentials.')
ignored=subprocess.run(['git','check-ignore','--quiet',str(output)])
if ignored.returncode:
    raise SystemExit('Audit connection file must be gitignored before provisioning.')
pool=urlsplit(Path('supabase/.temp/pooler-url').read_text().strip())
if not pool.hostname or project not in (pool.username or ''):
    raise SystemExit('Verified linked pooler connection settings are unavailable.')
password=secrets.token_urlsafe(36)
salt=secrets.token_bytes(16)
salted=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,4096)
client=hmac.new(salted,b'Client Key',hashlib.sha256).digest()
stored=hashlib.sha256(client).digest()
server=hmac.new(salted,b'Server Key',hashlib.sha256).digest()
b64=lambda value:base64.b64encode(value).decode()
verifier=f'SCRAM-SHA-256$4096:{b64(salt)}${b64(stored)}:{b64(server)}'
login=role+'.'+project
url=urlunsplit(('postgresql',quote(login,safe='')+':'+quote(password,safe='')+'@'+pool.hostname+':'+str(pool.port or 5432),pool.path or '/postgres','sslmode=require',''))
# Save first so even an uncertain API response cannot lose the provisioned login.
fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as file: file.write('VOUCHER_AUDIT_DATABASE_URL='+url+'\n')
statements=["BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';",
 f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '{verifier}';",
 f'GRANT CONNECT ON DATABASE postgres TO {role};',f'GRANT USAGE ON SCHEMA public TO {role};',
 f'ALTER ROLE {role} SET default_transaction_read_only=on;',
 f'GRANT SELECT ON '+','.join('public.'+table for table in tables)+f' TO {role};']
for table in tables:
    statements.append(f'CREATE POLICY voucher_audit_reader_select ON public.{table} FOR SELECT TO {role} USING (true);')
statements.append('COMMIT;')
with tempfile.NamedTemporaryFile('w',dir='/private/tmp',prefix='voucher-audit-provision-',suffix='.sql',delete=False) as file:
    file.write('\n'.join(statements)); sql_path=Path(file.name)
try:
    result=subprocess.run(['supabase','db','query','--linked','--file',str(sql_path),'-o','json'],capture_output=True,text=True)
finally:
    sql_path.unlink(missing_ok=True)
if result.returncode:
    raise SystemExit('Provisioning failed or is uncertain. Private connection file retained; inspect role metadata through the supported CLI before retrying. No password was printed.')
print('Dedicated SELECT-only audit login provisioned. Ignored connection file: .env.voucher-audit.local (mode 0600).')
print('Only audit authentication/grants/policies changed; no business records were modified.')
