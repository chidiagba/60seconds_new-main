> Updated verification (11 November 2026): see [production readiness](voucher-production-readiness.md) and [release procedure](voucher-release-procedure.md). The implementation summary below predates the forward schema bridge and verified-fulfillment hardening.

# Voucher checkout implementation — 11 November 2026

## Verified findings

The old cart always opened a payment provider, including when its client-calculated total was zero. Voucher eligibility/pricing was duplicated across client and server; legacy percentage fields were not consistently understood. Usage updates and JavaScript ticket issuance were separate operations. Those defects explain possible pending free purchases and inconsistent counters, but **do not establish the exact history of production order #0000019**.

NGN 1,040 is the existing marked price of a NGN 1,000 item (4% service markup). The corrected 100% voucher covers the entire marked price: original 1,000 + markup 40 − discount 1,040 = zero. Partial discounts apply to that same marked price.

## Scope and files

- `supabase/migrations/20261111090000_atomic_voucher_checkout.sql`: authoritative quote, private checkout snapshots/reservations, server creation, atomic fulfillment/settlement/release, trusted zero-checkout recovery, voucher restrictions, immutable counters, realtime publication and grants.
- `supabase/functions/paystack-create-order-checkout/index.ts`: creates/reuses the canonical order and initializes Paystack from its stored amount; zero payments bypass gateway initialization.
- `supabase/functions/paystack-webhook-settlement/index.ts` and `settle-external-order-payment/index.ts`: verified canonical payments use the shared database finalizer.
- `supabase/functions/stripe-create-checkout/index.ts`, `stripe-confirm-and-settle/index.ts`, `_shared/checkout-stripe.ts`: create before payment, bind a single PaymentIntent, verify buyer/reference/amount/currency before settlement.
- `supabase/functions/guest-checkout-webhook/index.ts`: signed Stripe PaymentIntent success/cancellation handling in addition to the existing guest session events.
- `supabase/functions/checkout-reconcile/index.ts` and `supabase/config.toml`: authenticated customer status checking and provider-verified recovery/cancellation.
- `app/cart.tsx`, `components/ProductsList.tsx`, `components/PaystackWebView.tsx`, `lib/stripe-payment-sheet-session.ts`: common checkout route, server quotes, stable retry key, direct free checkout and no canonical fallback to client-priced Stripe initialization.
- `store/voucher-store.ts`, `types/index.ts`, `components/ApplyVoucherModal.tsx`, `VouchersList.tsx`, `BusinessVouchersSection.tsx`: server validation, stale-validation protection, management refresh, currency/restriction/remaining-usage presentation.
- `app/order/[id].tsx`: live order/receipt refresh, zero-safe totals, transparent original-price/markup/discount breakdown and payment-status checking.
- `components/chat/MessageNotificationBridge.tsx`: purchase notifications open the relevant order.
- `scripts/audit-checkout-orders.ts`: paginated, read-only audit of every order, receipts, payment records, redemptions and voucher counts; explicitly highlights #0000019 and HJSDGUBY. No mutation or automatic counter reset.
- `tests/voucher-checkout.sql`, `scripts/test-voucher-checkout.py`, `tests/voucher-payment-handlers.test.cjs`, `tests/notification-routing.test.cjs`: database, concurrency, verification and notification regression checks.

## Corrected behavior

`quote_order_checkout` reads current products, organizer, currency, event eligibility and voucher restrictions. It validates active/expiry/minimum/caps/product/event/category/customer/per-user/global capacity. The client never supplies an authoritative discount or price.

`create_order_checkout` serializes a customer's request key and voucher capacity, locks stock/event capacity, stores immutable priced items and reserves availability. Duplicate requests return the same order. A final payable amount of zero immediately records a paid voucher order, completed internal zero-value payment, redemption, unique ticket QR(s), sold quantity and one notification in a single database transaction. No provider is called.

For positive amounts, payment status remains pending and usage is reserved, not consumed. Only provider verification with matching reference, amount and currency calls `finalize_checkout_payment`. Wallet ledger, payment, order, redemption and entitlements commit together. Webhook/confirmation replays are idempotent. Ticket quantities create separate receipts and QR codes; other purchases create a quantity-bearing product receipt.

The existing lifecycle is preserved: **paid + open** means purchased and available for scanning. `completed` means receipts have been redeemed. Changing a free purchase directly to completed would falsely indicate use.

A provider-verified failure/cancellation releases the reservation once without consuming usage. A closed browser, processing payment or Paystack abandoned status is not proof of failure and does not release a potentially paid reservation. Refunds invalidate receipts but retain lifetime voucher consumption; no undocumented redemption restoration policy was invented.

`recover_zero_checkout_order` is service-only and requires the private trusted zero-total snapshot, voucher association and internal reference, with no external provider attempt. It cannot convert an arbitrary legacy NGN 1,040 order into a free purchase merely because a code was supplied afterwards. Legacy ambiguous orders require an evidence-based authorized repair.

## Verification

- Node regression suite: 161 passed, zero failed.
- TypeScript, source lint and embedded-secret scan passed.
- All ordered migrations rebuilt in a fresh disposable PostgreSQL database; auth/RLS/payment regression checks passed, including 32 concurrent funding deliveries yielding exactly eight credits.
- Real SQL checkout assertions verify full/partial discounts, invalid/inactive/expired/exhausted/restricted/customer/per-user/minimum eligibility, verified amount checks, payment replay, failed/cancelled releases, unique multi-ticket issuance, ledger balance, trusted recovery and rollback of injected ticket-insertion failure.
- Concurrent sessions: 16 attempts for the final voucher slot yield one order/redemption/ticket; 16 attempts for the final stock unit yield one reservation.
- Customer/owner table reads are checked through authenticated RLS, including denial of another customer’s tickets. Explicit receipt RLS and read grants are included. Screen focus/realtime refresh is implemented; physical Android/iOS payment UI and live provider webhooks have not been exercised in this environment.

Reproduce on a dedicated empty database:

```sh
TEST_DATABASE_URL=postgresql://... python3 scripts/test-database.py
TEST_DATABASE_URL=postgresql://... python3 scripts/test-voucher-checkout.py
npm test
npm run typecheck
npm run lint
npm run scan:secrets
```

The concurrency runner intentionally leaves its fixtures in that disposable database for inspection; use a fresh database for another full run.

## Production verification update — 11 November 2026

The production audit is now complete through the existing supported Supabase CLI connection and a newly authorized dedicated SELECT-only login. Its private, gitignored connection is configured in `.env.voucher-audit.local`. No application migration, function deployment or business-record repair was performed. Only the requested audit role, grants and role-specific read policies were provisioned.

**Production release is blocked.** The actual production schema differs from the clean rebuild and is missing prerequisite migrations/columns. Tests reproducing production's existing receipt INSERT policy also expose a legacy fulfillment/usage gap. Do not apply the new migration alone or blindly replay all older migrations.

**Order #0000019 is audited and unchanged:** NGN 1,000 subtotal + NGN 40 fee = NGN 1,040; saved voucher association is null, saved discount is zero, payment and order are pending, the initialized Paystack reference exists, and no ticket exists. HJSDGUBY is active at 100% and 0/100. There is no redemption table in production. Paystack verification was authorized and attempted but returned HTTP 403; no successful payment is established. The event ended November 1. Automatic free-order repair is not justified by the saved evidence.

See [voucher-production-readiness.md](voucher-production-readiness.md) for exact audit evidence, the credential-access resolution, migration/compatibility blockers, conditional repair criteria, deployment order, rollback and smoke tests. See [voucher-release-manifest.json](voucher-release-manifest.json) for the uncommitted file inventory and release-source hashes.
