# Independent sampling inside the persistent original service

**Implemented and offline verified; live collection has not started.** The
existing independent GeckoTerminal sampler can now bind a fresh finite reference
measurement to an older, already-running original POE service. No runtime,
account, strategy, service or reporting change is needed.

Previously the sampler required collection to start within 120 seconds of the
runtime's birth and used that birth as its two-hour schedule. Applying it to a
healthy persistent run would either refuse collection or require a fictitious
restart. The optional `measurement` now supplies its own start/planned end while
`segment.startedAt`, `runId` and `sourceCommit` retain actual runtime provenance.
A planned measurement end never becomes a runtime end and never stops POE.

The existing finite-runtime interface and its 15 tests remain supported. The new
mode adds ten meaningful fixture tests; all **25/25 focused tests and build pass**.
Raw output and exact source hashes are in `verification.json`. Initial missing
worktree dependency errors are retained separately; the existing installed
dependency tree was reused without a network installation.

The new CLI inputs are:

| Input | Meaning |
|---|---|
| `--run-id`, `--source-commit`, `--source-start` | Exact installed runtime identity and original start, including when older than two minutes. |
| `--measurement-start` | Fresh reference measurement start, within 120 seconds of invoking collection. |
| `--measurement-planned-end` | Measurement deadline, at most two hours later; no service operation. |
| `--source-snapshot` | Existing local original public-snapshot projection, already collected by the existing monitor; no extra HTTP polling. |
| `--prior-receipt` | Settled prior independent-index usage/cooldown receipt. |
| `--directory` | New nonexisting plan/evidence directory; old evidence is never reused or overwritten. |
| `--actual-source-end-file` | Optional independently verified actual runtime-end receipt, separate from measurement completion. |

Use the existing `--capture` and inherited proxy requirements. In persistent
mode omit `--source-planned-end`; the source has no invented finite lifetime.
Root reviews the exact final script, tests and provider constraints before any
network collection. No command in this document has started collection.

The first bounded local public snapshot must be current within 90 seconds and
match the original account, inception, initial funding identity, full source
commit, run ID, actual start and persistent mode. Wrong/stale identities refuse
before any provider call. Thereafter hash-bound sampled observations retain the
actual observed identity, timestamps, capture/discovery/watch states and gaps.
They are sampled evidence, never proof of continuous coverage. Temporary missing
or stale observations can recover; a changed or stopped source permanently
closes enrollment against that binding. The first validated actual-end receipt
is retained even if its input file subsequently disappears.

The existing six-page enrollment at measurement start and +60 minutes retains
all rows and freezes up to four active and four weak controls before outcomes.
If the source changes, stops or is unavailable, later enrollment is skipped or
marked partial. Already frozen cohort outcomes are still retrieved at +110
minutes, avoiding the earlier loss of every outcome after source failures.
`independentMeasurementOutcome` covers the reference measurement independently;
the existing `outcome` is conservatively bounded by last observed matching source
time or verified actual end. Every capture/unavailable observation remains
available for attribution. Neither outcome receives trading-performance credit.

Limits remain 28 physical keyless GeckoTerminal GETs, 12-second minimum spacing,
one in flight, 16 MiB total body allowance and retained evidence, bounded
responses/time/CPU/RSS, no automatic retries, and preserved prior usage,
uncertainty and provider cooldowns. There is no Solana RPC, private ledger,
wallet, signing, reservation, order, financial writer or service control path.
The finite sampling limits cannot stop or throttle the operating POE service.

Reproduce offline:

```sh
node --import tsx --test test/independent-two-hour-reference.test.ts test/persistent-independent-reference.test.ts
npm run build
```

Whole-market recall and executable profitability remain unknown until the
independent frozen population is joined to genuine migration/support evidence,
timely complete flow and realistic paired entry/exit prices. Index age, volume,
prices and liquidity alone do not establish any of those facts.
