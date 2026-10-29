# Original-account persistent engine integration (offline)

Source `f4f6a43f289e99b2182d932cea0f01b410d539ad` integrates persistent management into the **existing** original account/ledger, with no initialization/import path. Service mode removes healthy lifetime CPU/time/request/evidence exhaustion while retaining rolling pressure, actual provider pacing, bounded diagnostics, protected proof retention, financial backups and held/pending priority. The original source-pinned snapshot is published by its independent original-channel publisher. Qualification cannot admit exposure before proof retention, fresh validated state, same-run reporting acknowledgment and financial readiness.

`c328df4` updates the existing `/var/lib/poe-public/status.json` with the same original identity and actual new source facts; legacy observer values remain unchanged. `c57eee1` verifies the actual Python-generated publisher child environment against the TypeScript credential binding. Python→TypeScript marker/credential checks exposed and prevented cross-component owner/environment mismatches. Reviewer findings also corrected diagnostic-pressure exception containment, root-release file ownership, and preservation of the referenced recovery checkpoint during run-index rotation.

Measured offline results (overlapping scopes, not additive): **104/104** focused core/financial/backup checks; independent **69/69**; **23/23** local-public/runtime checks; **15/15** latest cross-component checks; TypeScript passed. The f4 immutable 5-file executable/publisher closure built and passed the network-disabled disposable backup/idempotency/reopen smoke. The large backup regression used a real 78,913,536-byte disposable database: persistent mode passed without a research-size ceiling; worker timer-gap observations are Cloud test evidence, not EC2 capacity.

Actual original-account audit, privileged cutover, final combined-repository release, real provider recovery, original-account natural PAPER trades and sustained EC2 operation remain unverified here. No real ledger, credential or provider was read, no new operating account was created, and no deployment was performed by this component work. Earlier raw failures remain in parent evidence; no historical forward failure is reclassified by these offline tests.

Reproduce on integrated reviewed source:

```sh
npm run build
node --import tsx --test test/native-paper-*.test.ts test/paper-service-policy.test.ts test/native-original-boundary.test.ts test/public-status.test.ts test/runtime.test.ts test/pilot-reporting.test.ts test/operating-pnl-reporting.test.ts test/operating-intelligence.test.ts test/backup.test.ts
node scripts/build-native-paper-ec2.mjs --output-directory /tmp/poe-native-paper-output-original-verified
```

The package command requires clean committed source and a new empty output directory. Its disposable verifier cannot open a supplied existing account. Runtime mode is resume-only and fixed to `/var/lib/poe/state/ledger.sqlite`; it must run under the already authorized original nonroot service, never against another experimental account.
