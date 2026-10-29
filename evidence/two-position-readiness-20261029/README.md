These are **offline disposable composition tests**, using application source
`cdba9d483fdcef105e74e3053a8d4bbf28bdff0c`. They do not enable another operating
account, financial position slot, service, provider connection, or acceptance
interval. The original operating limit remains one position.

The existing native integration fixture is retained here with an optional real
`PilotRpc` / `ComponentBudget` transport. An injected fetch returns retained
supported pool bytes in an explicitly synthetic shared bank. Migration times,
trade packets, USD valuation, chain clock, and 120 ms request latency are
synthetic. No network request occurs. Counterbooks and the fixture ledger use
private temporary directories that are removed after each test.

Run explicitly from the repository root:

```bash
node --import tsx --test evidence/two-position-readiness-20261029/paced-native-integration.mts
node node_modules/typescript/bin/tsc --noEmit --project evidence/two-position-readiness-20261029/tsconfig.json
```

The script is outside `test/*.test.ts`. The original auto-discovered integration
test is unchanged, SHA256
`72077434301dd0bad561557fdb3a17506dfaf6e6a44a7dcd2c958f818a4d0642`.
`preparation.json` records the unchanged application source hashes and the
fixture preparation failures; the ordinary 1,737-test release verification is
not replaced by these tests.

Results: seven explicit tests pass, including two new paced scenarios. The
standalone TypeScript check passes.

- Healthy composition opens two SDK-priced simulated positions, completes 12
  coherent protection checks with a 2,000 ms maximum completion gap while ten
  candidate history pages share the real gate, preserves the same fixture
  ledger through restart, and closes both positions exactly once. There are
  62 physical starts, 328,973 response bytes exactly accounted, maximum physical
  concurrency one, and no uncertain bytes. Four fills charge 28,000 modeled gas
  lamports. The fixture realizes **−2,339,677 lamports**; a successful lifecycle
  is not a profitable trade claim.
- Adverse composition injects HTTP 429 with Retry-After, then a real 20 ms
  caller timeout whose fake transport ignores cancellation. Missing marks close
  new risk without erasing either holding. An unsettled operation prevents all
  replacement transport starts until actual settlement. Recovery preserves
  both positions and inception, charges no additional fill or gas, and retains
  4,194,304 uncertain bytes. Expired discretionary dispatch is rejected before
  a physical start.

The initially immediate second entry expired while paced quote preparation
crossed its original ten-second certificate bucket. That refusal remains in
the raw records. A synthetic trade packet is collected contemporaneously in
the next open bucket, and a new independently verified complete window is
required before the later entry. Neither timestamp nor original qualification
is extended or backdated. The fixture also uses the production single-page
history interface rather than accidentally exposing optional quiet batching.

`healthy.raw.json` and `adverse.raw.json` preserve the physical starts, actual
class accounting, bridge records, disposable financial state, and journal.
`full-explicit-tests.txt` and `typecheck.txt` preserve validation output.

This establishes local financial and adapter mechanics under the stated inputs.
It does **not** establish installed scheduler fairness, actual provider latency,
EC2 resource capacity, natural opportunity capture, profitable execution, or
live two-position protection. The existing measured single-position protection
breaches remain a readiness limitation. No live financial limit is changed.
