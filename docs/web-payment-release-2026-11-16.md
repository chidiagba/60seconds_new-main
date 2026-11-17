# Shared-event web payments — 16 November 2026

Published to https://events.60secondsapp.io using the existing authorized
Bluehost/cPanel Chrome session. The existing index and rewrite rules were backed
up. Uploaded assets were checked individually over HTTPS (45 matching SHA-256
hashes) before replacing index.html. Old hashed assets and authentication pages
were retained. Browser requests confirmed `/`, `/:eventId`, and
`/web-event/:eventId` return HTTP 200 and the exact released index hash.

## Behavior

The shared event page accepts tickets, products, individual table seats and
exclusive whole tables through the existing server-priced reservation system.
Buyers explicitly select Nigeria or Other country; nationality is not guessed.
Nigeria + NGN offers Paystack card or bank transfer. Other country offers Stripe
card, including when the event is priced in NGN. Non-NGN events use Stripe even
for a Nigerian buyer; no currency conversion or re-pricing is invented.

A browser selection becomes an enforced Paystack channel or Stripe card session.
Stripe follows the existing mobile settlement approach: destination charges for
configured connected accounts; otherwise platform collection with the verified
guest owner-wallet ledger. Existing mobile and legacy web checkout branches are
preserved. No existing order/payment/receipt records were modified by deployment.

New web-only attempts use a random UUID bearer token and an atomic service-only
reservation wrapper. Identical retries reuse one reservation; changed terms are
rejected. Uncertain provider initialization remains pending for reconciliation,
rather than releasing inventory or starting another charge. The browser stores
its attempt in session storage and includes it in provider return URLs. The
Check payment status action rechecks the bound provider session; redirects and
`purchased=1` do not prove payment. Confirmed payments use the existing verified
settlement, QR issuance and email delivery functions.

## Deployment

Applied additive migration `20261116170000_web_checkout_attempts.sql` after a
live-schema rollback rehearsal. The table has RLS and no anon/authenticated
privileges; its reservation RPC is service-role only.

Deployed ACTIVE functions:

| Function | Version |
| --- | --- |
| guest-event | 24 |
| stripe-create-checkout | 65 |
| stripe-confirm-and-settle | 26 |
| guest-checkout-webhook | 18 |
| guest-checkout-reconcile | 21 |
| paystack-webhook-settlement | 38 |

No provider keys or live/test modes were changed. Webhook signatures and worker
authentication remain enforced. Shared links use the production HTTPS origin,
so subsequent app releases retain the same hosted checkout destination. Android
and iOS Hermes release exports passed; app-store distribution was not performed.

## Evidence and limits

- 220 Node tests passed, zero failures/skips. TypeScript, lint and secret scan passed.
- Web production export and Android/iOS release exports passed.
- SQL mixed-basket tests passed: server totals, inventory holds, retries, changed
  terms, no unpaid fulfillment and service-only permissions.
- Six concurrent retries produced one order, one stock decrement and one table
  hold; five requests safely reused the first reservation.
- Isolated browser acceptance exercised both provider handoffs, pending recovery,
  false-success redirect protection and verified confirmation with mocked payments.
- Live public webpage renders real event data with Paystack choices for Nigeria
  and Stripe card for Other country; no page alerts were present.
- Live checks verified invalid routing requests reserve nothing, forged status
  tokens fail, browser CORS works, unsigned webhooks fail and Stripe auth holds.
- No live checkout/payment was submitted during this release. A real successful
  charge and receipt-email delivery remain an acceptance test for the owner.

Evidence, deployment hashes, screenshots and hosting rollback entry point:
`build/web-checkout-verification/`. The payment provider documentation consulted
was https://paystack.com/docs/api/transaction/ and https://docs.stripe.com/currencies.
