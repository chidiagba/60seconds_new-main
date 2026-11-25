# Voucher creation fix — 22 November 2026

The supplied screenshot's permission error came from a client INSERT containing `usage_count: 0`. The live catalog confirms authenticated clients may insert voucher terms and ownership fields but cannot write `usage_count`, generated IDs or timestamps. `usage_count` already defaults to zero. This is a column-permission mismatch, not evidence that the business account needs broader access.

`voucherService.createVoucher` now omits generated fields and the redemption counter, sets `creator_id` from the authenticated identity, and uses the same safe payload for the legacy-schema fallback. Session, business-profile and `business_id` ownership checks remain. No database grants, policies or production records were changed.

App version is **115.0.5**, Android version code and iOS build number **119**, synchronized in `app.json`, Android Gradle, iOS Info.plist and both Xcode configurations.

Validation: **238 Node tests passed**, including four new service regressions; TypeScript and source lint passed. Rollback-only checks on the isolated local PostgreSQL database reproduced the counter permission rejection, accepted percentage/fixed inserts without that field with counter zero, and rejected a different owner. Production access was limited to read-only column defaults/grants, policies and trigger definitions. No live voucher was created. Evidence is under ignored `build/voucher-creation-20261122/`.

The supplied video shows the My Purchases screen, separate from the screenshot's voucher creation failure. No historical order/payment state was changed. The earlier production-readiness report's unrelated blockers remain; a locally built archive does not close them or publish the fix to installed clients.

Requested archive: `build/voucher-creation-20261122/60Seconds-115.0.5-119.xcarchive`. **Archive succeeded**, embedded version/build verified as **115.0.5 (119)**, and deep/strict code-signature verification passed. The archive was opened in Xcode. Final evidence is recorded in `verification.json` alongside `archive.log`. No upload or release publication is authorized by this task.
