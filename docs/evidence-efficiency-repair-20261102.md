# Trading evidence and operating efficiency repair

## Scope and preserved requirements

This repair follows the failed sustained observation from 2026-11-02 18:32–18:42 UTC (admin Actions run 41490205236, attempt 2). It changes active PAPER V3.1 execution support and reporting cost. It does not authorize funded execution, create a replacement account, reset financial history, change the verified token-creation-age limit of 24 hours, increase the four deep observation slots, change the five-percent allocation policy, add a daily-loss halt, or relax independent audits, fresh quotes, source validity, physical settlement, financial ownership, or protection.

The observed interval had 53 new maintenance-deadline misses, 54 journal reconciliation gaps above two seconds, 36 report publications above the existing 250 ms target, and six observations lost before a complete audited window. Four losses involved noncanonical signatures, one involved a heartbeat timeout, and one involved a packet-processing deadline. These are separate failure mechanisms. Lower local work cost does not by itself establish that malformed provider packets or remote heartbeat failures are resolved.

## Requirements removed from the active trading path

| Work or data | Consumer review | Repair |
| --- | --- | --- |
| Frozen baseline strategy assessment alongside active V3.1 | V3.1 evaluates the independently audited feature window directly; neither its active assessment nor the connected AI research feed consumes the baseline result. | Skip baseline evaluation and its event in active V3.1. Preserve it for explicit legacy and research modes. Report the uncollected baseline as null, with `baselineAssessmentEnabled=false`. |
| Unaudited per-window feature-view events | Readiness uses the internal window and counters. Audited active decisions and actual trade contexts provide the consumed evidence. The connected AI feed has no direct dependency on these feature-view events. | Skip their emission in active V3.1. Continue updating internal readiness and the feature-view counter. |
| Empty validated-event envelopes for successful V3 notification metadata | A second required information-available event immediately retains the same canonical notification identity. No trade or protocol event payload exists in an empty envelope. | Omit the redundant empty envelope only after normal parsing and validation. Preserve the required notification metadata, frame-validation statement and every nonempty trade/protocol payload. |
| Successful raw representative examples in persistent V3 | Trading uses the exact normalized event bytes, protocol effects, canonical notification ledger and independent history audit. The additional raw examples are supplementary research samples. | Skip assembling and emitting the successful raw examples in persistent V3. Preserve explicit research-mode sampling. |
| Mandatory capacity for explicitly supplementary raw samples | A raw example neither makes an already refused window usable nor supplies financial authority. Required selected packets, gaps, audits and execution records are separate event kinds. | Only the two exact raw-example kinds, with literal `supplementaryOnly=true`, can use optional capacity. An essential-evidence override still wins. |
| Repeated identical reporting aggregates | Watch summary, coverage and verification backlog queried overlapping populations during one publication. | Reuse compatible aggregates within one synchronous SQLite read snapshot. Discard them before another publication or write. |
| Whole-ledger compaction on every append and status read | With an unchanged window boundary, current-window arrivals cannot produce a newer prewindow fence or another removable row. | Reuse the completed compaction for that boundary. A changed boundary, historical incoming availability or new subscription generation still performs the exact conservative scan. |

The consumer audit also checked the installed AI research feed, research inputs, observer environment/evidence store and companion reporting. The evidence store may archive generic bounded records, but it does not make the removed records a required active-decision input. This change preserves registry watch-history transitions, actual financial contexts/receipts, audited active strategy decisions and trade records.

## Evidence retained for trading and diagnosis

Every canonical successful selected notification still participates in independent successful-signature completeness checks, including notifications without an ordinary trade. Actual trade and protocol-effect bytes remain required. Token-creation proof, scope identity, source-generation boundaries, raw-hash correction detection, receipt and availability times, source gaps, transport settlement and heartbeat evidence remain enforced.

An all-zero/noncanonical transaction signature still invalidates its affected observation. A label resembling a protocol operation does not prove execution or economic harmlessness without a canonical identity. The repair adds bounded, explicitly unverified log-shape diagnostics (invocation-stack state, instruction-marker counts and limited event discriminators), the latest scoped refusal, and processing-stage times. These observations grant no qualification or audit completeness.

The previous raw refusal reserve sampled only the first packet of each refusal reason for a native-flow instance. The repaired reserve distinguishes noncanonical reason plus bounded shape, within the existing maximum of eight shapes and 512 KiB. This permits a later structurally different refusal to be retained without recording every repeated packet. Raw-sample submission counters are explicitly not proof that the independent recorder retained every optional submission.

The existing 30-second technical retry behavior is not changed by this patch. Repeated attempts of a candidate that receives malformed data need causal packet and transport evidence; changing evidence acceptance or merely lengthening retries would not demonstrate recovery.

## Reconciliation scheduling

Chains of synchronous work separated by already-resolved promises can postpone timer callbacks. `NativePaperSourceWork` adds a 125 ms cooperative work quantum at completed candidate-processing phase boundaries. When due, it gives the event loop a real timer turn and services the existing cash-maintenance coordinator before and after the yield. Checkpoints occur outside SQLite transactions.

The runner rechecks source admission, financial runway and cancellation after the checkpoint. Original operation and decision deadlines remain original. The coordinator keeps its single financial owner, one-second pacing, failure handling and real reconciliation timestamps. A single oversized synchronous operation still records a genuine miss; this repair cannot preempt it.

## Reporting implementation and measurement

Persistent runner status now uses one coherent read snapshot. A grouped watch-state query supplies common watch and coverage counts, and verification statistics are keyed by the actual report timestamp within that snapshot. Returned values are copied so a caller cannot poison the shared result. Nested reads and rollback cleanup do not leave a cross-publication cache.

Reports that already require verified token age begin with the indexed token-creation population and then look up the matching watch rows. The original inclusive age bounds and `verified_at <= report time` remain in force, and the original eligibility predicates remain. Unique creation mint keys preserve watch-row multiplicity. Selectors and financial admission do not use a retained report population.

`scripts/benchmark-trading-report.mjs` builds a disposable synthetic registry with 68,050 watch rows and 181,323 market identities. Five status samples averaged 212.220 ms before this repair and 108.959 ms after it. The compared output SHA-256 was identical: `473b95dec10c24ac38faa586e0f0c02fa3e3831f043dc7ff86b0ed54f7984559`. This is a local status-cost comparison, not an EC2 service-level guarantee and not the complete publication duration.

The existing complete-publication timer remains authoritative for the 250 ms target. It includes candidate status, cash maintenance, financial projection/history/trades/portfolio and publication/checkpoint work. Network delivery remains in the existing separate publisher. Post-deployment acceptance must measure complete publication, fresh source age and delivery health, not infer success from this benchmark.

## Completed local validation

- Direct candidate-runner regression: 165/165 tests, including preservation of the audited V3.1 decision/certificate with no unused baseline or unaudited feature event.
- Direct flow/notification/retention regression across nine files: 181/181 tests, including out-of-order input, exact compaction equivalence and required versus supplementary evidence classification.
- Cooperative scheduling regression: 11/11 tests. A deterministic real-coordinator/SQLite reproduction changed a 2,560 ms reconciliation gap with one miss to a 1,655 ms maximum gap with zero misses; a queued timer received a turn. This is synthetic mechanism validation, not a live performance result.
- Report population parity: 3/3 tests; snapshot/cache regressions: 3/3; observation reporting: 5/5.
- Snapshot regressions cover a concurrent WAL writer, next-publication visibility, returned-object mutation, rollback, timestamp-specific verification counts and refused writes inside the read snapshot.
- TypeScript build and diff-whitespace checks passed during development. Full release regression, immutable bundle validation and post-deployment acceptance remain separate release gates.

## Acceptance after activation

Use the same 21-observation, approximately 600-second sustained acceptance and unchanged criteria. The prior acceptance and monitor SHA-256 values are respectively `497eebf5eac57ec901bbc094fe1107eeef3d3b33243613c09ab60b5f78f05f89` and `5554b66792c48026da925c160b60e5eed4de02d545df5f50dfe9eeb6352f0c61`.

Measure fresh counter deltas and consecutive financial journal gaps; distinguish historical protection totals from new failures. Confirm independent core-monitor cadence separately from the AI observer's schedule. Record selected observation invalidations, recovery/retry behavior and actual completed audits. A healthy flat interval is not evidence of a PAPER entry/holding/exit lifecycle: observe that lifecycle separately when a naturally eligible opportunity occurs, without fabricating or forcing an entry.
