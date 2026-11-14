"""Run only after approval of the dedicated read-only production connection.
No service-role keys, Keychain, .env loading, provider calls or mutations.
"""
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote

url = os.environ.get('VOUCHER_AUDIT_DATABASE_URL')
# Dedicated file created only by the explicitly authorized provisioning step.
connection_file=Path('.env.voucher-audit.local')
if not url and connection_file.is_file():
    for line in connection_file.read_text().splitlines():
        if line.startswith('VOUCHER_AUDIT_DATABASE_URL='):
            url=line.split('=',1)[1].strip()
            break
if not url:
    raise SystemExit('Configure the authorized VOUCHER_AUDIT_DATABASE_URL locally; no connection attempted.')
parts = urlsplit(url)
user = unquote(parts.username or '')
if parts.scheme not in ('postgres', 'postgresql') or not parts.hostname:
    raise SystemExit('Expected a PostgreSQL connection URL.')
if 'rvvujgbaswecqohixgog' not in parts.hostname and 'rvvujgbaswecqohixgog' not in user:
    raise SystemExit('Connection does not identify the authorized Supabase project; refusing.')
if user.split('.')[0] in ('postgres', 'supabase_admin', 'service_role'):
    raise SystemExit('Use the dedicated SELECT-only audit login, not an administrator.')
query = parse_qs(parts.query)
if query.get('sslmode', [''])[0] not in ('require', 'verify-ca', 'verify-full'):
    raise SystemExit('An encrypted PostgreSQL connection is required (sslmode=require or stronger).')
env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
env.update(PGHOST=parts.hostname, PGPORT=str(parts.port or 5432), PGUSER=user,
           PGPASSWORD=unquote(parts.password or ''), PGDATABASE=parts.path.lstrip('/') or 'postgres',
           PGSSLMODE=query['sslmode'][0], PGCONNECT_TIMEOUT='10',
           PGOPTIONS='-c default_transaction_read_only=on -c application_name=voucher_readonly_audit')
for name in ('sslrootcert', 'sslcert', 'sslkey'):
    if name in query:
        env['PG' + name.upper()] = query[name][0]
# Check effective writes, ownership and privileged role settings before the audit.
preflight = """BEGIN READ ONLY;
SELECT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls
 OR has_schema_privilege(current_user,'public','CREATE')
 OR has_database_privilege(current_user,current_database(),'CREATE') OR EXISTS (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND
 (pg_has_role(current_user,c.relowner,'USAGE') OR
 has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR EXISTS (
 SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 AND has_column_privilege(current_user,c.oid,a.attnum,'INSERT,UPDATE')))))::text
FROM pg_roles r WHERE r.rolname=current_user; COMMIT;"""
result = subprocess.run(['psql', '-X', '--no-password', '-At', '-v', 'ON_ERROR_STOP=1'],
                        input=preflight, env=env, text=True, capture_output=True)
if result.returncode:
    raise SystemExit('Read-only connection preflight failed; no audit executed. Check approved connection/network grants with the administrator.')
if result.stdout.strip().splitlines() != ['BEGIN', 'false', 'COMMIT']:
    raise SystemExit('Audit login has write/owner/admin capabilities or unexpected preflight output; refusing to use it.')
path = Path('/private/tmp') / ('voucher-production-audit-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.txt')
with path.open('x') as output:
    path.chmod(0o600)
    result = subprocess.run(['psql', '-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-f',
                             'scripts/audit-voucher-production.sql'],env=env,stdout=output,stderr=subprocess.PIPE,text=True)
if result.returncode:
    raise SystemExit(f'Audit failed or was incomplete; do not use it as evidence of absence. Partial private output: {path}')
print(f'Read-only audit completed. Private output: {path}')
print('No payment provider was contacted. No production records were modified.')
