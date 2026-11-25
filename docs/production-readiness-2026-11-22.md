# Production readiness verification — 22 November 2026

**Overall verdict: FAIL — NOT READY for production sign-off.**

Later release note: [120.0.0 guest tickets, lookup and signup location](guest-tickets-location-120.md) records the subsequent authorized web publication and six Supabase function deployments. This audit remains a historical snapshot; its unrelated readiness blockers are not closed by that release.

The earlier statement that all ten findings were addressed was too broad. Important security changes are implemented and deployed, and their core controls pass verification. This audit reproduced additional recovery, signup/email, funding/client and response-handling gaps. A deployment record and passing regression suite do not establish complete end-to-end readiness.

This is a verification report. No application/backend fixes were deployed in this audit. No production row or setting was changed, no actual payment/transfer/refund/recipient was created, no customer email was sent, and no code or release was pushed/published. Local builds and synthetic database records were created for testing only.

## Status definitions

- **Implemented:** present in the reviewed local source.
- **Tested:** exercised at the stated boundary. Provider stubs, SQL tests, bundle compilation and device/provider end-to-end tests are different evidence levels.
- **Deployed:** confirmed in hosted Supabase metadata, SQL definitions or executable markers. Local web/native/Node code is not automatically deployed.
- **Production verified:** observed directly in production through read-only catalogs, passive operational history or safe negative/health HTTP requests. No successful money-moving or email-delivery workflow receives this label.
- **PASS:** the scoped check has affirmative evidence.
- **FAIL:** a reproduced defect **or missing required acceptance evidence** prevents sign-off. These reasons are stated separately; an untested provider flow is not described as a proven provider failure.

## The six requested items

| Request | Result | Evidence and limit |
|---|---|---|
| 1. All ten findings fully addressed in deployed backend | **FAIL** | Core reservation, ownership and RLS controls pass. Full completion is disproved by the cases below, including terminal Paystack states, signup verification, welcome retry and a remaining HTTP-200 failure path. Web headers and Node/client changes are not deployed through Supabase. |
| 2. Safe end-to-end Paystack/Stripe, funding, refunds, bank and email verification | **FAIL — provider acceptance unverified; local integration partly PASS** | Actual handlers plus a real disposable PostgreSQL database pass the listed payment lifecycle tests with **stubbed Auth/provider transport**. Real provider sandbox credentials and an identified non-customer inbox are not available/verified. No live money or email was used to fill that gap. Several local readiness cases fail independently of credentials. |
| 3. Worker, webhooks, policies and configuration | **FAIL as a complete readiness gate; individual controls PASS** | Worker scheduling, passive HTTP 200 executions on an empty queue, authenticated health, 40 safe HTTP checks, CORS and critical RLS/RPC restrictions pass. Real provider webhook subscriptions/delivery are not verified. Public CSP/frame protection is absent. |
| 4. Web, Android and iOS compatibility | **FAIL — functional mismatch reproduced** | All three JavaScript exports pass. The shared funding UI uses a rejected deep-link callback and simulated local credits. Native compilation results are recorded below; no connected Android device or booted iOS simulator was available for runtime acceptance. Neither existing distributed clients nor a new published client release is certified compatible. |
| 5. Identify remaining blockers | **PASS — inventory completed; blockers unresolved** | Seven reproduced code-gap groups, historical withdrawals, legacy bank enrollment, provider acceptance, web configuration and typing debt are listed with scope and evidence. Nothing was automatically repaired in production. |
| 6. Evidence-backed PASS/FAIL report | **PASS** | This report distinguishes all four evidence stages and provides reproducible audit scripts and current evidence files. |

## Current production evidence

Project: **60Seconds**, `rvvujgbaswecqohixgog`. The snapshot was taken on 22 November Pakistan time; UTC timestamps are retained in evidence files.

- **PASS:** both `20261121100000` and `20261121110000` are recorded.
- **PASS:** all 29 affected functions are ACTIVE. None of their versions or JWT flags drifted from the prior deployment verification.
- **PASS:** all eight relevant hosted SQL function bodies match the checked-in remediation migrations exactly after trimming surrounding whitespace: reserve, finish, balance recalculation, lookup, rate limiting and the three delivery/refund claims.
- **PASS:** RLS is enabled on wallets, transactions, guest checkouts, holds, bank accounts and rate-limit storage. Anonymous bank reads, authenticated bank INSERT/UPDATE, wallet UPDATE, withdrawal-request UPDATE, hold reads and client execution of payout RPCs are denied. The bank policy is owner-only SELECT.
- **PASS:** 40 repeated startup/authentication/webhook-rejection checks passed. They establish availability and rejection behavior, not successful provider processing.
- **PASS:** CORS accepts all three configured website origins and emits no allow-origin header for an untrusted origin.
- **PASS:** the withdrawal worker is active every five minutes. Five recent passive worker responses were HTTP 200 with `checked: 0`, `unresolved: 0`, no timeout and no error. Its authenticated **health-only** request returned 200. The audit never invoked a processing run.
- **PASS:** hosted Auth retains a 600-second OTP expiry, six-digit codes, 60-second resend interval, verification limit 5 and minimum password length 8. SMTP host/sender/password are configured. This does not prove email delivery, and the private-signup bypass below is separate from hosted Auth defaults.
- **Limited deployment proof:** five hosted executable archives contain the expected critical code markers, including the private-signup auto-confirm code. The current CLI cannot unbundle this server's octet-stream archives (`expected multipart response`). Therefore this audit does not claim a complete byte-for-byte comparison of all 29 Edge sources. Version/JWT checks and SQL-body comparisons are independent, successful checks.

No new holds or server bank-account rows were present in the production snapshot. Therefore current empty-queue worker success does not establish successful processing of pending real payouts.

## Each original review finding

| # | Implemented / deployed | Verified scope | Final finding result |
|---|---|---|---|
| 1. Send before checking balance | Common payout handler and locked reservation RPC deployed | Real local SQL confirms debit precedes provider invocation; signed Paystack success/reversal and replay pass with stub transport. Hosted RPC body matches. Terminal-state recovery has a gap. | **PASS for reserve-before-send control; FAIL for complete payout readiness.** |
| 2. Self-verified bank accounts | Server writes plus client revocations deployed | Live table/column privileges and owner-only RLS pass. Local unverified-bank denial passes. No real provider bank verification was performed. | **PASS for blocking client self-verification; bank-provider acceptance unverified.** |
| 3. Client-controlled payout destination | Verified bank snapshot, server references and trusted Stripe linkage deployed in the primary payout routes | Fake recipient/account/currency/reference fields are ignored in regression tests. Hosted primary payout archives contain the shared handler. No real provider ownership/onboarding acceptance was performed. | **PASS for the reviewed payout-route trust boundary; provider setup unverified.** |
| 4. Welcome relay | Direct caller-session/recipient restrictions deployed | Live anonymous request is 401. However private signup stamps verification without email proof; welcome retry after explicit rejection also fails. | **FAIL — not fully addressed.** |
| 5. Funding paymentType | Funding-only Edge initializer deployed; Node delegate remains local | Authoritative metadata and signed funding replay pass locally. Actual client's deep-link callback receives 400; client can still fabricate a local credit. | **PASS for backend metadata fix; FAIL for usable funding flow.** |
| 6. User lookup scaling | Service-only indexed lookup deployed | Hosted SQL body matches; public execution is denied; mixed-case/missing-user SQL tests pass locally and in read-only production checks. No paginated user scan remains in the affected source. | **PASS for the scoped lookup finding.** |
| 7. Concurrent balance/debit race | Locked reserve/finish and pending-aware recalculation deployed | Eight concurrent reservations of 60 against 100 create one hold and leave 40. Replay, failure release and reversal pass. Hosted functions match tested definitions. | **PASS for atomicity control.** |
| 8. HTTP 200 failures/logs | Main payout/top-up handlers fixed; shared mapper deployed | Main negative/202 paths pass. `paystack-reconcile-subaccount-settlements` still returns 200 on a caught database failure. | **FAIL — error-status cleanup incomplete.** |
| 9. Email duplication/refund retry | Guest claim/refund-lease changes deployed | Real local refund rejection/lease/retry/duplicate suppression passes. Welcome claims can stick on explicit rejection. Provider-terminal refund completion and Stripe refunds are not verified/implemented in the reviewed refund path. | **FAIL for complete email/refund lifecycle readiness.** |
| 10. Config/rate limits/headers | Environment/rate-limit/worker changes deployed to Supabase; Vercel headers remain local | Auth settings and CORS pass; worker secrets are checked in constant time. Public websites lack CSP and frame protection. Provider credential mode/config and published client build environment are not verified. | **FAIL as a complete production-hardening finding.** |

## Reproduced code gaps — no production mutation

The additional readiness audit has **4 PASS and 10 FAIL assertions**, grouped below. It uses actual source with synthetic identities and provider responses, never real provider transport. Its intentional exit code is 1 while these failures remain. The original 234-test suite still passes; its coverage did not include these cases.

### R1 — Paystack terminal states stay held

`processWithdrawal` maps only `success`, `failed` and `reversed` to terminal ledger states. Verified `abandoned`, `blocked` and `rejected` results are mapped to `pending`. The reconciliation worker repeats that same mapping, so those holds do not automatically release.

Observed: three audit cases expected failure/release handling and each persisted `pending`. Paystack documents these states as conclusive in [How Transfers Work](https://paystack.com/docs/transfers/how-transfers-work/). This is a recovery defect, not evidence that the row-locking control fails.

Source: `supabase/functions/_shared/withdrawals.ts`.

### R2 — Shared funding UI callback conflicts with backend allowlist

`PaystackWebView` passes `myapp://paystack/callback`; `paystack-initialize` accepts only HTTPS callback URLs from configured website origins. Running that actual request shape against the actual initializer with a fake authenticated user returned **400**, before any provider request.

Do not fix this by allowing arbitrary callback URLs. Choose a supported, tightly allowed native/browser return flow and test it on all platforms.

Sources: `components/PaystackWebView.tsx`, `supabase/functions/paystack-initialize/index.ts`.

### R3 — Client-only wallet credits remain

`wallet-store.addFunds` uses a simulated delay, creates a local `completed` deposit and increases local balance without a server payment. Running the actual method changed a synthetic balance from **100 to 150 with zero server/network calls**. `AddFundsModal` still calls it for card/other funding and after Paystack verification.

Production RLS prevents this from crediting the server wallet. It is nevertheless a false-success/display and reconciliation defect. A subsequent authoritative refresh can remove the displayed credit. Stripe/card wallet funding is not established by this method.

Sources: `store/wallet-store.ts`, `components/AddFundsModal.tsx`.

### R4 — Private signup claims verification without email proof

The actual `create-signup-user` handler called its fake Auth admin with `email_confirm: true` and populated `app_metadata.signup_otp_verified_at` for private signup without consuming an OTP. The hosted executable contains these markers too. The welcome handler treats that server timestamp as proof.

The direct unauthenticated welcome endpoint is blocked, but that alone does not establish verified ownership of its target email. Signup/email-ownership acceptance needs correction and testing before the relay finding can be closed fully. No production signup was created to demonstrate this.

Source: `supabase/functions/create-signup-user/index.ts`.

### R5 — Explicitly rejected welcome emails remain claimed

With all three email provider stubs explicitly returning 403, the first welcome request returned 502. The next request returned **200 `{success:true, skipped:true}`**, made no additional send attempt, and retained the claim. This is a definite-rejection case, not the acknowledged ambiguity after a provider timeout.

Additionally, live catalog checks show authenticated profile owners have UPDATE privileges on the welcome claim/sent columns. That merits an owner-policy/trigger review before treating those fields as a tamper-proof one-send guard. No profile row was changed to test that in production.

Sources: `supabase/functions/send-welcome-email/index.ts`, `20261121110000_review_service_guards.sql`.

### R6 — Stripe bank readiness ignores disabled payouts

The actual mapping helper returned `verified: true` for a validated external bank even when its connected account had `payouts_enabled: false` and `requirements.past_due`. Bank-account validation and connected-account payout readiness must be distinguished. Otherwise a reservation can lead to a provider rejection and a held/manual recovery case.

Source: `supabase/functions/stripe-verify-business-bank-account/index.ts`.

### R7 — Residual HTTP 200 error path

For a synthetic database outage after valid authentication, the actual `paystack-reconcile-subaccount-settlements` handler returned **HTTP 200 with `success:false`**. The earlier HTTP-status rewrite did not change its `reply(body, status=200)` catch path. This audit did not induce any live database error.

Source: `supabase/functions/paystack-reconcile-subaccount-settlements/index.ts`.

## Flow-by-flow safe acceptance

| Flow | Local integration / isolated result | Real provider end-to-end | Production verdict |
|---|---|---|---|
| Paystack withdrawal | **PASS:** real SQL hold before stub transfer; real HMAC-signed handler success/reversal/replay; **FAIL:** additional terminal states | **NOT VERIFIED** | **FAIL** |
| Stripe withdrawal | **PASS:** real SQL hold, stub SDK transfer/payout, polling completion and reversal-before-release | **NOT VERIFIED** | **FAIL — acceptance evidence missing**, plus bank-readiness gap |
| Paystack wallet funding | **PASS:** authoritative initializer plus signed charge webhook and duplicate-credit prevention in real local DB; **FAIL:** actual UI callback | **NOT VERIFIED** | **FAIL** |
| Stripe/card wallet funding | Client-only balance fabrication reproduced; no authoritative Stripe wallet-funding lifecycle established | **NOT VERIFIED** | **FAIL** |
| Paystack guest refund | **PASS:** real SQL claim, provider-stub rejection, lease expiry, retry and duplicate suppression | **NOT VERIFIED** | **FAIL — acceptance evidence missing**; creating a refund ID is not proof of completed refund |
| Stripe refunds | No `stripe.refunds.create` path found in reviewed Edge/backend code; no successful/refused/replayed lifecycle exercised | **NOT VERIFIED / no reviewed implementation** | **FAIL** |
| Paystack bank verification | **PASS:** local unverified-bank/security denial; safe live auth rejection | **NOT VERIFIED**; no recipient/subaccount created | **FAIL — acceptance evidence missing** |
| Stripe bank verification | Trust-boundary tests pass; disabled-payout-account readiness case **FAIL** | **NOT VERIFIED**; no Connect/external bank created | **FAIL** |
| Signup/OTP/welcome | OTP SQL/rate limits and anonymous rejection **PASS**; signup ownership and welcome retry **FAIL** | **NOT VERIFIED**; no real inbox delivery | **FAIL** |
| Guest receipt email | Claim/security and provider-request-format tests **PASS**; provider delivery and ambiguous-send recovery unverified | **NOT VERIFIED** | **FAIL — acceptance evidence missing** |

**Credentials/environment boundary:** Supabase management access is valid. Required secret *names* exist, but that does not prove valid credentials or test mode. The local Paystack key's hash did not match the hosted secret digest, so it was not used to test the hosted provider configuration. No verified Stripe test credential or designated test project/inbox was identified. This audit did not extract hosted secret values, switch production provider mode or create a test project. A staging/provider test-mode run is still required.

**Webhook boundary:** signed Paystack processing passed locally with a synthetic key and real SQL. Live unsigned Paystack/Stripe rejection passed. Stripe Connect event subscriptions, provider dashboard URLs, signing-secret correspondence and provider-originated successful/retried delivery remain unverified. The worker supplies polling, but it polls pending new holds; it does not prove reversal delivery for completed payouts or historical repair.

## Client compatibility and release state

| Check | Web | Android | iOS |
|---|---|---|---|
| Current JavaScript bundle export | **PASS** | **PASS — Hermes** | **PASS — Hermes** |
| Local native compilation | N/A | **PASS — ARM64 debug APK, offline** | **PASS — unsigned x86_64 simulator Debug** |
| Actual funding callback compatible | **FAIL in shared flow** | **FAIL in shared flow** | **FAIL in shared flow** |
| Server-authoritative funding success UI | **FAIL** | **FAIL** | **FAIL** |
| Device/browser/provider runtime acceptance | **NOT VERIFIED** | **NOT VERIFIED — no connected device** | **NOT VERIFIED — no booted simulator/device** |
| Updated client published by this audit | **NO** | **NO** | **NO** |
| Final production compatibility sign-off | **FAIL** | **FAIL** | **FAIL** |

The public events-site bundle was also read without execution. It lacks all three new withdrawal retry/idempotency markers checked in the local export and still contains the old bank-save error path. This confirms that the currently served events client does not contain the reviewed wallet-store update. See `published-client-markers.json`.

Compilation is not device/provider acceptance. The old clients' direct bank writes remain intentionally denied by deployed RLS. Shipping the current local clients unchanged would also retain the reproduced funding defects. Node backend initialization/welcome changes remain local and cannot be certified as deployed to an independently hosted Node service.

Native build scope/results are finalized in `native-build-results.json` and the completion addendum below. The initial broad all-architecture builds were interrupted to focus on ARM64 Android debug and an unsigned x86_64 iOS simulator build. No app was installed or launched. No store/release signing was attempted.

## Operational blockers and historical state

These are aggregate read-only production counts; customer/bank details were not exported.

- **Historical withdrawals:** 39 request rows: **20 pending, 19 failed**. **21 legacy owner-withdrawal ledger rows** lack new holds: **20 pending, 1 completed**. These are separate counts, not proof of one-to-one matching. The new worker has zero hold rows to process and will not reconstruct this history. Provider references, actual transfer status, ledger debits/releases and wallet reconciliation must be audited before any repair. No historical row was updated.
- **Bank enrollment:** zero server bank rows; **19 Auth accounts carry legacy bank metadata**; zero trusted Stripe Connect links in app metadata. Legacy metadata cannot be promoted to verified server bank records without provider-backed verification. Legitimate users need trusted enrollment/reverification/onboarding.
- **Refund completion:** zero pending/recorded guest refunds in the snapshot, so a live backlog is not established. Current code clears `refund_pending` when a refund ID is obtained. Later failed/completed provider refund state is not demonstrated by this acceptance run. Stripe refund handling needs implementation/scope confirmation.
- **Email delivery/recovery:** zero claimed-unsent welcome/guest messages were present. That does not clear the reproduced future welcome-retry defect or ambiguous-send recovery limitation. Real email ownership and delivery still need a non-customer test inbox.
- **Provider-rejected or not-created payouts:** uncertain holds remain reserved by design. Handling of definitive rejection/not-found cases and an operator investigation workflow still needs acceptance. Stripe attempts lacking provider IDs after 23 hours require investigation rather than new object creation; Stripe [documents key pruning after at least 24 hours](https://docs.stripe.com/api/idempotent_requests).
- **Public web hardening:** Public header checks on the main/www sites found **no CSP, X-Frame-Options or Permissions-Policy**. HSTS, MIME and referrer protection were present there. The events site's inspected responses lacked all six checked headers. Local `vercel.json` is not a published configuration and may not govern the separate events host.
- **Code health:** **797 explicit `any` nodes and 27 suppression comments** remain in the 308-file scope. New payout code is typed, but repository-wide decomposition/typing is incomplete. No change in the broad debt count was made during this audit.
- **Environment/release evidence:** configured Supabase secret names and SMTP settings are not validation of provider test mode, webhook dashboard configuration, host build variables, release signing, device behavior or email delivery. These remain gates.

## Evidence and reproduction

Current audit artifacts are under ignored `build/production-readiness-20261122/`. They are separate from the previous rollout evidence.

| Evidence | What it supports |
|---|---|
| `local-checks.json`, `tests.log`, `typecheck.log`, `lint.log`, `secrets.log` | Existing **234 Node tests**, strict app/backend typing, lint and source secret scan all pass |
| `deno-types.log` | Critical Edge dependency graph typecheck passes |
| `client-exports.log`, `client-exports/metadata.json` | Current web + Android + iOS JavaScript exports pass |
| `production-readonly.json`, `production-extra.json` | Current deployment metadata, restrictions, Auth config, aggregate history and passive worker responses |
| `sql-source-match.json`, `lookup-readonly.json` | Eight hosted SQL bodies match remediation migrations; live lookup index plan and case/missing checks |
| `http-verification.json`, `worker-health.json` | 40 safe live checks and health-only authentication |
| `web-headers-cors.json`, `web-get-headers.json` | Actual HEAD/GET public security headers and CORS behavior |
| `executable-markers.json`, `source-download.log` | Five hosted executable-marker checks; limitation on full source unbundling |
| `published-client-markers.json` | Current served events-site client lacks the new withdrawal markers and retains old bank-save code |
| `provider-readonly.json` | Secret-presence/mode-evidence limitations and SMTP presence; no provider mutation |
| `local-integration.json`, `local-integration.log` | Real local SQL and actual Edge lifecycle code, with Auth/providers explicitly stubbed |
| `edge-case-audit.json`, `edge-case-audit.log` | Ten failed and four passed additional readiness assertions |
| Native logs and `native-build-results.json` | Build scope/results, without device or release claims |

Audit scripts added for repeatability:

```sh
# No network: actual handlers/helpers with synthetic dependencies. Expected exit 1 while defects remain.
node scripts/audit-readiness-cases.cjs

# Newly created isolated LOCAL database only; never use a production connection.
TEST_DATABASE_URL=postgresql:///review_readiness_UNIQUE python3 scripts/test-database.py
TEST_DATABASE_URL=postgresql:///review_readiness_UNIQUE python3 scripts/test-withdrawals.py
TEST_DATABASE_URL=postgresql:///review_readiness_UNIQUE node scripts/test-readiness-pipeline.cjs
```

The pipeline script rejects any URL outside the local `review_readiness_` pattern. SQL tests cover all 57 migrations, OTP/RLS/settlement, 32 duplicate funding deliveries producing eight credits, and eight withdrawal reservations producing one hold. Provider calls in the integration script are synthetic in-process responses; real provider transport is not provided.

## Required closure before sign-off

1. Correct R1–R7 and add regression coverage that fails on the reproduced behaviors. Review welcome claim ownership and all failure-status helpers.
2. Establish a designated staging environment with verified Paystack/Stripe test-mode configuration and a non-customer inbox. Exercise success, cancellation, rejection, timeout, duplicate callback, failed refund and reversal end to end without real money.
3. Verify provider webhook subscriptions, signatures, Connect account scope, event replay and worker processing against synthetic staging records. Test completed-payout reversals as well as pending payouts.
4. Complete provider-backed historical withdrawal reconciliation and trusted bank enrollment/reverification. Prepare concrete repair plans before requesting authorization for any live data changes.
5. Retest current web/Android/iOS interactions, then obtain authorization before pushing/publishing releases or changing production configuration. Verify headers on each actual host after an authorized rollout.
6. Track the remaining code-health work and operational recovery tooling explicitly. Do not substitute the passing baseline suite or deployment status for these acceptance gates.

## Final native-build results

- **Android compilation PASS:** offline ARM64 `:app:assembleDebug`, exit 0, `BUILD SUCCESSFUL`. APK: `android/app/build/outputs/apk/debug/app-debug.apk`; SHA-256 is recorded in `native-build-results.json`.
- **iOS compilation PASS:** unsigned x86_64 simulator Debug build, exit 0, `BUILD SUCCEEDED`. App: `build/production-readiness-20261122/ios-derived/Build/Products/Debug-iphonesimulator/60Seconds.app`.
- **Runtime/provider compatibility NOT VERIFIED:** neither artifact was installed or launched. These are local Debug builds, not release archives or store acceptance. All three production compatibility gates remain **FAIL** for the functional and acceptance reasons above.

Final audit checks: `git diff --check` passes. `readiness-summary.json` records the overall **FAIL** verdict, scoped passes, missing evidence and absence of production mutations.
