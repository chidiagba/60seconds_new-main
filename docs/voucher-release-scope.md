# Focused voucher release scope

Source commit `9feeac95e0a43c0a58edb0ae12163b8827525224` contains 63 source/test paths. The main worktree was not reset, staged wholesale, rebased or overwritten. Its 644 remaining changed paths are inventoried in the manifest; an isolated commit does not remove their main-worktree diffs.

- Included: authoritative pricing, voucher selection/retry state, checkout/order/counter UI refresh, receipt-read helper, retired simulated wallet payment, verification/settlement/guest handlers, three new forward migrations, audit/classification scripts and focused regression fixtures/tests.
- Mixed files were reconstructed from the original HEAD: lib/database.ts includes only the receipt-helper replacement; store/wallet-store.ts includes only makePayment retirement; notification bridge includes only order navigation; config includes only checkout-reconcile JWT; cart/product styling and the broad logger sweep are excluded.
- Historical schema differences needed to reproduce the audited production shape are stored under tests/fixtures/production-baseline. They are test fixtures, not newly proposed production security migrations or wallet backfills.
- Excluded: avatar/search/location/watermark/video/upload changes; broad auth/OTP/security/logger cleanup; native/binary/build outputs; package/lockfile changes; broad schema/backfill modifications; private audit exports and credentials. Documentation preserves only task-specific findings.

The originally reported 43 uncommitted release/dependency paths were a review list, not permission to commit every hunk. See prior_manifest_review for each prior manifest entry, and release_source_files for exact included source hashes. No package dependency was introduced by this voucher commit. The shared installed node_modules were used for verification; a clean lockfile install/native build remains a release gate.

Clean baseline findings are retained and disclosed: 106 pre-existing frontend TypeScript diagnostics, 690 logger-policy lint findings and 25 possible credential/private-key scan paths. These must be resolved by integrating separately reviewed baseline work before shipping; they were not hidden by adding unrelated changes to this commit.
