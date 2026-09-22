Wallet balance before Paystack settlement

The wallet now replays completed sale credits and bank payouts chronologically.
An automatic bank payout is capped at the recorded balance at its effective date,
so missing historical credits do not create a debt against subsequent purchases.
Pending and failed payouts do not reduce the balance. Manual withdrawals retain
their full debit. Existing settlement history remains unchanged.

Release requirements:
- Apply supabase/migrations/20260908120000_preserve_sales_after_historical_settlements.sql
  after the existing owner-ledger migrations. It recalculates existing wallets.
- Deploy paystack-reconcile-subaccount-settlements with its shared helper.
- Build and release the updated mobile app so its local balance calculation agrees.

Validation: node --import tsx scripts/test-owner-wallet-balance.ts

For a verified NGN 1,040 purchase with a NGN 40 platform fee, the existing payment
flow records a NGN 1,000 owner credit. That credit is displayed before bank payout.
A later completed NGN 1,000 settlement reduces it to zero.

This fixes a reproducible calculation defect; the affected production ledger has
not been inspected. The migration and live Paystack flow still require deployment
and integration verification. No live financial records were changed locally.
