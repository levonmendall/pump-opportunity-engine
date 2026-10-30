# Frozen239 four-slot offline verification

This is configuration-only verification of installed source `239a00ea9fbc0a25ebcf318631d26618d941c899`. It is not a forward throughput comparison, autonomous acceptance, or market/profitability evidence. The paused resource-v2 draft was neither imported nor modified.

Run from the repository root, with the retained frozen executable available at `/tmp/poe-native-paper-output-coherent-entry-20261029/native-paper.mjs`:

```bash
node --import tsx --test evidence/issue11-consolidation-20261028/four-slot-configuration-20261029/frozen-four-slot-resume.test.mts
```

The single new test file exports immutable business sources from that exact Git commit to a disposable directory. Its fixture adapter uses the existing frozen runner fixture, adding only a restoredWatch option and an explicit path to retained creation evidence. No market provider, service, financial database, ledger or credentials are accessed. Resolver/flow/history inputs are synthetic and do not establish on-chain eligibility of their generated tokens.

Three tests pass:

- Six formerly DEEP identities become six retained DEFERRED/WATCH identities on restart; stale subscriptions/certificates are not reused. Exactly four obtain fresh native scope allocation and four independently audited synthetic windows, through one physical gate. After scope retirement, both waiting identities receive fair replacement opportunities, with active plus retiring scopes never exceeding four.
- Actual frozen native and broad-feed constructors accept a capacity of four; a fifth native registration is refused locally without starting requests.
- The only CLI/configuration change is deepSlots6→4. Original ledger identity/path, single financial stage, one-position limit, strategy/risk contract, data-validity and execution rules remain unchanged.

The initial fixture-development logs are retained separately. They failed because repeated scheduler calls did not advance the fake clock: the real250ms pacing gate and retirement settlement correctly kept later operations waiting. The final fixture advances the synthetic scheduler by50ms per turn and allows bounded replacement waiting. No product source or scheduler behavior was changed to satisfy the test. These harness failures are not recorded forward-market failures.

The independently computed frozen v1 four-slot configuration SHA is `f6ce54d7594e14d87955f211cca21f594b3d3eb52e20a75fa2245290f22a4857`; the six-slot value remains `5e99ebe042521b3917a11b86ef4b46264205b11d38c407cba264a01046a79344`. Same executable SHA `fa10982125bd77c1586606283a9fabed4daee5434792dcef90be2bd312cc5315`,5052930bytes.

`independent-manifest-review.json` confirms exactly two changed fields between the reviewed installed239 manifest and target: deepSlots and configurationSha256. Every artifact row, supervisor policy, source, stage and strategy is identical. Target manifest SHA `a1dbed9db61e259f759701d6aae2bd102ec3dc7cb357ef121312d7ddb3e4354b`.

Applying the configuration and observing four live slots remains a separate privileged runtime step. These offline results do not claim that step occurred.
