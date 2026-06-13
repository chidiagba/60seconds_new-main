# Paystack Webhook Deploy And Balance Backfill

This rollout ensures:

- New Paystack purchases credit business/product owner wallets correctly.
- Platform fee remains on the platform side.
- Existing historical purchases are backfilled so wallet balances become correct.
- Android and iOS users see the same updated wallet balance because balance is stored centrally in Supabase.

## 1. Deploy Backend With Webhook Settlement

Deploy your backend service that serves [backend/hono.ts](backend/hono.ts#L781) with the route:

- `POST /api/paystack/webhook`

Your live API base URL must include this route in production.

Example live webhook URL:

- `https://your-api-domain.com/api/paystack/webhook`

## 2. Configure Paystack Dashboard Webhook URL

In Paystack Dashboard:

1. Go to Settings -> API Keys & Webhooks.
2. Set Webhook URL to your live backend endpoint:
3. `https://your-api-domain.com/api/paystack/webhook`
4. Save and test a webhook event.

If Paystack does not call this production URL, settlement will not happen.

## 3. Ensure Required Production Env Vars

Backend runtime must have:

- `EXPO_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYSTACK_SECRET_KEY`

Without these, webhook settlement cannot write wallet/transaction updates.

## 4. Backfill Existing Purchases (One-Time)

Run this one-time script in production context to credit missing historical settlements:

```bash
npm run backfill:external-settlements
```

The script is [scripts/backfill-external-order-wallet-settlements.ts](scripts/backfill-external-order-wallet-settlements.ts).

It:

- Finds external payment orders (Paystack/Twint/Worldline) that are paid/completed or have ticket receipts.
- Skips already settled orders (idempotent check).
- Inserts `owner_credit` transaction and updates owner wallet balance.
- Inserts matching buyer ledger debit entry.

## 5. Verify In Database

After deployment and backfill, confirm for a sample order:

1. `transactions` has an `owner_credit` row with `metadata.order_id`.
2. `transactions` has `platform_fee_amount` and `net_amount` metadata.
3. Owner `wallets.balance` increased by settlement `net_amount`.

## 6. Android And iOS Visibility

No platform-specific payment logic is needed for the wallet display update.

Both apps read the same Supabase wallet/transaction data. Once backend/backfill completes:

1. Ask users to reopen app or pull-to-refresh wallet screen.
2. If stale cache persists, sign out and sign in once.

## 7. Withdrawal Confirmation

Nigerian business withdrawals already go through Paystack direct transfer:

- [store/wallet-store.ts](store/wallet-store.ts#L1988)
- [supabase/functions/paystack-direct-transfer/index.ts](supabase/functions/paystack-direct-transfer/index.ts#L149)

After settlement/backfill, owners can withdraw from the credited wallet balance.
