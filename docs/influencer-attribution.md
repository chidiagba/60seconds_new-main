# Influencer attribution deployment notes

## Current application behavior

- The app stores the first valid referral locally across restarts. A later direct link does not replace it; a code entered in the signup form is a deliberate override.
- Supported referral syntax is 3–40 ASCII letters, digits, `_`, and `-`; lookup against the active campaign registry is authoritative.
- The existing email signup service records a referral against the newly created auth user and enqueues one outbox row. Organic signups and existing-user login paths do not create attribution rows.
- A server-only outbox worker is implemented in `supabase/functions/report-influencer-registrations`. It sends the supplied GET query contract only when `SIGNUPT_API_CONTRACT_VERIFIED=true`; it requires `SIGNUPT_API_KEY` and `INFLUENCER_OUTBOX_WORKER_SECRET`. Those values are not configured here. The worker treats only a 2xx JSON `{ "success": true }` as success, and records timeouts/unrecognized responses as `unknown` without replay. That success-body shape still requires SignupT confirmation.
- Deterministic 4xx failures are stored as `failed` and are not automatically retried. An operator may requeue them after correcting the cause. Ambiguous outcomes require SignupT reconciliation before any replay.

## External configuration required

1. Rotate the exposed SignupT key, then set the new value as the Supabase Edge Function secret `SIGNUPT_API_KEY` only after SignupT confirms its request contract. Do not set an `EXPO_PUBLIC_` variable.
2. Ask SignupT to confirm the `/r/otown-40rq` campaign redirect behavior, Android Play Store referrer preservation, API request body/method, authentication field, response schema, idempotency or duplicate behavior, and reporting/dashboard refresh delay. Available web inspection could not load the supplied URLs or find authoritative API documentation.
3. For Android install attribution, configure the SignupT redirect to preserve `ref=otown-40rq` in Google Play's `referrer` parameter for package `app.sixtyseconds.nightlife`, then add and release a native Google Play Install Referrer integration. This repository has not yet included that SDK.
4. For iOS deferred attribution, choose/configure an attribution provider. No provider exists in this app. A Branch integration needs a Branch account/domain/key, an approved SignupT link integration, associated-domain configuration, and current Expo native SDK compatibility review; it has not been installed or configured here.
5. App links require domain ownership. For `60secondsapp.io`, publish the Android `assetlinks.json` with the release signing SHA-256 certificate and an Apple `apple-app-site-association` file for `app.sixtyseconds.nightlife`, then configure Android intent filters and iOS associated domains. The team does not control `signupt.com` association files.
6. Deploy the migration and Edge Functions only after review. Configure a protected scheduled invocation of `report-influencer-registrations` using `INFLUENCER_OUTBOX_WORKER_SECRET`; do not set the contract-verification flag until SignupT confirms the method and success response. Ambiguous timeouts enter `unknown` for reconciliation rather than automatic retries.

## Validation boundaries

Automated parsing tests do not verify Play Store installs, iOS deferred matching, provider dashboard reporting, or native release builds. Use clean devices and the release distribution paths described in the implementation task before enabling campaign reporting.

## Supabase deployment record

- Project `rvvujgbaswecqohixgog`: deployed `20261113130000_campaign_attribution` and `20261113190000_atomic_campaign_signup_attribution` through the Supabase Management API, then recorded both versions in `supabase_migrations.schema_migrations`.
- Verified remotely: the three attribution tables exist with RLS enabled; the `60seconds_OTown` / `otown-40rq` campaign is active; attribution RPCs are executable only by `service_role`; the auth-user trigger is present.
- Deployed Edge Functions: `create-signup-user`, `verify-otp`, and `report-influencer-registrations`.
- Other missing migration versions remain pending in the remote project. They were intentionally not replayed because they include unrelated changes.
- SignupT reporting remains disabled. The project has no `SIGNUPT_API_KEY` or `INFLUENCER_OUTBOX_WORKER_SECRET` configured, and the pasted API key must be rotated. Set `SIGNUPT_API_CONTRACT_VERIFIED=true` only after SignupT confirms its success response and duplicate semantics.
