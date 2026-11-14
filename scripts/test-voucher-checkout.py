"""Exercise the real checkout RPCs, including concurrent PostgreSQL sessions.
Run only against a disposable database rebuilt by scripts/test-database.py.
"""
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

url = os.environ.get('TEST_DATABASE_URL')
if not url:
    raise SystemExit('Set TEST_DATABASE_URL to a disposable migrated database')

def sql(statement, allow_error=False):
    result = subprocess.run(['psql', url, '-X', '-At', '-v', 'ON_ERROR_STOP=1'],
                            input=statement, text=True, capture_output=True)
    if result.returncode and not allow_error:
        raise AssertionError(result.stderr)
    return result

sql(Path('tests/voucher-checkout.sql').read_text())
print('Transactional voucher eligibility, fulfillment, payment replay and failure tests passed')
fixture = Path('tests/voucher-checkout.sql').read_text().split('do $$ declare q')[0]
fixture = fixture.replace('a1000000', 'b1000000').replace('a2000000', 'b2000000').replace('a3000000', 'b3000000')
fixture = fixture.replace('voucher-owner@', 'parallel-owner@').replace('voucher-buyer@', 'parallel-buyer@').replace('other-buyer@', 'parallel-other@')
fixture = fixture.replace('HJSDGUBY', 'PARALLEL_FREE').replace("'HALF'", "'PARALLEL_HALF'").replace("100,100,'NGN'", "100,1,'NGN'")
sql(fixture + 'commit;')
items = "'[{\"productId\":\"b3000000-0000-0000-0000-000000000001\",\"quantity\":1}]'::jsonb"
buyer = "'b1000000-0000-0000-0000-000000000002'::uuid"
def checkout(index):
    return sql("begin; select set_config('request.jwt.claim.role','service_role',true); select (create_order_checkout(" + items + ",'PARALLEL_FREE','parallel-final-'||'" + str(index) + "','paystack'," + buyer + ")).id; commit;", True)
with ThreadPoolExecutor(max_workers=8) as workers:
    results = list(workers.map(checkout, range(16)))
assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
assert all(r.returncode == 0 or 'Voucher usage limit reached' in r.stderr for r in results)
assert sql("select usage_count from vouchers where code='PARALLEL_FREE'").stdout.strip() == '1'
assert sql("select count(*) from ticket_receipts where product_id='b3000000-0000-0000-0000-000000000001'").stdout.strip() == '1'
assert sql("select available_quantity from products where id='b3000000-0000-0000-0000-000000000001'").stdout.strip() == '99'
print('16 concurrent attempts for the final voucher slot produced exactly one order, redemption and ticket')
# Separate last-stock race without a voucher: a pending gateway checkout holds
# the final unit, and unsuccessful contenders must not create partial orders.
sql("update products set available_quantity=1 where id='b3000000-0000-0000-0000-000000000001'")
def stock_checkout(index):
    return sql("begin; select set_config('request.jwt.claim.role','service_role',true); select (create_order_checkout(" + items + ",null,'parallel-stock-'||'" + str(index) + "','stripe'," + buyer + ")).id; commit;", True)
with ThreadPoolExecutor(max_workers=8) as workers:
    results = list(workers.map(stock_checkout, range(16)))
assert sum(r.returncode == 0 for r in results) == 1
assert sql("select available_quantity from products where id='b3000000-0000-0000-0000-000000000001'").stdout.strip() == '0'
assert sql("select count(*) from checkout_orders where request_key like 'parallel-stock-%'").stdout.strip() == '1'
print('16 concurrent attempts for the final stock unit produced exactly one reservation')
