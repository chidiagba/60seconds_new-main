# Voucher production readiness — 11 November 2026

## Decision: NO GO

The confirmed voucher schema, legacy fulfillment and voucher-selection defects are fixed and tested locally. Production deployment remains blocked by provider/staging/device verification and the independently failing clean release baseline. Nothing was deployed, and no historical business records were changed. The completed production audit was reused, not repeated.

Focused source commit: `9feeac95e0a43c0a58edb0ae12163b8827525224` on `voucher-production-readiness-20261111`, worktree `/tmp/60seconds-voucher-release`. Main checkout remains at `23c2d84f7d48816809a1d99463e04d3f040d359d`; its unrelated work and index were preserved. See [release manifest](voucher-release-manifest.json) for exact committed hashes, prior path dispositions and the complete remaining main-worktree inventory.

## Established root causes and fixes

| Confirmed defect | Implemented fix and evidence |
|---|---|
| Production lacks order voucher columns, modern voucher prerequisites and redemption/push tables assumed by new checkout. Production expiry is TIMESTAMPTZ; a clean rebuild differs. | Forward-only bridge adds missing schema without historical business-row updates, retains timestamp expiry/normalizer, installs compatible redemption functions and Stripe provider support. Captured-shape synthetic upgrade passed. |
| Existing permissive receipt INSERT policy permits unpaid client receipt issuance; legacy paid-then-receipt flow can miss voucher consumption. | Revoke direct writes, add restrictive policies and paid/private-fulfillment triggers. The legacy client helper now only reads verified receipts. Actual permissive production policy was reproduced and could not bypass the new guards. |
| Legacy makePayment simulates success; client-priced Stripe and JS settlement/receipt paths can complete without trusted settlement. | Simulation fails closed; old client-priced interfaces return 426; unverified legacy settlement returns 409. Signed legacy Paystack callbacks return 503/reconciliation rather than falsely acknowledging settlement. Database guards block old service writers too. |
| Guest receipt completion and financial posting were separate transactions. | Service-only guest settlement atomically records verified evidence, ledger, payment, order and receipt. Injected receipt failure rolls back all financial writes. |
| Voucher Apply re-resolves the validated code from a mutable general voucher list; quote/selection can be cleared independently. | Apply carries validated voucher + item-bound quote directly. Missing/mismatched selection is rejected by payload construction; backend persists its authoritative quote. Durable per-user/cart request keys survive restart and recover existing holds. |
| Provider response errors can be confused with success in loosely checked paths. | Require HTTP success and strict boolean provider success, matching reference/amount/currency/transaction ID before settlement. HTTP 403 and malformed success tests invoke no financial finalizer. |

Atomic canonical fulfillment uses locked order/voucher/inventory rows, unique request/provider references, a single voucher redemption per order and verified service-only settlement. Duplicate settlement returns the existing purchase. External provider calls are outside the SQL transaction; provider idempotency and durable checkout keys handle retries. An unavailable provider retains an unresolved hold rather than guessing success or cancellation. Owner/customer notifications are outbox events; guest email may retry after financial commit.

These are reproduced code/schema mechanisms. They do not establish the exact UI sequence for #19 or prove which mechanism produced each historical inconsistent order.

## Schema upgrade results

Apply only these new migrations, in this order, in one explicit bounded transaction:

1. `20261111080000_voucher_production_bridge.sql`
2. `20261111090000_atomic_voucher_checkout.sql`
3. `20261111100000_verified_fulfillment_boundaries.sql`
4. `20261113110000_checkout_schema_cache_repair.sql`

The forward cache repair creates the empty checkout table only if absent, restores authenticated owner-only reads, adds an owner-scoped checkout-attempt lookup, and requests a PostgREST schema reload. It does not backfill or modify existing checkout/payment rows. Run the voucher and table check-in migrations only against a disposable or approved staging database first; production changes still require explicit approval.

The local production-shaped baseline uses captured public schema metadata, the 40 recorded versions, actual receipt policies and synthetic records. It is not a production-data clone or cloud staging certification. All existing fields/counts, including 22 synthetic completed/pending orders, were preserved. Injected upgrade failure rolled back all new DDL; rerunning the upgrade succeeded. Canonical checkout and hardening SQL passed on both clean and production-shaped databases.

Legacy monetary vouchers with unspecified currency deliberately remain unavailable until their owner explicitly supplies currency. The bridge does not guess a currency or reinterpret historical discounts. The order-status constraint permits partial redemption; the provider constraint supports Stripe without rewriting existing payment rows. Guest payments may have null user_id because the guest has no authenticated customer ID. Private evidence/redemption tables use restricted access; service-only RPCs own financial writes.

Do not run an unrestricted migration push: older absent local wallet/backfill migrations are not part of this release. `tests/fixtures/production-baseline/` contains test-only historical definitions, never deployment SQL. The prerequisite gate runs after the bridge, inside the release transaction, before atomic checkout.

## Historical classification: 22 orders, read-only

The existing approved snapshot was classified offline. Detailed order IDs and per-order evidence are in the ignored local file `local-private/voucher-historical-classification.json`; regenerate with `scripts/classify-historical-orders.py --snapshot <approved-snapshot> --output <private-report>`.

| Classification | Count | Established evidence |
|---|---:|---|
| Bank-transfer evidence missing | 9 | No stored provider reference or completed payment row |
| Provider reference missing (Paystack/Twint/Stripe labels) | 8 | Same missing settlement evidence |
| Legacy card/wallet method unverified | 4 | Same missing settlement evidence |
| Manual seed label | 1 | Label is not proof of payment |
| Total | 22 | Completed order, pending payment, receipt present; audited buyer ownership matches |

Financial outcome remains **UNKNOWN** for every classified order. None was marked paid, cancelled, refunded, repaired or reissued. Legacy simulation is a possible mechanism, not proof that these 22 customers did not pay. Obtain bank/provider evidence and separate approval for any historical correction. Pending historical receipts cannot be redeemed through the hardened paid-order boundary.

### Order #0000019 and HJSDGUBY

Retain the completed audit result: order `3dea31a3-cfc8-4eb0-aa95-1d781fbcc65a` is pending/pending, total **NGN 1,040** (1,000 + 40), saved voucher null, saved discount zero, one initialized/pending Paystack attempt and no customer ticket. Reference: `60seconds_order_884f2837f5164655b44d0b33642ae4f1`. Its event has expired.

HJSDGUBY is an active 100% voucher with audited usage **0/100**. There is no evidence that the original checkout accepted it, that zero total was authorized, or that only NGN 40 remained payable. Current voucher terms cannot prove an original discount. No automatic repair is eligible; no repair was executed. The locally tested eligible zero-total flow changes a dedicated synthetic voucher 0→1 once and issues one ticket; replay leaves usage at 1. This was not performed on production HJSDGUBY.

## Paystack HTTP 403 findings

The previously authorized GET verification returned HTTP 403 and no definitive transaction result. Local key mode is live, and its SHA-256 matches the deployed secret digest: a local/deployed key mismatch is excluded. PAYSTACK_SECRET_KEY, STRIPE_SECRET_KEY and STRIPE_GUEST_WEBHOOK_SECRET names are present in captured deployment metadata. Values/digests were not displayed or committed.

The exact reason for Paystack's denial remains unestablished: account/API/network restrictions require provider/dashboard evidence or an authorized test from an approved runtime. No token extraction, access-control bypass, credential rotation, charge or refund was attempted. Earlier direct Keychain extraction was rejected by automatic approval review; the supported Supabase CLI and dedicated SELECT-only role were used instead. Supabase connectivity is no longer a blocker. Secret-name presence does not certify correct webhook registration or provider capabilities.

## Exact verification results

| Scope | Result |
|---|---|
| Current workspace `npm test` | **169 passed, 0 failed** |
| Isolated focused release Node suite | **105 passed, 0 failed** (different inventory; unrelated new tests excluded) |
| Read-only audit runner tests | **6 passed** in each tree; no live audit repeated |
| Workspace TypeScript / source lint / secret scan | Passed |
| Clean/focused frontend TypeScript with runtime-appropriate excludes | **106 errors**, same as base; **zero new diagnostics** |
| Focused full-source security lint | **690 production-silent-logger findings** in retained baseline source; no syntax/parse failures |
| Focused whole-tree secret scan | **25 pre-existing possible-credential/private-key path findings**; full scan fails |
| Focused changed/new source scan | **63 paths, 0 findings** before documentation |
| Ordered local migrations + auth/RLS/settlement | Passed; **32 concurrent funding deliveries → exactly 8 credits** |
| Checkout concurrency | **16 final voucher-slot attempts → 1 order/redemption/ticket**; **16 final stock-unit attempts → 1 reservation** |
| Verified boundaries, clean + production-shaped | Passed: unpaid completion/receipt/legacy service bypass rejected; Stripe/guest replay once; injected canonical/guest receipt failure fully rolls back settlement |
| Production-shaped upgrade/recovery | Passed: preserved existing fields/counts; failed transactional upgrade rolled back; subsequent upgrade passed |
| Android and iOS offline bundle exports | Passed in current workspace and isolated release, dotenv disabled |
| Native build, installed device/payment-sheet and live staging/webhook smoke | **Not performed** |
| Paystack production verification | **HTTP 403 — unresolved, not success** |

Artifacts: `/tmp/voucher-final-*.log`, `/tmp/voucher-focused-*.log`; mobile bundles `/tmp/voucher-final-mobile-export-v2` and `/tmp/voucher-focused-mobile-export`. Full runtime Deno type checking was unavailable (Deno is not installed); server files received syntax/transpile checks and mocked handler tests, plus real SQL integration. Hermes bundle export is not an installed-app test.

## Remaining gates

1. Integrate the separately reviewed baseline TypeScript/logger/secret-removal work into a clean release without blindly committing the dirty tree, then repeat all release checks. The workspace's passing checks depend on that excluded work. Retained baseline scan findings require review/removal and credential-owner response where genuine; do not ship the isolated branch as-is.
2. Resolve Paystack verification access/configuration and obtain definitive provider evidence for #19 separately. Historical repair remains separately approved and is not a prerequisite for silently marking the order successful.
3. Run a hosted production-shaped staging deployment and the Android/iOS device/provider/webhook matrix in [release procedure](voucher-release-procedure.md). No staging credentials, provider test sessions or physical-device sessions were supplied/executed here.
4. Obtain explicit production migration/backend/mobile release approval after the above gates pass. Do not deploy based solely on local tests or bundle success.

No further production access or approval is required to review these local commits. Production deployment and historical correction remain prohibited without separate explicit authorization.
