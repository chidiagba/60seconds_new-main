# Supabase checkout deployment — 16 November 2026

The missing Supabase checkout infrastructure has been deployed successfully to
**60Seconds**, project `rvvujgbaswecqohixgog`. The previously reported missing-RPC
and missing-table blocker is resolved. This report supersedes the earlier
"no production migrations applied" status.

## Database release

Applied and recorded exactly these migrations, without an unrestricted db push:

- `20261111080000_voucher_production_bridge.sql`
- `20261111090000_atomic_voucher_checkout.sql`
- `20261111100000_verified_fulfillment_boundaries.sql`
- `20261113100000_secure_event_table_checkin.sql`
- `20261113110000_checkout_schema_cache_repair.sql`
- `20261116110000_checkout_push_delivery.sql` (new device registry/RLS only)

`get_checkout_attempt`, `quote_order_checkout`, and `create_order_checkout` are now
present and visible through PostgREST. `checkout_orders`, `checkout_payment_evidence`,
`voucher_redemptions`, `push_outbox`, and `push_devices` are present. PostgREST cache
reload was requested in the migration transaction. Existing campaign migrations
`20261113130000` and `20261113190000` were already recorded and were not replayed.

The exact checkout transaction first passed a live ROLLBACK rehearsal, with a
separate catalog check confirming zero checkout versions persisted. It then committed
successfully. Short lock/statement timeouts bounded the operation. During the
transaction, temporary snapshots plus assertions verified that every historical row
and field in orders, vouchers, receipts, payments, wallets, transactions, products,
and events was preserved. Snapshot counts were 48 orders, 18 payments, 42 receipts,
and 7 vouchers. Historical orders were not marked paid, refunded, or repaired.

A completed physical backup was verified at **12:40 PKT on 16 November 2026**.
PITR is not enabled. Current schema functions/policies/constraints and the previous
11 deployed checkout-handler sources were saved privately before deployment.
No restore or destructive rollback was performed.

## Deployed functions

All functions below are ACTIVE. Authentication metadata was checked after deployment.

| Function | Version | Authentication |
|---|---|---|
| paystack-create-order-checkout | 17 → 19 | JWT |
| paystack-initialize | 24 → 26 | JWT |
| paystack-verify | 20 → 22 | JWT |
| paystack-webhook-settlement | 35 → 37 | Handler signature/worker authentication |
| stripe-create-checkout | 61 → 63 | JWT |
| stripe-create-payment-sheet | 15 → 17 | JWT |
| stripe-confirm-and-settle | 23 → 25 | JWT |
| settle-external-order-payment | 31 → 33 | JWT |
| checkout-reconcile | new → 2 | JWT |
| guest-event | 20 → 22 | Handler signature/worker authentication |
| guest-checkout-webhook | 15 → 17 | Handler signature/worker authentication |
| guest-checkout-reconcile | 18 → 20 | Handler signature/worker authentication |
| deliver-push | new → 1 | Handler signature/worker authentication |

Provider webhook handlers verify signatures. The guest endpoint authenticates its
protected actions, while workers use server-only bearer secrets. JWT settings were
not globally disabled. The retired Stripe payment-sheet endpoint intentionally
returns HTTP 426 to legacy requests.

## Receipt delivery and workers

- Added the missing device-registration table with owner-only RLS and explicit
  authenticated registration grants. Anonymous reads are denied; clients have no
  TRUNCATE or TRIGGER privileges. Cross-user reads, registration and deletion were
  tested using a rollback-only production transaction.
- Configured a newly generated `PUSH_WORKER_SECRET` server-side, stored the scheduler
  copy in Supabase Vault, and deployed `deliver-push`.
- Guest reconciliation remains active every five minutes.
- Receipt push delivery is active every two minutes under job
  `60seconds-checkout-push-delivery`.
- Verified anonymous/authenticated clients cannot SELECT decrypted Vault secrets.
- Unauthenticated push-worker invocation returned 401. Authenticated invocation of
  the confirmed empty queue returned 200 with delivered=0; no notification was sent
  by this acceptance check.

## Verification evidence

- Production schema/security assertions pass, including private checkout RLS,
  service-only settlement, server-only receipt writes, and RPC execution privileges.
- Authenticated read-only recovery RPC returned no attempt for an unknown key.
- Server quote against an eligible live product returned NGN 1,000 original price,
  NGN 40 markup, NGN 1,040 payable, one item. No order or payment was created.
- **17 HTTP checks passed**: the three RPCs are discovered and deny anonymous access;
  protected checkout/guest actions reject missing user authentication; the retired
  endpoint rejects old requests; unsigned Stripe/Paystack webhooks are rejected;
  guest and push workers reject missing worker authentication; push worker accepts
  its configured credential on an empty queue.
- All ordered migrations, now including the new push migration, rebuilt successfully
  in a fresh local database. OTP/ownership/atomic settlement assertions passed;
  32 concurrent funding deliveries yielded exactly eight credits.
- Earlier unchanged application checks: 194 Node tests, TypeScript and source lint
  passed; Android debug build was installed and the cart rendered on the connected
  Samsung SM-A075F. Working-source secret scan passed again after deployment.

Evidence is under `build/checkout-verification/production-deployment/`, with HTTP
results and version metadata in `build/checkout-verification/`. Source hashes are
in `build/checkout-release/deployment-source-hashes.json`. The push-device migration
is provided as repository source; the scheduler credential and deployment access token are
in private gitignored local files, not application code. Secret-bearing setup SQL
was removed after applying it. No token values appear in this report.

## Remaining acceptance and external setup

The Supabase infrastructure blocker is resolved. A complete successful payment,
provider callback replay and receipt issuance still need controlled acceptance
using the configured providers. No real-money purchase was performed. Confirm
that the Stripe webhook subscription includes `payment_intent.succeeded` and
`payment_intent.canceled` for canonical PaymentSheet settlement in addition to its
existing guest-session events; external provider dashboard configuration was not
verified by the Supabase deployment.

Android push delivery still requires Firebase/FCM configuration in the native app;
there were zero registered devices at verification. Adding Supabase tables/workers
does not supply those Firebase credentials. App Store/Play distribution and a new
signed store release were not performed. These are not missing checkout RPCs and
must not be described as resolved by this deployment alone.

For recovery, retain the checkout and evidence tables. Pause new checkout creation
and forward-fix if acceptance fails; do not restore old unverified settlement paths
or replay historical migrations. A physical backup restore would need separate
incident approval and reconciliation of changes since the backup.
