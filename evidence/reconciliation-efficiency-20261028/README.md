# Equivalent Native PAPER reconciliation reduction

Status: isolated offline repair, based on lead c189a54b7978692ef2f7d098d6b3374aea8deb72. Not deployed and does not modify the source-pinned forward interval.

The regular NativePaper market-context wrapper persisted a reconciliation before PaperTrader.drain sanitized that same context and persisted a second reconciliation. One flat protection tick therefore added two durable actions although `funnel.reconciled` advanced once. A due entry added three reconciliations: execution preparation, regular context wrapper, then regular tick validation. The pre-attempt execution reconciliation is necessary because the coordinator services pending actions before the ordinary tick stage and ledger.attempt checks fresh financial readiness.

The repair keeps the shared market read, separates a reconciling `executionContext` for due actions, and leaves ordinary reconciliation exclusively with PaperTrader. It removes no source-time, exact-size mark, quote-age, daily-loss, UTC rollover, reservation, execution, or accounting validation. No strategy, cadence, provider, request limit, or ledger schema changes. Every surviving reconciliation still creates its complete durable action/history; no old record is removed.

## Verification

- `baseline-regression.txt`: existing source failed both new regressions, two rather than one regular action and three rather than two reconciliations around a due entry.
- `focused-tests-final.txt`: 83/83 execution, trader, pilot, native hook, SDK integration/recovery tests pass. Includes a coherent two-holding read with exactly one durable reconciliation, pending-action freshness before attempted fill, costs, retained exposure, restart/uncertain-exit recovery, source failure, reporting-admission failure, and quote/source-time checks.
- `build-final.txt`: TypeScript build passes.
- Independent read-only review: GO, no financial-safety blocker. Reviewer independently reran four integration cases, including two-position recovery and reporting outage. No EC2 or live-market capacity claim follows.

Reproduce focused checks:

```bash
node --import tsx --test test/native-paper-integration.test.ts test/native-paper-interop.test.ts test/native-paper-hooks.test.ts test/pilot-trader.test.ts test/trader.test.ts test/execution.test.ts
npm run build
```

## Disposable persistence measurement

The benchmark runs actual NativePaper.protection calls against private disposable SQLite accounts, fixed synthetic USD and no market/provider network. Three alternating paired runs each contain 2,000 evaluations. The baseline module is imported from an unchanged c189 worktree; before/after SHA checks prevent accidental comparison against changing code. The benchmark verifies unchanged capital, inception, cash, zero costs/positions/pending and SQLite integrity, then removes only its own disposable fixture databases. `write-benchmark-output.txt` preserves an initial fixture-construction failure (missing unused quote adapter); corrected outputs are separately retained.

`write-benchmark-with-base.json` records:

| Component per 2,000 evaluations | Baseline | Repaired |
| --- | ---: | ---: |
| Durable reconciliation actions | 4,000 | 2,000 |
| Settled SQLite growth above initial 32,768B | 1,908,736B | 946,176B |
| Median component CPU | 1,371,974µs | 1,034,431µs |
| Median elapsed | 1,312.45ms | 961.47ms |

This is 50% fewer routine reconciliation actions, 50.43% less settled database growth, and 24.60% lower median component CPU in this second Cloud microbenchmark. Three samples and shared Cloud filesystem/JIT behavior do not establish a general CPU speedup. The earlier paired measurements are retained separately, not selected away. No traffic/RPC savings are claimed.

Reproduce with an immutable baseline worktree:

```bash
node --import tsx scripts/reconciliation-write-benchmark.ts /path/to/c189-worktree/src/native-paper.ts /new/path/write-benchmark.json
```

## Long-run implication and limits

A linear projection of this flat-account fixture is 19.49MiB/day at two-second evaluations, versus 39.32MiB/day before repair; at five-second flat housekeeping, 7.80MiB/day versus 15.73MiB/day. These are projections, not 24-hour observations. Held-mark payloads, orders, pauses, costs, other metadata, DB page/index behavior and preexisting account size add demand; they were not modeled as live workload here. Two-second reference protection remains unchanged. Five seconds here describes current flat housekeeping only and is not a proposed holding cadence.

The existing native runtime backup cap is 16MiB for source DB plus active WAL, and the readback financial census accepts a maximum 40MiB DB. Thus this equivalent optimization alone cannot make a 24/72-hour history/backup policy sustainable, especially with holdings. The history must remain intact; an appropriately bounded measured retention/backup/archive design or justified size envelope is still needed before extended acceptance. A failed backup closes new-risk admission and retains exposure; existing history is not truncated. The 40MiB bound is a readback constraint, not a demonstrated runtime termination condition.

This is not the cause of the first run's 180.25-second CPU stop. Applying the measured component difference to 257 regular flat checks suggests roughly 0.04 CPU seconds avoided, before environment differences—not a material fraction of that CPU budget. Broad watch parsing and other work require separate profiling. No live forward benefit, trading outcome, unattended readiness, or economic edge is claimed.
