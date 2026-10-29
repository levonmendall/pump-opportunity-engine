# Original portfolio reporting verification

This is offline verification of source `e05bddec841790b0d10a0848d67a1ced3f74a3e0`, not an EC2 cutover, Render deployment or natural PAPER result. No financial ledger was opened or created, and no provider request was made. See `verification.json` for source-file and raw-output hashes.

The clean dashboard checkout passed its complete 211-test suite, TypeScript build and compile. The focused 32-test reporting suite checks the authenticated original snapshot receiver, source/account identity, whole-snapshot acceptance, reordering/duplicate handling, stale source truth, single portfolio, retired-channel tombstone, publisher recovery, exact source-file hash versus canonical receiver fingerprint, and actual one-shot shutdown CLI behavior. The subprocess CLI test replaces `fetch` with an explicit local fixture; it is not a public Render POST.

`browser-fixture.ts` serves a local fixture and blocks external browser requests. Chromium at 390×844 and 1280×900 displayed one original portfolio, bounded operating intelligence, no experimental panels, no horizontal overflow and no JavaScript errors. `browser-fixture.json` records source hashes and screenshot hashes; the screenshots remain local, uncommitted diagnostic artifacts. These observations establish rendering mechanics, not live source freshness or performance.

Reproduce in this checkout:

```sh
npm test
npm run build
npm run compile
node --import tsx --test test/reporting.test.ts test/dashboard-holographic.test.ts test/snapshot-file-publisher.test.ts
node --import tsx evidence/unified-render-issue11/browser-fixture.ts
```

The browser command uses the existing Cloud Chromium/Playwright installation declared in the script. It creates no account. The existing Render receiver and original EC2 observer were untouched by this verification. Actual same-account runtime→publisher→Render parity over two cycles, public mobile rendering, interrupted/recovered reporting and post-cutover source identity remain lead integration checks.
