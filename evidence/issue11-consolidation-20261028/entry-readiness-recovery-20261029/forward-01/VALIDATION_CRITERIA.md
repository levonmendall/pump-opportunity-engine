# Source-pinned forward validation

Target: source `f96f02eeccd56dda6ce811bdc4405f237224c54f`, executable `b3ec5aa43b877a4c5ff44f6217be32a4539766c351deb143d557894ccb118ec9`, configuration `acbe8e435d4f9f3a61cecc6f511469272890766abf63d8d5b891fc4a5e8085cf`. Original account/inception and baseline strategy remain fixed. Maximum deep slots: four. Maximum PAPER positions: one.

This is a bounded verification interval within the continuing persistent service. Finishing collection does not stop the service. No synthetic qualification, external RPC requests, owner-control commands or runtime modifications are performed by the analyzer.

## Financial freshness and recovery

- Calculate reconciliation age at **source generation**, preserving the original ledger reconciliation timestamp. The unchanged entry guard remains two seconds.
- When flat, `marketAt` is the original SOL/USD timestamp, so its source-generation age can be compared with the unchanged ten-second guard. When held, this field can instead be an actual-size valuation/Clock minimum; exact held FX age is unknown from this channel.
- A genuinely enabled source permission must agree with fresh reconciliation, available USD valuation, runtime state and the one-position limit. Contradictory source facts require immediate investigation.
- Count successful reconciliations from the actual source funnel and sampled span. The cash-only target is approximately one second; source frames alone cannot establish the maximum interval between every pair of local completions.
- Fresh FX with reconciliation older than two seconds is retained as a possible operating problem, not automatically called a scheduler miss. Candidate financial preparation, held/pending work and unsettled execution intentionally exclude the local callback. Private work/maintenance facts may be needed to attribute a gap.
- A pause-to-enabled source transition establishes observed effective eligibility recovery. It does not independently establish which private ledger control action was committed, its exact onset, or its exact duration.
- A `SAFE_STOP`, owner pause, daily loss, financial/evidence uncertainty or unresolved action must not be cleared by the analyzer. Follow genuine full candidate preparation and ledger evidence before deciding whether an inherited stop is preventing authorized operation.
- Known USD unavailability, startup warming and financial ownership deferrals are distinct from healthy armed-maintenance deadline misses. The public projection does not expose every private maintenance counter.

## Discovery, data, orders and protection

- Compare distinct evaluated-token counts and distinct retained decision identities. Report overlapping window counters as overlapping windows, never as independent minutes or unique tokens.
- Report native selected-capture, broad discovery and watch connection interruptions separately. Continued broad discovery does not establish valid selected-candidate evidence.
- Report HTTP timeouts, errors, throttles, audit failures and deadline counters as measured changes within one source/run. Normal occupied RPC capacity maps to monitoring pressure; it is not treated as evidence of provider failure.
- Count new-run fills using their original timestamps. The eight pre-upgrade cached historical fills are retained history, not new-run trades.
- Check conflicting fill identities, distinct fill IDs for the same order, forbidden repeated buy fills for a mint, and changed pending-order identities. Absence of duplicate evidence in bounded public samples is not a complete ledger audit.
- Held positions, pending actions, protection timestamps and unavailable marks remain explicit. A flat interval cannot demonstrate held-position protection or profitable execution.

## Resources, reporting and continuity

- Use actual paired EC2 cgroup CPU, memory, I/O, throttling and host headroom receipts in `resources/`. Never subtract across different supervisor/source PIDs or a cgroup counter reset. Kernel cgroup I/O includes all service work, not SQLite alone.
- Public source CPU/RSS/disk/loop-lag samples supplement these host receipts. They do not prove that increased journal frequency has zero cost.
- Preserve source generation, Render receipt and observer receipt separately. The existing 90-second source/receiver staleness guard remains meaningful; duplicate receipts never freshen the source timestamp.
- Preserve the old-source stop and the delayed appearance of the new source as a real transition/reporting observation gap. A new run's start time does not prove that the public dashboard was current throughout that gap.
- A gap in retained sequence numbers means the observer did not retain those source frames. It does not prove an engine outage. A long observed source-generation interval is reported as unobserved time, without inventing the engine's intervening state.

## Baseline and decision rule

The same four-slot baseline snapshots 9307 and 9310 had source-generation reconciliation ages **54 ms** and **5,050 ms**, with fresh FX ages **2,825 ms** and **3,249 ms**. Both were flat and the provider failure counters did not increase. `offline-baseline-check/` reproduces these exact facts using the new analyzer. This is a deterministic cadence comparison, not a controlled profitability or whole-market opportunity-recall comparison.

The repair is mechanically supported when sustained new-source samples and reconciliation completion rates demonstrate that the known five-second/two-second conflict has disappeared, genuine temporary failures recover through the authorized fresh-data path, and no financial integrity, order, protection, reporting or resource regression appears. Missing natural qualifications or held exposure must remain **not exercised**. Continued capture/provider failures remain separate unresolved failures.

Do not declare full operational acceptance, an uninterrupted 24-hour test, profitability, complete opportunity recall or two-position readiness from this interval.

## Reproduce from retained rows

Run from the repository root:

```sh
python3 evidence/issue11-consolidation-20261028/entry-readiness-recovery-20261029/forward-01/analyze-retained.py --frozen evidence/issue11-consolidation-20261028/entry-readiness-recovery-20261029/forward-01/snapshots.ndjson
```

The command makes separately named frozen-input and scorecard artifacts. It does not fetch market data, change source rows, mutate the account or replace previous scorecards.
