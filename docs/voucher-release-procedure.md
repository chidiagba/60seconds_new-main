# Voucher release procedure — prepared, not executed

## Release gates and staging/device matrix

Use a clean reviewed commit that includes the voucher source plus approved baseline fixes. Run Node tests, audit-runner unit tests, TypeScript, lint and secret scanning. Install Deno and type-check each changed Edge entry point in its runtime, resolving imports in an approved environment. Repeat production-shaped upgrade and real SQL boundary/concurrency tests in an empty local/staging database. Do not use a production URL for destructive test bootstrap.

On hosted staging with test-mode provider credentials, install signed Android and iOS builds. Record platform/device/build, test account, synthetic order/voucher, provider reference, webhook delivery and database assertions for every row below. Each platform currently has status **NOT RUN**.

| Scenario | Required result |
|---|---|
| 100% voucher, NGN 1,000 + 40 | No provider launch; persisted total 0, voucher method/reference, paid/open; exactly one owned ticket; usage 0/100→1/100 |
| Partial voucher Paystack | Server total including fee/discount matches actual verified charge; pending has no ticket; verified success atomically creates one ticket/redemption/ledger/payment |
| Partial voucher Stripe | Same assertions using PaymentSheet and signed success webhook; verify connected destination/fee when configured |
| Callback replay / app restart / double tap | Same order/reference; no extra charge, payment row, ticket, stock decrement, ledger credit or usage increment |
| 403, timeout, malformed success, wrong amount/currency/ref/user | No paid transition, receipt or usage; retain unresolved hold until definitive outcome |
| Cancellation / failed provider transaction | No fulfillment; release only after verified definitive cancellation/failure; replay harmless |
| Missing/stale voucher selection / changed cart | Revalidate or explicit error; never silently charge undiscounted amount; resume existing stored checkout correctly |
| Customer account / organizer counter / history | Customer sees only owned ticket and unique QR; order status/payment status/reference/fee/discount agree with DB on focus/resume and realtime refresh |
| QR redemption / refund | Authorized organizer only; one-time redemption and partial/full status correct; refunded receipt inactive; no voucher counter duplication |
| Final voucher/stock slot races | One successful reservation/redemption; rejected contenders have no payment/receipt leakage |
| Retired client endpoints / direct receipt write | 426/409 or DB rejection; no fake paid state or tickets |

Reconcile all assertions across orders, checkout_orders, checkout_payment_evidence, payments, voucher_redemptions, vouchers, ticket_receipts, inventory and transactions. Do not use HJSDGUBY or historical #19 as a smoke-test purchase. Real-money production smoke requires explicit authorization.

## 1. Production schema migration

Only after deployment approval: schedule a bounded checkout-creation pause while retaining webhook retries. Capture schema/function/trigger/grant/policy definitions, migration history, business-row counts/counters and an approved backup/restore point. Inventory in-flight legacy payments; route them to evidence-based manual reconciliation, never automatic paid conversion.

Prepare an immutable SQL file containing `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='120s';` then, in order:

1. `supabase/migrations/20261111080000_voucher_production_bridge.sql`
2. The checks inside `scripts/check-voucher-release-prerequisites.sql`, omitting its own outer BEGIN/COMMIT (or run an equivalent approved gate on the same transaction).
3. `supabase/migrations/20261111090000_atomic_voucher_checkout.sql`
4. `supabase/migrations/20261111100000_verified_fulfillment_boundaries.sql`
5. `supabase/migrations/20261113100000_secure_event_table_checkin.sql`
6. `supabase/migrations/20261113110000_checkout_schema_cache_repair.sql`
7. Checks inside `scripts/assert-voucher-release.sql`, omitting its own outer BEGIN/COMMIT, then `COMMIT;`.

Use the approved migration runner to execute exactly these versions and record actual application. Do not run an unrestricted `db push`, replay old missing wallet/backfill versions, deploy anything under `tests/fixtures/`, or merely mark missing versions applied. Abort on lock timeout or any failed assertion. Confirm preserved historical fields/counts, unchanged #19/HJSDGUBY, RLS and role privileges, unique keys and service-only RPCs before reopening checkout. The 120-second timeout is a proposed bound; measure/approve against hosted staging volume first.

## 2. Backend deployment

Deploy the reviewed handler set together after schema success:

- paystack-create-order-checkout, paystack-initialize, paystack-verify, paystack-webhook-settlement
- stripe-create-checkout, stripe-create-payment-sheet (retired endpoint), stripe-confirm-and-settle
- settle-external-order-payment, checkout-reconcile, guest-checkout-webhook
- Every deployed guest handler importing the changed shared guest-paystack/guest-fulfillment modules: guest-event and guest-checkout-reconcile (along with the webhook handlers listed above). Rebundle importers; updating a shared file alone does not redeploy functions.

Validate JWT/authentication config: checkout-reconcile uses JWT; provider webhooks authenticate signed raw payloads; guest/public paths validate their session/signature, never trust client payment state. Verify Paystack success callback registration, Stripe payment_intent.succeeded/payment_intent.canceled and guest session events, signing secret selection, retry behavior and webhook idempotency in staging. Verify the secret-authenticated guest-checkout-reconcile worker schedule. Canonical checkout-reconcile is a buyer-authenticated recovery action, not a service scheduler: exercise it from the order screen and monitor/retry signed provider callbacks for unattended canonical settlement. Secrets must remain in approved server configuration. Existing Stripe guest signing secret is reused only for its correctly registered endpoint. No secret values belong in logs, CLI output or app bundles.

Old client-priced and unverified fulfillment paths intentionally fail closed. Coordinate an app update requirement and support messaging; do not restore unsafe endpoints to keep old clients paying. Keep checkout creation paused if new backend smoke checks fail.

## 3. Android/iOS application release

Build from the reviewed clean commit with approved public configuration and clean dependency install. Run native build/signing checks, install on both platforms, complete the matrix above, and review generated bundles for server secrets. Bundle export alone does not satisfy this step. Release the canonical shared cart UI after backend readiness; stage rollout and verify app-version behavior and durable retries. Preserve minimum backend compatibility for in-flight canonical orders even when rolling back the UI.

## 4. Post-deployment verification

Use approved synthetic/canary purchases; verify exact quote/fee, expected order/reference/payment state, one ticket owned by the correct customer, one redemption, correct usage/stock and one financial ledger credit. Replay callbacks and refresh both apps; counters remain stable. Monitor webhook 5xx/403s, unresolved holds, failed finalizers, duplicate references, receipt denial and counter drift. Do not mark any of the 22 historical orders paid without evidence and separate approval. #19 remains unresolved until its provider and business decisions are established.

## Rollback and recovery

Before commit, any migration error/timeout rolls back the transaction; the injected-failure/retry procedure passed locally. Do not continue to backend deployment after a failed migration. Preserve the backup and migration artifact hashes.

After commit or after accepting payments, retain canonical checkout/evidence/redemption tables and compatible settlement handlers. Stop new checkout creation through approved operational controls and forward-fix. Do not drop financial state, return to fake-payment handlers, release unknown provider holds, or undo voucher counters. Retry a finalizer only with the same verified reference and amount. Database errors roll back financial changes and receipts together; idempotent replay returns the existing result.

A point-in-time restore may discard later valid payments and requires separate incident approval plus provider reconciliation. No destructive down migration, automatic historical repair or automatic refund is supplied. Hosted recovery and device scenarios remain NOT RUN.
