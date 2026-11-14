# rork-60seconds
Created by Rork
# 60Seconds
# 60Seconds
# 60secondsplus

## Paystack setup

For the app locally, set these values in [.env.local](.env.local):

```bash
EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY=your_paystack_public_key
PAYSTACK_SECRET_KEY=your_paystack_secret_key
```

For Supabase Edge Functions, set the secret in the Supabase project environment as well, because edge functions do not read your local `.env.local` file:

```bash
supabase secrets set PAYSTACK_SECRET_KEY=your_paystack_secret_key
```

If you use the Supabase dashboard instead of the CLI, add `PAYSTACK_SECRET_KEY` under your project secrets for Edge Functions.

The Nigerian bank dropdown now loads from the live Paystack bank list through the `paystack-bank-list` edge function, so the bank list stays current.

For production webhook rollout and historical wallet balance reconciliation, see [PAYSTACK_WEBHOOK_DEPLOY_AND_BACKFILL.md](docs/archive/PAYSTACK_WEBHOOK_DEPLOY_AND_BACKFILL.md).

## Real device launch from terminal

Android:

```bash
# Build + install on connected real device
npm run android:device -- <ANDROID_SERIAL>

# Launch already-installed app
npm run android:launch-device -- <ANDROID_SERIAL>
```

iOS:

```bash
# Build + install on connected real iPhone
npm run ios:device

# Launch already-installed app by UDID
npm run ios:launch-device -- <IOS_UDID>
```

If iOS launch tooling is missing, switch to full Xcode developer tools first:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```
# 60seconds_new_2.0
# 60seconds_new-main
# 60seconds_new-main


## Validation and review fixes

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run scan:secrets`.
For SQL checks, point `TEST_DATABASE_URL` at a dedicated empty PostgreSQL database and run `python3 scripts/test-database.py`. This rebuilds all migrations and checks OTP limits, RLS, order settlement replay, and concurrent wallet funding. The bootstrap simulates Supabase auth/storage roles for local regression tests; hosted integration checks remain necessary.

Only Stripe and Paystack are enabled. Datatrans and Worldline endpoints reject requests. Copy `.env.example` to your local environment and configure server credentials separately from public build settings. Google Maps and Android release signing are supplied through build environment variables.

Use `supabase/migrations/` for database changes. `dev/legacy-sql/` and `docs/archive/` retain historical reference material. Never deploy archived SQL scripts.

See [the code review completion report](docs/code-review-status.md) for all fourteen findings and production rollout steps.
