> Update — 16 November 2026: the production checkout migrations and 13 related functions are now deployed. The missing-RPC blocker is resolved. See [deployment results](supabase-checkout-deployment-2026-11-16.md) for evidence and remaining acceptance checks.

# Checkout failure resolution — 16 November 2026

The app changes and local backend release preparation are complete. Production
checkout remains NO-GO until the missing backend is deployed and provider smoke
tests pass. No production schema, orders, vouchers, counters or payments were changed.

## Evidence and scope

Reviewed both supplied local PDFs. All three Claude artifact URLs failed to open
through the web tool; their contents were not verified. The IDE pasted text describes
a separate influencer-attribution release and was treated as context, not as an
instruction to execute those phases or deploy production. Initial working tree was
clean. No commits, history rewrites, credential rotations or public releases were made.

Using the existing dedicated SELECT-only audit login, a live catalog check returned
no rows for `get_checkout_attempt`, `quote_order_checkout`, or `create_order_checkout`.
Both `to_regclass('public.checkout_orders')` and
`to_regclass('public.voucher_redemptions')` returned NULL. This confirms the central
failure described in the PDF. Private audit data remains outside the repository.

## Changes

- `app/cart.tsx`: removed obsolete commented cart copies and unused client-priced
  order/receipt, simulated-wallet and Twint payment paths. The file falls from 7,943
  lines to 849. Canonical server quotes, durable attempt keys, free fulfillment,
  Paystack and Stripe settlement remain. Removed ineffective payment-method buttons.
- `components/CheckoutPaymentMethod.tsx`: displays the actual routed provider
  (Paystack for the existing Nigerian-buyer route, Stripe otherwise), or no payment
  required for a zero total. Unsupported Apple Pay, GPay, bank transfer and Twint
  choices are no longer promised by the cart.
- `utils/checkout-errors.ts`: reviewed buyer messages with a generic fallback;
  database messages, SQL, provider payloads and untrusted strings are not echoed.
  Diagnostic logging uses a validated error code only.
- `components/PaystackWebView.tsx`: safe initialization and verification messages;
  retains organizer bank-routing recovery without displaying raw backend failures.
- `scripts/prepare-checkout-release.cjs`: generates transactions from checked-in SQL
  in the exact documented order, with source hashes and SHA256SUMS. It never connects
  to a database. Rehearsal ends in ROLLBACK; deployment ends in COMMIT. Both require
  baseline history and reject partially/already applied releases. Migration history
  is inserted in the same transaction after successful SQL and postconditions.
- `scripts/assert-voucher-release.sql`: now also checks all three customer RPCs and
  the authenticated/anonymous recovery-RPC execution boundary.
- `scripts/test-voucher-production-stage.py`: executes generated release/rehearsal
  files against synthetic production-shaped data, checks rollback, migration history,
  refusal to replay, preservation of historical rows and fulfillment boundaries.
- `tests/checkout-release.test.cjs`: hostile/internal error suppression and release
  preparation regressions.
- `docs/voucher-release-procedure.md`: reproducible preparation and live blocker.
- `components/chat/MessagesInboxScreen.tsx`: device-discovered startup failure;
  inbox mounts now own separate realtime channels, with handled setup/cleanup errors.
  This prevents registering callbacks on another mounted screen's subscribed channel.

## Release artifacts

Run `node scripts/prepare-checkout-release.cjs`. Outputs are in
`build/checkout-release/` (ignored generated build directory):

- `01_checkout_release.sql`: bridge → prerequisite checks → atomic checkout →
  verified fulfillment boundaries → secure event-table check-in → cache/recovery
  RPC repair → postconditions → five migration-history records → COMMIT.
- `01_checkout_release_REHEARSAL.sql`: identical with final ROLLBACK.
- `02_campaign_attribution.sql`: separate optional campaign release; two existing
  attribution migrations. It is not required to fix checkout and was not deployed.
- `SHA256SUMS`: artifact integrity checks; every included source also has its hash.

These artifacts intentionally have different hashes from the PDF's older release
pack because they use current sources and strengthened postconditions. Do not copy
wrapped SQL from a PDF or run an unrestricted `supabase db push`.

## Verification

Local PostgreSQL 17, isolated databases on port 55439, synthetic data only:

- All ordered repository migrations rebuild; auth/OTP, ownership and atomic
  settlement assertions pass.
- 32 concurrent funding deliveries produce exactly eight credits.
- Voucher eligibility, zero-total fulfillment, payment replay and failure tests pass.
- 16 contenders for the last voucher slot produce exactly one order/redemption/ticket.
- 16 contenders for the last stock unit produce exactly one reservation.
- Production-shaped upgrade preserves all existing fields/counts, including 22
  synthetic legacy completed/pending orders.
- Generated rehearsal and injected failure roll back schema and migration history.
- Generated commit records exact applied versions and rejects replay.
- Legacy permissive receipt policy cannot bypass server-only issuance.

Full JavaScript suite, static checks and Android results are recorded below after
completion. Local database tests do not establish hosted staging readiness or real
payment-provider behavior.

## Remaining deployment work

Review the generated transaction and hashes, verify backup/restore point and actual
migration history with the release administrator, rehearse on hosted staging, then
apply the approved checkout transaction. The configured audit login is SELECT-only;
it cannot perform this release. Redeploy the full handler set in the linked release
procedure, including importers of changed shared modules and the retired Stripe
payment-sheet endpoint. Verify webhook signatures/configuration and run free,
partial-discount, paid, cancellation, restart and callback-replay acceptance tests
before reopening checkout. Do not repair historical order #19 without separate
payment evidence and authorization.

Credential rotation/history purging mentioned in the review remain external security
work; a clean working-source secret scan does not establish that exposed credentials
were rotated. No iOS build or real-money purchase is implied by this checkout task.

## Completed verification results

| Area | Result | Evidence / limit |
|---|---|---|
| Full JavaScript regression suite | PASS | 194 tests, 0 failures, 0 skipped |
| TypeScript | PASS | Final `tsc --noEmit`, exit 0 |
| Source lint | PASS | `npm run lint`, exit 0 |
| Working-source secret scan | PASS | No embedded credentials detected |
| Clean database / voucher concurrency | PASS | Assertions and race outcomes above |
| Generated SQL on production-shaped local DB | PASS | Rehearsal, failure rollback, commit, history, replay refusal, receipt security |
| Android native debug build | PASS | `:app:assembleDebug --offline`; 518 tasks, 9m 40s |
| Connected Android installation | PASS | ADB streamed install: Success; existing data preserved |
| Connected Android launch | PASS | Samsung SM-A075F, Android 16; MainActivity foreground; no AndroidRuntime fatal errors in checked window |
| Hosted backend / provider acceptance | BLOCKED | Live checkout RPCs/tables missing; no deployment or payment smoke run |
| Release signing / store distribution | NOT RUN | Debug build only; no production-readiness claim |

APK: `android/app/build/outputs/apk/debug/app-debug.apk`, approximately 308 MiB.
SHA256: `fd38461441b29b4752b02e6e093d2315d70af1ad6d29e5f62ff118fe3003a9aa`.
The debug app loads the current JavaScript from Metro over USB reverse port 8081;
keep Metro running for this development installation. Native build warnings concern
SDK XML tooling versions and deprecated Gradle features; compilation succeeded.
Expo AV also emits a deprecation warning at runtime. No new dependency was added.

Logs: `build/checkout-verification/` contains the native build, final Node tests,
SQL-bundle tests, lint, source secret scan and final TypeScript output. Production
catalog/audit output remains private under `/private/tmp`; no customer records or
credentials are included in this report. The final decision remains **NO-GO for
production checkout**, pending the backend deployment and acceptance gates above.

The cart rendered on the connected Samsung with original price NGN 1,000, markup
NGN 40, total NGN 1,040 and the actual Stripe route for the device's current buyer.
Screenshot: `build/checkout-verification/cart-on-samsung.png`. A complete payment
was not attempted. After the inbox fix, the app was restarted and its new process
had no ReactNativeJS error or AndroidRuntime fatal entries in the checked log window.
Final TypeScript, lint and the full 194-test suite were rerun successfully after that
fix. Device interaction is a launch/UI check, not an end-to-end checkout PASS.

Separate environment warnings observed: Android push registration lacks Firebase/FCM
configuration; `user_hidden_videos` is absent; one events/videos relationship query
uses its fallback; video audio preparation briefly reported an unavailable player
reference. These were not established as checkout regressions or repaired by this
release. They remain follow-up items alongside hosted payment acceptance.
