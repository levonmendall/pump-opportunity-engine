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

## Refreshed unrepaired operating interval

The snapshots generated at **14:02:48.296–15:09:48.447 UTC** cover 67 minutes
and 0.151 seconds with identical source, configuration, process run, candidate
source instance and provider instance. This is an unrepaired production
baseline, not a measurement of this source change.

| Measurement | Interval change |
| --- | ---: |
| Handoffs observed / dispatched | 42 / 7 |
| Handoffs expired before dispatch / invalidated | 35 / 0 |
| Completed evaluation callbacks | 7 |
| Independently proven handoff economic receipts | Not exported by predecessor |
| Reported primary evaluations / additional distinct primary mints | 6 / 2 |
| Completed audits / additional distinct audited mints | 52 / 2 |
| Deadline windows | 905 |
| Missing-history windows / unusable-audit windows | 9 / 9, overlapping |
| Physical starts / settlements / complete responses | 3,200 / 3,200 / 3,200 |
| HTTP starts / responses | 2,707 / 2,707 |
| Provider rate-limit / unavailable responses | 0 / 0 |
| Gate refusals / component refusals | 87 / 87, overlapping instrumentation |
| Full-publication overruns above 250 ms | 28 across 219 report cycles |
| Additional retained protection breaches | 0 |

The four-slot time deltas were 59.97% audit wait and 25.79% replacement wait.
At the ending snapshot, three slots were active and the fourth had waited
13 minutes 3.429 seconds, with 151 locally serviceable markets. The 24 new
allocations included 23 durable repromotion events; that does not prove 23
current-run revisits, so the new process-run allocation provenance is required
before diagnosing ranking starvation.

Registry transaction failures increased by 3,395. Intake received 536,006
additional records and acknowledged 536,004 additional durable commits; the
two-record ending tail remained explicitly pending. No worker restart or new
worker failure occurred in this bracket. These values do not establish loss of
3,395 records. Snapshot counters cannot recover every intermediate protection
cycle or assign an exact cause to the old 96.345-second process maximum.

## Later predecessor protection increments

The original baseline above must not be extended beyond its timestamps. A later
public snapshot at **15:35:54.078 UTC** showed **four additional retained
protection breaches and seven additional unavailable checks** since 15:09:48.447,
with the same source/run/provider/configuration and original holding. Physical
settlements increased by 1,170 and complete responses by 1,169; no reported
HTTP 429 or unavailable-response counter increased. These facts do not identify
the cause of an individual protection failure.

The existing bounded read-only administrator workflow was requested again at
admin commit `c8f2c34b3ef7bae000330cbdc15b8e58e8950616` and completed as run
`41666437931`. Its source-bound export at **15:41:18.506 UTC** verified the same
PID 2806348 and runtime/configuration. The native status timestamp was
15:41:16.992, the latest usable completion was 15:41:16.902, and the current-run
maximum remained **96.345 seconds**. Retained counters were 132 breaches and
1,100 unavailable checks; the retained cross-run maximum remained 156.043 s.
The bounded prefix scan took 0.653 s and made no provider request, financial
write, service change or process launch. Its 512 selected records omitted the
physical-start/settlement and local-phase rows, and the predecessor does not
export the new consecutive-cycle receipts. Consequently this evidence confirms
new failures and resumed completions, but cannot establish their exact causes
or prove every intervening four-second boundary. No activation occurred.

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
  certificate. Current certificate-bearing rent/account preparation bypasses
  only optional setup smoothing when the complete sequence and protected reserves
  fit; prospective setup, physical limits and deadline checks remain enforced.
  Local quote admission refusal remains distinct from a provider
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
writes are included. The indexed synchronous implementation measured **110.06, 92.97 and
113.11 ms**, with candidate status peaking at 71.02 ms. The first detached
worker run measured **87.33, 36.24 and 30.91 ms**, with owner candidate status
peaking at **1.90 ms** and a separate cold worker snapshot taking 172.31 ms. The
final fixture also includes startup with no optional summary: startup publication
took **76.64 ms**, followed by **27.04, 28.92 and 21.87 ms**; owner candidate status
peaked at 13.26 ms across startup and subsequent reports. That separate worker
read took 74.92 ms. These samples characterize different cold/warm starts and
are not an assertion of a fixed worker duration.
The worker runs one coalesced consistent read after owned intake is durably
acknowledged; it neither constructs a watch owner nor holds a financial writer.
The main event loop never falls back to the expensive aggregate reads. A missing
or delayed summary stays explicitly unavailable or stale with its original
observation clock; current financial values, slot state and provider admission
remain owned by the runtime. Optional summary timeouts release only that
diagnostic expectation, without restarting intake or discarding unacknowledged
records. The release workflow runs this
representative benchmark separately with the **250 ms** assertion enabled. The
ordinary parallel suite uses a 10,000-row correctness fixture; its timings do
not establish representative capacity. These are controlled offline
measurements, not production latency claims.

## Coordinated replay evidence and limits

The existing healthy four-scope replay exercises actual candidate, financial,
V3.1 and shared request-accounting classes with explicitly synthetic market
inputs. It produces one real, timely, nontechnical no-trade economic receipt,
four completed original audit certificates, 53 physical starts with matching
settlements, and 39 usable holding-protection completions with a 2,080 ms maximum
gap and no breach. The deliberate 330 ms report phase in that replay tests
report-health scheduling behavior; the separate full-publication benchmark above
measures actual publication cost.

The additional physical lifecycle replay uses the actual `PilotNativeFlow`
subscription/retirement state machine and a local synthetic socket. It includes
a real second SQLite connection holding the nonfinancial writer during the
financial decision, followed by the normal deferred outcome/retirement path.
The decision completes with exactly three charged requests and one matched
nontechnical economic receipt. The retiring fourth subscription continues to
occupy capacity until an explicitly delayed unsubscribe ACK. That ACK arrives
at original window end +10.845 s, before its own original retirement deadline
of +14.370 s. Fresh support and a separate subscribe ACK admit the replacement
at +16.845 s. No old audit certificate is inherited by the replacement.

All 72 physical starts settle; 10 are native controls. Observed maxima are
16 starts/10 s and 56/minute, within the unchanged 20/90 limits. Forty-six usable
holding-protection completions have a 2,160 ms maximum gap and zero breach.
Two peer original windows complete; one competing original peer audit window
expires under the measured pressure. That failure remains explicit and is not
an economic decision. The test neither extends the decision certificate nor
renews preparation timestamps. It demonstrates occupancy conservation and the
next feasible replacement sequence, not universal success of every competing
audit under that load. Neither replay is production acceptance or a measured
market opportunity rate.

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
The unchanged installer permits recovery to the original source only before
its durable `possibleSourceStart` flag is set and only with unchanged source,
configuration and financial prefixes. Once the target might have started, its
reviewed recovery completes or restarts the target manager; it does not downgrade
the runtime or restore an older portfolio over newer financial events. Reporting
must retain the target-compatible forward handover route after accepting the
target. A reporting restart must be followed by checks of the external snapshot
sequence, original lifetime anchors and newly delivered signed AI status.
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
