# Paystack Split Payment Validation (Insomnia)

This runbook validates the Paystack split flow described in:
- https://support.paystack.com/en/articles/2132802

Key rule enforced in app code:
- Use `subaccount` for one organizer/subaccount split.
- Use `split_code` only for split groups (multiple subaccounts).
- Do not send both in the same initialize request.

Insomnia import asset created in repo:
- [insomnia/paystack-split-live-workspace.json](insomnia/paystack-split-live-workspace.json)

Import steps:
1. Open Insomnia desktop app.
2. `Create` -> `Import` -> `From File`.
3. Select `insomnia/paystack-split-live-workspace.json`.
4. Fill environment variables (`PAYSTACK_SECRET_KEY`, `SUBACCOUNT_CODE`, `SPLIT_CODE`, etc).

## 1) Insomnia Environment

Create an Insomnia environment with:

```json
{
  "PAYSTACK_BASE": "https://api.paystack.co",
  "PAYSTACK_SECRET_KEY": "sk_test_xxx",
  "TEST_EMAIL": "buyer@example.com",
  "SUBACCOUNT_CODE": "ACCT_xxx",
  "SPLIT_CODE": "SPL_xxx",
  "CALLBACK_URL": "myapp://paystack/callback"
}
```

Global headers for Paystack requests:

- `Authorization: Bearer {{ PAYSTACK_SECRET_KEY }}`
- `Content-Type: application/json`

## 2) Single Organizer Split (Required for your NG organizer flow)

Request:
- `POST {{ PAYSTACK_BASE }}/transaction/initialize`

Body:

```json
{
  "email": "{{ TEST_EMAIL }}",
  "amount": 250000,
  "currency": "NGN",
  "reference": "single_sub_{{ _.now }}",
  "callback_url": "{{ CALLBACK_URL }}",
  "subaccount": "{{ SUBACCOUNT_CODE }}",
  "transaction_charge": 10000,
  "bearer": "account",
  "metadata": {
    "paymentType": "order_payment",
    "split_mode": "single_subaccount"
  }
}
```

Expected:
- `status: true`
- `data.authorization_url` exists
- Charge appears as split between main account and the subaccount.

## 3) Split Group (Multiple Subaccounts)

Request:
- `POST {{ PAYSTACK_BASE }}/transaction/initialize`

Body:

```json
{
  "email": "{{ TEST_EMAIL }}",
  "amount": 250000,
  "currency": "NGN",
  "reference": "split_group_{{ _.now }}",
  "callback_url": "{{ CALLBACK_URL }}",
  "split_code": "{{ SPLIT_CODE }}",
  "metadata": {
    "paymentType": "order_payment",
    "split_mode": "split_group"
  }
}
```

Expected:
- `status: true`
- split follows dashboard split-group formula.

## 4) Negative Test (Must Fail in your QA checklist)

Send BOTH fields (this is what we now prevent in code):

```json
{
  "email": "{{ TEST_EMAIL }}",
  "amount": 250000,
  "currency": "NGN",
  "reference": "invalid_both_{{ _.now }}",
  "subaccount": "{{ SUBACCOUNT_CODE }}",
  "split_code": "{{ SPLIT_CODE }}"
}
```

Expected:
- Do not use this in production.
- Behavior can be ambiguous; this is exactly what was fixed in app code.

## 5) Verify Transaction

Request:
- `GET {{ PAYSTACK_BASE }}/transaction/verify/:reference`

Use the `reference` returned from initialize.

Expected:
- `status: true`
- `data.status: "success"` for successful charge.

## 6) Withdrawal Validation for Organizer

In app behavior, organizer withdrawal for NG currently uses the Paystack transfer path.

Validation steps:
1. Complete a successful charge with organizer split.
2. Confirm organizer can see withdrawable balance in app.
3. Trigger withdraw in app.
4. Confirm transfer is created in Paystack payout/transfer logs.

If transfer fails due low transfer balance, top up Paystack transfer balance and retry.

## 7) App Endpoint Validation (Optional)

You can also test your own edge function endpoint that the app uses (`paystack-initialize`) and verify it forwards exactly one split mode:

Body for single organizer:

```json
{
  "email": "buyer@example.com",
  "amount": 2500,
  "currency": "NGN",
  "subaccount": "ACCT_xxx",
  "transaction_charge": 100,
  "bearer": "account",
  "paymentType": "order_payment",
  "metadata": {
    "orderId": "test-order-id"
  }
}
```

Expected:
- Request payload sent to Paystack contains `subaccount` only.
- `split_code` omitted when `subaccount` exists.
