# 17 November code review — remediation and deployment, 21 November 2026

> **22 November verification: NOT READY for production sign-off.** The rollout record below documents implementation and deployment, not complete end-to-end acceptance. The later [production-readiness audit](production-readiness-2026-11-22.md) identifies reproduced recovery, signup/email, funding/client and web-header gaps.

Source reviewed in full: all five pages of `60seconds-code-review (1).pdf`, reviewing main commit `f8370f7`. The document's suggested solutions were checked against the repository and hosted schema before implementation.

The ten numbered findings have code changes addressing them. The Supabase portion is deployed to **60Seconds** (`rvvujgbaswecqohixgog`): **two new migrations, 29 affected Edge Functions and a private reconciliation worker running every five minutes**. Web/native client changes remain in this working tree; no Git push, Vercel deployment or app-store release was performed. Repository-wide typing cleanup is still partial, as detailed below. No live-money transfer or customer email was sent for acceptance testing.

## Finding-by-finding changes

| PDF point | Changes | Evidence / operational consequence |
|---|---|---|
| **1. Money sent before balance check** | Replaced all three payout handlers with one typed implementation. `reserve_withdrawal` locks the wallet, checks funds and the saved bank account, debits available balance, and writes the pending ledger entry, request and durable hold in one transaction, before a provider call. Removed `Math.max` and the 500-row ledger fallback. | Insufficient funds and invalid banks prevent all provider calls. Pending transfers consume available balance immediately. Timeouts retain the hold. Server-generated references and provider idempotency prevent replayed operations from creating new transfers. |
| **2. Clients can verify banks** | Enabled owner-read-only bank RLS, removed all old policies, revoked table and column write privileges from client roles, and moved bank persistence into the provider verification functions. Removed client upsert/update and metadata fallback paths. | Production catalog checks confirm clients cannot insert or update bank fields. Old client-writable verification flags were reset to pending; account details were retained. **Existing accounts must be reverified before withdrawing.** |
| **3. Client-controlled payout destinations** | Deleted request-body bank fallbacks. Paystack recipient/subaccount identifiers come from provider responses saved by server verification. Stripe verification resolves Connect IDs only from server-owned `app_metadata`; payout destinations come from verified server bank rows. The reservation snapshots the destination, amount and currency. | Forged recipient, connected-account, external-account, reference and currency fields in payout requests are ignored. Both Paystack and Stripe regression tests cover this. Old client/user-metadata linkage is not trusted. Stripe accounts may need onboarding/reverification. |
| **4. Unauthenticated welcome relay** | Require a valid user session or a constant-time authenticated internal server invocation. Recipient is loaded from the verified Auth identity; names/addresses/triggers in caller input cannot select email content or recipients. Removed the trigger bypass. `verify-otp` invokes delivery after recording server-side verification. Added a send claim and rate limit; removed the signup-time email invocation. | Unauthenticated live requests return 401. Fixed email content and private user targeting prevent arbitrary relay and email-address enumeration. The unused Node welcome route now rejects instead of pretending to send an email. |
| **5. Top-up paymentType bug** | Rebuilt the funding-only initializer. Provider metadata always contains `paymentType: wallet_funding`, authenticated user ID and the user's actual NGN wallet ID. Generate references server-side, allow only configured HTTPS callback origins, remove caller-controlled bearer/splits and unused FX conversion. Order checkout stays on its separate server-priced route. The Node initializer now delegates to that same authoritative funding function rather than maintaining a second client-routed implementation. | Tests cover metadata-only paymentType, forged ownership, invalid amounts/currencies, order requests and callback allowlisting. No silent minimum-amount increase. |
| **6. User lookup cannot scale** | Replaced all paginated `auth.admin.listUsers` searches in the affected functions with one service-role-only SQL lookup. Welcome delivery uses verified identity instead of email search. | Hosted Auth has 1,278 users. Verified its existing `(instance_id, lower(email))` index and reused that index with the hosted zero-UUID Auth instance scope. No Auth-table ownership/index changes were needed. Public execution is denied; mixed-case lookup tests pass. |
| **7. Withdrawal race / double spend** | Database row locking serializes reservations and reversals. Durable holds are unique by owner and idempotency key. Replays must match the original amount, bank and provider. `finish_withdrawal` handles terminal results idempotently and permits a verified reversal after completion. Recalculation subtracts pending owner withdrawals. | Eight concurrent requests for 60 against 100 created exactly one hold and left 40. Duplicate reservation/reversal, failure release, pending recalculation and insufficient-balance assertions pass. Legacy reconciliation no longer overwrites a held balance from a stale JavaScript snapshot. |
| **8. HTTP 200 errors / financial logs** | Payouts and top-ups use proper authentication, validation, conflict and provider-error HTTP statuses. Added a shared HTTP-status mapper to affected Paystack/Stripe legacy responses. Removed withdrawal balance-debug output. Pending uncertain payouts return HTTP 202 with the original reference. | Live missing-auth payout calls return 401. Unit tests exercise 400, 409, 422 and 202 behavior. No balance or provider-balance dump is returned by the payout path. Client handling now reads the server's authoritative wallet and request history. |
| **9. Duplicate guest email / stuck refund** | Claim delivery atomically before sending. Explicitly rejected guest sends release their claim for retry; ambiguous delivery outcomes keep the claim. Refund reconciliation selects pending refunds even if email was already sent. Added a serialized refund claim, provider lookup and deterministic refund reference. | Concurrent webhook/worker callers cannot both claim the same email. A failed refund API attempt remains pending and becomes eligible after the ten-minute claim lease. Existing provider refunds are checked before requesting another. See delivery limitation below. |
| **10. Config / rate limits / headers** | Removed baked-in Supabase project/public-key and Stripe publishable-key fallbacks from runtime source. Required config comes from environment. Added durable signup/welcome request limits; existing OTP email/IP/attempt limits remain. Worker bearers use fixed-length digest comparison. Retired the unused custom reset-email route; Supabase Auth handles recovery. Added CSP, framing, MIME, referrer, permissions and HSTS headers to Vercel configuration. | Current source secret scan passes. Supabase worker authentication tests pass. Vercel headers and client config require publishing the updated web build to take effect; they are not a Supabase-hosting setting. The Stripe public key was moved into ignored local build configuration, not deleted from the account. |

## Withdrawal lifecycle and recovery

- Provider calls follow the committed hold. An interrupted function cannot return the held funds based on a timeout or an ambiguous provider error.
- Signed Paystack transfer webhooks retrieve and validate reference, amount, currency and recipient before completing/releasing a hold. The existing signed Stripe webhook handles payout events for the matching connected account.
- The private `withdrawal-reconcile` worker checks provider state every five minutes. A valid worker credential is required; it is stored in Supabase secrets and the scheduler's Vault entry. The scheduled SQL contains a Vault lookup, not the credential literal.
- Stripe transfer and payout creation use separate stable idempotency keys. A failed payout must return transferred platform funds before the wallet is released. If the reversal is uncertain, the hold stays pending.
- Stripe idempotency keys expire: unknown attempts older than 23 hours stop creating provider objects and require provider investigation. This deliberately prevents a new transfer after an old key expires.
- Worker requests have bounded provider timeouts and a small concurrent batch. Unresolved attempts rotate through the queue instead of permanently blocking later requests.
- Historic withdrawals without the new durable holds were not inferred, repaired, refunded or replayed. Such records need a separate provider-backed reconciliation audit.

## Supabase rollout and checks

Applied and recorded exactly:

1. `20261121100000_secure_withdrawals.sql`
2. `20261121110000_review_service_guards.sql`

Both first passed a production **ROLLBACK** rehearsal with short lock/statement timeouts. The rollout did not run an unrestricted `db push`, reset the database or replay historical migrations. A completed physical backup dated 20 November was verified. Previous affected policy/function definitions and 27 originally listed function source bundles were saved privately under ignored `local-private/deployment-20261121/`; this is not a full customer-data backup. A proposed export of live bank-account rows was rejected by automatic approval review and was not performed; the replacement backup includes configuration only.

All **29 deployed functions are ACTIVE**, and their previous JWT settings were preserved. The new worker authenticates in its handler. The deployment used a minimal temporary deployment configuration because the installed CLI binary was missing, the latest CLI rejected old local config keys, and macOS terminated the pinned older CLI. Project Auth/database settings were not replaced by that temporary deployment configuration.

Forty HTTP checks passed, covering startup/authentication behavior and rejection of unsigned payment webhooks. Worker-only and webhook endpoints intentionally reject unsigned OPTIONS calls; those are not browser CORS endpoints. The retired reset function is protected by its preserved gateway JWT setting and rejects anonymous requests with 401; its handler returns 410 when reached.

Production catalog checks confirm:

- both migration versions are recorded;
- authenticated clients cannot insert/update banks or update withdrawal requests, including via pre-existing column grants;
- clients cannot execute reservation, completion or email lookup functions;
- clients cannot read the private hold table;
- no legacy untrusted bank verification remains;
- wallet recalculation includes pending withdrawal holds;
- the five-minute worker job is active and authenticated health returns 200.

Read-only acceptance found zero new withdrawal holds at verification. No payout was initiated to test these changes. Existing bank details remain stored, with legacy verification cleared.

## Local validation

- **234 Node tests passed, zero failed**, including ten payout-path tests and three funding-initializer tests.
- Strict application/backend TypeScript, source/security lint and working-source secret scanning passed.
- Deno checked the typed payout module and critical funding/signup/email/webhook/worker dependency graph. Critical Edge runtime checking is now included in CI.
- All **57 ordered migrations** rebuilt in a fresh local PostgreSQL database. Fixed a pre-existing discovery migration's reference to an optional `creator_id` column so the clean rebuild works with the canonical older schema.
- OTP/RLS/order settlement assertions passed. Thirty-two concurrent funding deliveries produced exactly eight credits.
- Withdrawal SQL tests cover client denial, insufficient funds, unverified accounts, replay, pending-balance recalculation and idempotent reversal. Eight concurrent reservations produced one hold.
- Service SQL checks cover case-insensitive lookup, missing users, private function execution, rate-limit expiry and duplicate welcome claims.
- Production web export passed using configured public environment variables. `git diff --check` passed.

Evidence is in ignored `build/review-20261121/`, including rehearsal, migration, function/authentication, HTTP, worker and source-hash records. Local command logs are under `/tmp/60s-review-*`. Remote CI execution was not triggered.

## Code-health cleanup and remaining limits

- `ProductsList.tsx`: **10,461 → 1,686 lines**, primarily by deleting obsolete commented screen copies.
- Regular upload screen: **4,620 → 2,302 lines**. Business upload screen: **4,807 → 2,480 lines**. Shared live styles now live in `components/upload/styles.ts`; media validation/picker compatibility is shared in `utils/upload-media.ts`.
- Wallet store: reduced to **1,544 lines** by removing unsafe client persistence, duplicate bank handling and local money reconciliation.
- Removed the stray root SSH public-key file and the misleading Node welcome-email placeholder. Disabled provider compatibility APIs remain to reject old callers; this change does not delete every legacy integration or old document.
- The new common payout implementation has no `any` annotations or suppression directives. A broad AST audit of 308 application/backend/Edge source files still finds **797 explicit `any` nodes (down from 922) and 27 type-suppression comments (down from 33)**. This scope includes Edge Functions and differs from the PDF's count. **Repository-wide typing/component decomposition is not complete.**
- Claimed email sends with ambiguous provider results require provider-log review before their claim is released. Exactly-once delivery across a database and an email provider without idempotency cannot be promised. Automatic retry is preserved for explicit guest-provider rejections, while uncertain accepted sends are not blindly duplicated.
- No actual provider payout, refund or email-delivery acceptance, physical-device check, signed mobile build or store release was performed. Ensure the Stripe Connect webhook subscription includes payout events; the scheduled worker provides polling recovery independently.
- Publish the updated clients to restore the revised bank-save/withdrawal UI for users; old client direct writes are intentionally denied. Configure the public Supabase/Stripe build environment in the hosting/build service before release. Publish the updated Vercel configuration for web headers to take effect.
- The GitHub token pasted in the chat was not required for Supabase deployment; the existing private Supabase management credential was used. Revoke the exposed GitHub token. No credential values are included in source or this report.
