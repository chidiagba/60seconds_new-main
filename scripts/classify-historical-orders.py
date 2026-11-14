"""Classify the existing approved snapshot, without any production connection."""
import argparse,json,os
from collections import Counter
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--snapshot',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
snapshot=json.loads(Path(args.snapshot).read_text())['rows'][0]['audit']
rows=[]
for order in snapshot['all_orders']:
 if order['status']!='completed' or order['payment_status']!='pending':continue
 method=str(order['method']).lower()
 kind='manual_seed_label' if method=='manual-seed' else 'bank_transfer_evidence_missing' if method=='banktransfer' else 'provider_reference_missing' if method in ('paystack','twint','stripepayment') else 'legacy_card_or_wallet_method_unverified'
 rows.append({**order,'classification':kind,'financial_outcome':'UNKNOWN','payment_evidence':'No provider reference and no completed payment row in audited snapshot','receipt_evidence':'Receipt exists; buyer matches order' if order['receipt_count'] and not order['wrong_ticket_owner'] else 'Needs ownership review','code_finding':'Legacy makePayment simulated success and could create completed orders without verified settlement; this is a possible mechanism, not proof of this order history','action':'Obtain provider/bank/wallet evidence; no automatic correction','production_modified':False})
result={'source_audited_at':snapshot['audited_at'],'read_only':True,'count':len(rows),'counts_by_classification':dict(Counter(r['classification'] for r in rows)),'orders':rows}
output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as target:json.dump(result,target,indent=2)
print(json.dumps({'orders_classified':len(rows),'counts':result['counts_by_classification'],'production_modified':False}))
