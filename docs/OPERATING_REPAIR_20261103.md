# Coordinated POE operating repair — November 3, 2026

This change repairs observation-to-decision scheduling and upstream canonical
migration recovery. A successful build is not operational acceptance. Exact
source, configuration, executable, test logs and build provenance are emitted
by `.github/workflows/poe-operating-repair.yml`; activation and forward evidence
must be reported separately.

## Observed predecessor and causal limits

The authorized host export at **2026-11-03 14:14:08.494 UTC** identified source
`356083fd8f0e69297c8470d4493077a175d2bad1`, process **2806348**, run
`native-paper-20261103113905509`, and configuration
`1bf57b55a30c3263e5b386af435cb4f2fd7f75b2fc529ed35a6ec11cb5b66aab`.
The source already included the upstream age qualification, scheduling and
reporting repairs from PRs 53, 54 and 56. Development began from current main
`5d13156b52b8c219f39954688f6b538c8d2120c3`, which also preserved the verified
migration-age restoration.

The 14:14 sample proves a local entry admission mismatch: short-window headroom
was 12 starts, while the old nine-start entry envelope plus four protected
starts required 13. Minute headroom was 39 against a requirement of 16. This is
an established blocker at that sample, not attribution of every historical
handoff expiry. The provider limits remain 90 starts/minute and 20/10 seconds.

The sampled coordinator's `candidate-shared-step` had 15,597 calls, a mean of
about 402 ms, and 6,273,497 ms total elapsed time. The active pool-progress query
traversed retained dormant identities before limiting its result. The repair
uses a covering index and age-qualified active scope. Temporary writer
contention is a deferral; its count is not a count of lost market intake.

The earlier 96.345-second current-process protection maximum remains a genuine
historical breach. Retained scalar counters do not identify its exact cycle or
cause. Later snapshots without an additional breach do not erase it. New
completion records retain per-holding consecutive usable evaluations, original
quote times, interval buckets and a bounded recent series for forward checks.

## Scheduling and executable pricing

- Entry admission counts remaining layout, rent, cold pool-link, exact-size
  quote and owned context reads. The cold V3.1 path has four preparation/quote
  reads plus two owned context reads; a prepared warm-link holding path has one
  quote read plus two owned context reads. Protection reserves are unchanged.
- Stable preparation advances by one physical request per turn and retains
  valid partial work. Every read carries its original owner, source generation
  and deadline through physical admission. Preparation must leave room for all
  remaining preparation operations and the final decision sequence.
- Prepared layout and rent timestamps remain original. Expiry, inventory or
  generation changes revoke reuse. Retiring a different candidate does not
  invalidate unrelated preparation. An evicted pool-link cache adds its actual
  extra quote read instead of being assumed warm.
- A current certificate coordinates proof retention, preparation, necessary
  native service, protection runway and final quoting before optional work.
  Proof retention itself neither creates financial permission nor extends the
  certificate. Local quote admission refusal remains distinct from a provider
  response, unsupported market structure and an economic rejection.
- Completed audit results survive a refused registry writer lease without
  fetching identical history again. Known same-generation evidence gaps retire
  the observation; old-generation results cannot invalidate a replacement.
  Completed-response validation uses source-information identity rather than
  permission for another request, so consuming the last discretionary start
  cannot retrospectively invalidate successfully returned evidence. Ordinary
  physical admission remains enforced before every subsequent request.
- A real execution-economics event counts before optional registry writes. Its
  compact outcome receipt retains original assignment and time through a busy
  writer lease; admitted nonfinancial turns persist a bounded cohort atomically.
  Failed callbacks and technical refusals are not economic decisions.
- Replacement bookkeeping, support, subscription acknowledgments and physical
  retirement use their actual operation deadlines. Ready audits do not impose
  a blanket ban on otherwise feasible replacement work. The existing 1.7 s
  prepared-operation bound is preserved, not claimed as a new reduction.

The cross-scope audit-tail reproduction and exact missing-history signatures
are documented in `NATIVE_CAPTURE_SCOPE_REPAIR_20261103.md`. The historical
exports do not establish whether those particular absent signatures were
omitted by the provider or lost before local retention. A reproduced internal
tail-generation defect is corrected without inventing missing trade evidence.

## Discovery and reporting

Canonical PumpSwap migration fallback now keeps a durable, seed-bound recovery
cursor and verification state, processes bounded pages across service turns,
and resumes after restart. It can verify an origin beyond the first 1,000
transactions. A new direct migration hint supersedes obsolete fallback work.
Only actual verified migration time qualifies the inclusive 60,000 ms through
86,400,000 ms age range. Unverified migrations remain unresolved upstream of
deep observation. There is no asserted denominator for complete market recall.

The consolidated Portfolio Overview distinguishes usable primary economic
decisions from evaluation callbacks, exact-size data/admission failures from
strategy rejection, source-instance counts from process-run allocation
provenance, and ready preparation from stale supporting data. Readiness exposes
the actual waiting operation, needed time, available time and binding blocker.
Diagnostic views carry their own observation clocks and do not refresh the
underlying financial, reconciliation or quote timestamps.

The fresh 14:59:49 UTC snapshot retained 198,878 market identities, 80,701
tracked watch identities and 11,564 pending verification requests. The isolated
full-publication fixture therefore exercises the actual report/checkpoint
closures with **200,000 retained identities, 81,000 watch rows with 16 history
entries each, and 12,000 pending verifications** on an on-disk WAL registry. It
also includes 150 valid eligible migration proofs, 720 reporting points, 60
later reconciliations, one holding and a retained fill. Actual financial
projection/history/trade work and atomic, fsynced local publication/checkpoint
writes are included. Root verification measured **110.06, 92.97 and 113.11 ms**;
the candidate-status phase peaked at 71.02 ms. The release workflow runs this
representative benchmark separately with the **250 ms** assertion enabled. The
ordinary parallel suite uses a 10,000-row correctness fixture; its timings do
not establish representative capacity. These are controlled offline
measurements, not production latency claims.

## Financial and deployment boundaries

Execution remains PAPER-only with four slots and liquidity-resilient momentum
V3.1. Entry and exit economics, equity sizing, approved portfolio controls,
the four-second completed protection boundary, two-second target cadence,
two-second reconciliation freshness and 250 ms publication target are retained.
The original account, capital, positions, obligations, ledger and lifetime equity
history remain authoritative. No funded execution or new provider allowance is
introduced.

The approved EC2 installer requires **no open position and no pending action**
because its existing procedure stops POE for consistent backup and continuity
checks. The observed predecessor account has an existing position. Deployment
must preserve that natural-flat guard, verify the installed predecessor
immediately before activation, verify the exact package and configuration,
and preserve all financial prefixes. Do not force an exit or remove the guard.
The installer and rollback retain financial state; rollback is a source/config
operation, never restoration of an older portfolio over newer financial events.
COE identity and operation are independently checked immediately before and
after any POE activation, including concurrent COE release advancement.

## Required forward acceptance

After an authorized activation, compare one explicitly identified process and
sustained intervals covering audit, retirement, replacement, final quote,
economic decision, reconciliation and actual holding-protection cycles. Report
handoff seen/dispatched/completed/invalidated/expired counts; distinct usable
decisions per hour; quote refusal causes; replacement median/p95/max; slot-state
time; missing-history and deadline failures; preparation freshness; local versus
provider failures; full-publication duration; actual reconciliation age at
decision; completed protection intervals; and migration recovery progress.

Keep lifetime totals, current-process counters and interval deltas separate.
Do not add overlapping missing-history/unusable categories, infer provider
failure from an unstarted request, or count missing-data callbacks as decisions.
Do not force trades. A timely, justified no-trade economic decision is useful
progress. Candidate fairness requires current-run allocation/revisit evidence
after useful decision throughput is restored; durable historical repromotions
alone do not prove starvation or repeated current-run selection.
