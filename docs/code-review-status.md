# Code review remediation — 7 November 2026

The attached `60secondsplus-code-review.pdf` was handled from finding 14 toward finding 1, ignoring its suggested order as requested.

**All 14 findings were worked on. Twelve are addressed in code; two remain partially complete (#2 and #11). Supabase deployment is now completed for the linked 60Seconds project: 33 changed functions, six rollout migrations, and hosted Auth settings. See the deployment record below. Web/native releases, credential rotation and Git-history cleanup are outside this completed rollout.**

## Finding-by-finding result

| # | Finding | Local result | What changed / what remains |
|---|---|---|---|
| 14 | Tests and CI | Addressed | Added a GitHub Actions workflow for syntax/security lint, strict application/server typecheck, unit/regression tests, source secret scanning, full-history gitleaks, and PostgreSQL migration/security/settlement tests. Added recovery-session, tRPC authentication, account-identity, webhook-signature, retired-provider, configuration and CORS tests. SQL tests cover order replay, wallet funding, concurrent deliveries, OTP lockouts/replay/rate limits, private groups and ownership. Remote CI still needs to run; historical secret scanning is expected to flag old history until #2 is completed. |
| 13 | Excess payment providers | Addressed | Following your explicit choice, Stripe and Paystack remain enabled. Datatrans and Worldline procedures reject requests before their handlers run; client operations reject calls; the Datatrans Edge Function and Worldline HTTP webhook are retired. Historical provider types remain for old records and compatibility. Worldline is rejected by external settlement. |
| 12 | Repository clutter | Addressed | Moved four test/mock screens out of Expo Router into `dev/screens`, removed their stack registrations and obsolete test navigation, moved loose debug scripts into `dev/scripts`, archived old SQL in `dev/legacy-sql` and implementation notes in `docs/archive`. Generated exports/media/logs, nested backup repository, signing files and `.DS_Store` were moved to ignored `local-private/`. Updated ignore rules. Local copies are preserved, and generated media no longer ships from `public/`. |
| 11 | Weak typing / logging | **Partial** | Strict application/server typecheck now passes. Added a typed shared tab icon, corrected Supabase video/order types, nullable values, PromiseLike query handling, navigation types, country picker and UI style errors, and removed a mock-user fallback. Production client logging now goes through a development-only logger; verbose server/Edge logs are gated too. AST audit across app/components/hooks/lib/store/utils/backend/types: explicit `any` nodes decreased from **707 to 667**, and direct `console.log` calls from **324 to 0**. The PDF used a different scope/count. **667 explicit `any` type nodes remain; a complete domain-model typing refactor is unfinished.** Some reductions come from removing debug screens from production source. Logger calls are gated, not erased by a Babel transform. |
| 10 | Duplicated layouts | Addressed | Removed obsolete commented copies. Extracted shared icon rendering, styles and tab navigation options into `components/SharedTabs.tsx`. Regular layout: **1,888 → 168 lines**. Business layout: **1,932 → 235 lines**. Shared implementation: **102 lines**. Account-specific redirects, loading state, tab visibility and business behavior remain in their own layouts. |
| 9 | Unmanaged database schema | Addressed locally | Added a canonical baseline covering formerly manual table creation and missing fields; archived conflicting ad-hoc SQL. Repaired literal `\n` escapes in the old migration so it executes. All **45 ordered migrations** rebuild an empty local database. Tests found and repaired missing direct-message tables/payment columns and settlement wallet currency handling. The test bootstrap simulates Supabase auth/storage roles; actual hosted schema drift still requires review before rollout. |
| 8 | Leaking responses / logs / CORS | Addressed locally | Replaced wildcard CORS with a configured website allowlist and request-scoped headers. Removed raw error/stack/detail values from client-facing error payloads; tRPC hides internal error details and stacks. Provider diagnostic details stay server-side. Client logs are silent in production, verbose backend/Edge logs are development-only, and public account-enumeration calls were removed. Deleted the obsolete unauthenticated welcome-email simulation endpoint. |
| 7 | Weak OTPs | Addressed locally | Signup codes use `crypto.getRandomValues` with rejection sampling. Private, hashed code storage replaces public plaintext code matching. SQL serializes attempts, locks a code after five failures, consumes it once, expires it after ten minutes, and limits requests by email and IP. No new codes are stamped into user metadata. The migration removes legacy plaintext OTPs/metadata. Recovery uses Supabase Auth's built-in code/session flow and configured rate limits. |
| 6 | Weak RLS | Addressed locally | Enabled/replaced owner/member policies for core tables, products, groups, messages, wallets, payments and orders. Removed permissive legacy policies from affected tables. Revoked anonymous writes and dangerous TRUNCATE privileges. Storage writes require JWT ownership. Group users cannot self-enroll/promote themselves; read-time updates use column permissions. Clients cannot directly credit balances or insert ledger/payment records; settlement belongs to trusted server code. Existing client-only money mutations must use server-authorized flows after rollout. |
| 5 | Weak/default backend credentials | Addressed | Backend startup requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `PAYSTACK_SECRET_KEY`. Missing/placeholder values fail immediately. Removed anon-key downgrade/hardcoded JWT behavior and mock Paystack credential success. Removed server-secret fields from client-imported configuration/types. Disabled providers have no default secrets. |
| 4 | Forged Paystack webhook | Addressed locally | HTTP webhook checks HMAC-SHA512 over the exact raw body against `x-paystack-signature` using constant-time comparison, in every environment. Missing/malformed/mismatched signatures are rejected. The Edge webhook uses a constant-work comparison too. Retired the tRPC webhook alternative. The Hono endpoint forwards verified bytes to one authoritative Edge settlement implementation and returns a retryable error if settlement fails. Payment verification no longer independently mutates balances. Added atomic replay-safe wallet funding; SQL regression tests cover order replay too. |
| 3 | Unprotected tRPC | Addressed locally | Context validates bearer tokens with Supabase `getUser`. Protected procedures reject missing/invalid sessions. Account deletion uses the verified identity regardless of the supplied user ID; PDF/payment operations require authentication and ownership checks. Customer lookup uses the verified account email. The client sends its session bearer token. Only the harmless example route remains public; retired webhooks/providers reject requests. |
| 2 | Committed secrets | **Partial** | Removed embedded credential literals from current source and removed private files from deployable/tracked working paths. Added public-config generation, environment-based Maps/release-signing setup, `.env.example`, a source scanner, and a fresh-mirror history-cleanup script. **Credentials have not been rotated/revoked, Play signing has not been reset, and Git history/remotes have not been rewritten.** Current source scan passing does not invalidate previously exposed credentials. |
| 1 | Account takeover/reset | Addressed locally | Forgot-password uses `resetPasswordForEmail`; `verifyOtp({type:'recovery'})` establishes the user's session; password changes use `auth.updateUser({password})`. No caller-controlled UID/admin password mutation remains. Recovery codes are not passed in navigation URLs. Existing recovery deep links can establish a session through Supabase. `get-uid-by-email` and `update-password-by-uid` are inert HTTP 410 tombstones so deployment explicitly closes existing remote routes; delete the hosted functions after deploying/verifying the tombstones. Added a recovery email template and regression tests. |

## Validation

- `npm test`: **104 passed, 0 failed**.
- `npm run typecheck`: **passed**; covers the Expo application and Node backend. Deno functions have a different runtime and are excluded from this TypeScript program; their syntax is checked by lint, with selected handlers covered by regression tests. A full Deno typecheck was not run.
- `npm run lint`: **passed**; TypeScript syntax plus security rules for direct client logging, client references to server secrets and dynamic eval. This is a focused custom linter, not ESLint.
- `npm run scan:secrets`: **passed** for current tracked/new working source; does not scan old Git objects.
- `npm run build:web`: **passed**, exporting to ignored `dist/`.
- PostgreSQL: **45 migrations rebuilt successfully**, OTP/RLS/order replay/funding assertions passed, and **32 concurrent funding deliveries for 8 references produced exactly 8 credits**. Private-group and TRUNCATE assertions passed too.
- `git diff --check`: **passed**.
- Full-history gitleaks, hosted Supabase integration, real email delivery, live payment gateways, native iOS/Android builds and real-device smoke tests were **not run**.

## Remaining work

### Finding 2: external credential and history cleanup

1. Rotate/revoke exposed Stripe, Paystack, Cloudinary, SSH and Worldline credentials. Check any Supabase service-role/signing credentials that may have appeared in prior history. Rotate the Google Maps keys and restrict them to the Android package/signing certificate and iOS bundle ID. Review the archived Apple Pay private key/certificate for replacement as well.
2. Replace compromised Android upload/signing material. If Play App Signing is enabled, complete the upload-key reset through the account owner. Keep the new key outside the repository and supply its path/passwords via build environment variables.
3. Create a **fresh bare mirror clone** and run `bash scripts/purge-exposed-history.sh /absolute/path/to/fresh-mirror.git` with `git-filter-repo` installed. Inspect the result and scan every ref with gitleaks. Coordinate remote history replacement and collaborators' fresh clones. The script deliberately neither rewrites this dirty checkout nor pushes remotely. Inventory any other historic secret paths before running it; a regex scanner is not proof that every secret has been found.
4. Remove old artifacts/releases/caches that might contain exposed credentials. Preserve `local-private/` only as an access-controlled local recovery archive; none of its keys should be reused.

### Finding 11: remaining typing work

Replace the remaining 667 explicit `any` type nodes with domain models and validated boundary types, especially in wallet/payment stores, database adapters, legacy provider compatibility code and complex screens. Use generated Supabase database types reconciled with the hosted schema. Continue keeping strict typecheck green; do not hide this debt with blanket assertions or disabled checks.

## Production rollout checklist and remaining integrations

1. Commit/review these changes and configure CI. Finish credential rotation before releasing new builds. Never put service secrets in `EXPO_PUBLIC_*` settings.
2. Back up the hosted database and compare it with the canonical migrations. Existing projects may need migration-history reconciliation and `--include-all` for the newly added earlier baseline. Do not blindly reset or replay the database; `scripts/test-database.py` refuses nonempty databases and is only for disposable tests.
3. Apply the new OTP/RLS/atomic settlement migrations after validating against a hosted/staging Supabase instance. Test the app's money-management flows because direct client balance/ledger writes are now denied.
4. Deploy the changed Edge Functions, especially the two retired endpoint tombstones, `send-otp`, `verify-otp`, `paystack-webhook-settlement`, `settle-external-order-payment`, and the retired Datatrans function. Other changed functions share the new CORS/error/logging helpers and should be deployed together. Then remove the two retired hosted account endpoints.
5. Apply the Auth email template, ten-minute OTP expiry, resend frequency and token-verification rate limits in the hosted project. These settings are not updated merely by editing `supabase/config.toml`. Test signup, resend, recovery, expiry and replay with real email delivery.
6. Set exact `ALLOWED_ORIGINS` for every legitimate web/staging domain. Native requests do not require an Origin header.
7. Configure `SUPABASE_URL`, the service-role key and Paystack secret on the backend. Confirm signed webhook delivery and retries on staging. Datatrans/Worldline should reject calls throughout.
8. Set public build configuration and restricted Maps keys; configure new release signing. Run native builds and device smoke tests. Publish only after these checks and account-side actions are complete.

The existing unrelated editor settings were preserved. The prior password-reset edits were integrated into the session-based recovery replacement. No Git commit, web deployment or native release was made; the Supabase deployment is recorded below.


## Supabase deployment completed — 7 November 2026

Scope explicitly confirmed by the user: **Supabase functions, database and hosted Auth only**.

Project: **60Seconds**, `rvvujgbaswecqohixgog` (us-east-1).

- **33 changed Edge Functions deployed**, preserving the function JWT settings. All 33 pass live startup/CORS OPTIONS checks.
- **Six rollout migrations applied and recorded**: canonical baseline (`20250214000000`), secure OTP (`20261107090000`), storage/product/group RLS (`20261107100000`), core owner policies (`20261107110000`), atomic funding/settlement (`20261107120000`), and server-side wallet provisioning (`20261107130000`). Each change was rehearsed in a rollback-only production transaction before commit. Unrelated historical migrations were not replayed or marked applied.
- Production schema differences were corrected additively: missing order notes/video visibility fields and wallet provisioning. Published-only public video visibility is preserved. Wallet provisioning creates zero-balance rows server-side without granting clients balance-write privileges.
- Hosted Auth was updated and read back: **600-second email OTP expiry**, **six-digit codes**, **60-second resend interval**, **verification rate limit 5**, **minimum password length 8**, and the recovery email subject/template containing the code. Existing SMTP, confirmation behavior, site URL and redirect allowlist were preserved.
- Live HTTP checks: retired account lookup/password-update and Datatrans routes return **410**; invalid OTP requests return **400**; the Paystack webhook rejects unsigned requests with **401**. No test payments or user emails were sent.
- Live database checks confirm products/private OTP RLS is enabled; anonymous product writes/storage truncation and direct client wallet updates/OTP issuance/payment settlement are denied. Legacy plaintext OTP rows are cleared.
- A production startup check caught invalid destructuring assignments in two settlement functions. Both were repaired and redeployed. Lint now compiles source and checks the resulting JavaScript syntax, preventing the same issue from passing syntax-only TypeScript parsing.
- Validation after the corrections: **104 tests passed**, TypeScript passed, strengthened lint passed; all **45 migrations** rebuild locally and OTP/RLS/order replay/funding tests pass, including 32 concurrent deliveries producing exactly eight credits.
- Rollback artifacts are stored in ignored `local-private/deployment-20261107/`: previous function bundles, Auth settings, schema/policies/grants/function definitions and deployment verification. These are sensitive local artifacts and are not committed. This is a configuration/schema backup, not a full production data backup.

**CORS completed:** after explicit user approval, the hosted `ALLOWED_ORIGINS` setting includes `https://60secondsapp.io`, `https://www.60secondsapp.io` and `https://events.60secondsapp.io`. Live OPTIONS checks verified all three origins are allowed and an unrelated origin receives no allow-origin header. Verification is stored in `local-private/deployment-20261107/cors-verification.json`.

**Still outside this rollout:** remaining typing debt and credential/history cleanup; web/native client releases; end-to-end real-email and live-payment testing; remote CI execution. The Node/Hono backend was not deployed because the requested scope was Supabase only. Installed old clients may still reference retired reset endpoints and need the updated client release.


## Video watermark update — 9 November 2026

Replaced final-second/logo-only watermarking with an animated, semi-transparent logo + 60Seconds + creator handle burned throughout exported videos. Native share destinations and Save video now use the same required branded export; failures never fall back to sharing the raw source. Legacy export caches are bypassed. The preview follows the same corner timeline.

Validation: **156 automated tests passed**, TypeScript/lint passed, Android native module compiled, and the production iOS exporter generated checked portrait/rotated/short files in the simulator. FFmpeg output checks verify corner visibility, source dimensions/frame rate/duration/background and identical AAC audio. The complete iOS app build was stopped during dependency compilation; physical-device/social-app checks and new native releases remain. Implementation and test details: [video-watermark.md](video-watermark.md).

## Voucher checkout update — 11 November 2026

Shared mobile checkout now uses server pricing, direct zero-payment fulfillment, atomic voucher consumption/entitlements and verified provider settlement. Database concurrency and failure-recovery checks pass. See [voucher-checkout-fix.md](voucher-checkout-fix.md) for files, validation and release steps. Production audit now covers all 46 orders through an authorized dedicated read-only login. Order #0000019 has no saved voucher discount, is pending at NGN 1,040, and has no ticket; Paystack verification returned HTTP 403. Production schema/legacy compatibility blockers prevent deployment or automatic repair. See [voucher-production-readiness.md](voucher-production-readiness.md) for verified findings and go-live gates.


## Voucher production-readiness continuation — 11 November 2026

Forward schema bridge, verified fulfillment guards, atomic guest settlement and durable voucher checkout retries are implemented and locally tested. Workspace Node suite: 169 passed; focused release suite: 105 passed; SQL upgrade/rollback/concurrency and Android/iOS bundle exports passed. Production remains NO GO pending clean baseline integration, provider/cloud staging and actual device verification. Historical orders remain unchanged. See [readiness](voucher-production-readiness.md), [release scope](voucher-release-scope.md) and [procedure](voucher-release-procedure.md). The focused source lives on branch `voucher-production-readiness-20261111`; this main worktree preserves unrelated pending work.
