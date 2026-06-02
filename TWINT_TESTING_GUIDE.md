# TWINT Complete Testing Guide

## Overview
This project now uses a real TWINT checkout initialization + verification flow through the Worldline gateway:
- `ProductsList.tsx`: product-level TWINT checkout
- `cart.tsx`: cart-level TWINT checkout
- Order is created as `pending` first
- Payment is marked `paid` only after Worldline verify returns `SUCCESS`

## Required Configuration
Set backend environment values before testing:

- `WORLDLINE_MERCHANT_ID`
- `WORLDLINE_API_KEY`
- `WORLDLINE_BASE_URL`

Recommended sandbox value:
- `WORLDLINE_BASE_URL=https://payment.preprod.direct.worldline-solutions.com/v2`

Production value:
- `WORLDLINE_BASE_URL=https://payment.direct.worldline-solutions.com/v2`

Optional mobile callback base (defaults already handled):
- `NEXT_PUBLIC_APP_URL=myapp://payment`

## Test Payment Details
Use your Worldline sandbox test credentials and TWINT sandbox account from your Worldline dashboard.

If your tenant supports card-based fallback in sandbox, this commonly used test card may work for hosted test pages:
- Card Number: `4111 1111 1111 1111`
- Expiry: any future date (for example `12/30`)
- CVV: `123`

Important:
- Exact test payment instruments vary by Worldline account/region.
- If the above card does not work in your environment, use the payment methods shown in your Worldline sandbox portal.

## How To Test ProductList TWINT Flow
1. Open a product in ProductList and tap `Buy Now`.
2. Select `Twint`.
3. Confirm checkout initialization alert.
4. Complete payment in TWINT app or WebView checkout.
5. Tap `Verify Twint Payment`.
6. Expect:
- Success alert shown
- Order `payment_status` updated to `paid`
- Order `status` updated to `completed`
- Ticket receipt generation attempted

## How To Test Cart TWINT Flow
1. Add products to cart.
2. Choose `Twint` as payment method.
3. Continue and complete checkout in TWINT app/WebView.
4. Tap `Verify Twint Payment`.
5. Expect:
- Success alert shown with order id
- Order marked paid/completed only after verify success
- Cart cleared after successful verification

## Troubleshooting
- `Twint initialization failed`:
  - Check backend is running and reachable
  - Check Worldline env keys are valid
  - Check `WORLDLINE_BASE_URL` matches your environment

- `Twint payment is PENDING/FAILED/CANCELLED`:
  - Payment was not completed on gateway side yet
  - Complete payment in checkout then tap verify again

- Callback not returning to app:
  - Verify app deep link scheme is configured (`myapp://`)
  - iOS TWINT app detection requires `LSApplicationQueriesSchemes` includes `twint` (already configured)

## Quick Verification SQL
Use this in Supabase SQL editor after a test payment:

```sql
select id, payment_status, status, payment_method, payment_provider, updated_at
from orders
order by updated_at desc
limit 10;
```
