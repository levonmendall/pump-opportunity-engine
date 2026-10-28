# Finite two-hour candidate-only continuation profile

Prepared offline from `60b93929bf3373a84a024b8712da2ca2e69e71e2`. This is an explicit research resource profile, not a deployment, financial-entry authorization, two-hour operating pass, provider entitlement, or profitability result. Merge the separately reviewed dispatch/subscription repairs and rerun relevant regressions before a longer forward interval. The active frozen EC2 package was not edited.

Select `candidate-native-two-hour-research-v1` explicitly. Without it, the native launcher still defaults to900seconds, allows at most1800seconds, and retains its existing allowances. The profile keeps six deep slots, the existing strategy/data contract, complete60second observation windows, support freshness and audits. It creates no account, ledger, position or financial writer.

| Resource | Existing finite launcher | Explicit two-hour profile |
|---|---:|---:|
| Default / maximum elapsed | 900 /1800s | 7200 /7200s |
| New RPC/control units | 1500 | 7500 |
| New accounting chapters | 32 | 64 |
| RPC/native/discovery related response cap | 256MiB | 2304MiB |
| Selected native socket receipt | 220MiB | 2048MiB |
| Broad WATCH receipt | 1024MiB | 8192MiB |
| Migration receipt | 5MiB | 40MiB |
| Retained evidence | 128MiB | 1024MiB |
| CPU time | 240s | 1920s |
| RSS | 384MiB | 384MiB |

The same one physical-operation gate,60starts/rolling minute,20starts/rolling10seconds and250ms start spacing remain.7500units is a ceiling including controls; it does not allow7500physical starts in7200seconds under60/minute pacing. Each chapter still allows at most200starts and five minutes. More than64chapter turnovers from repeated failures ends the run rather than discarding history or expanding its budget. Existing Retry-After/backoff and uncertainty handling remain authoritative.

## Why accounting needed correction

The current Cloud research chain measured114explicit paths,2,954,312file bytes,4643cumulative starts, and a66,397byte last book. Adding the two-hour7500unit ceiling means12143timestamps; their JSON array alone needs approximately170KiB, before the current chapter's reservations, actual invocation identities and durations. The former128KiB read/write ceiling cannot represent that history. A real next interval must also include the current EC2 trial's settled additions.

`ComponentBudget` and `readResearchBaseline` now share a512KiB per-book bound. The reader checks an unchanged32MiB aggregate bound before each bounded read, rejects concurrent file changes, and preserves exact hashes, cumulative debits, old429evidence and uncertain reservations. It never scans directories or deletes/relabels earlier chapters. The generic32-path default and256explicit-path maximum remain. The new run reserves64paths and therefore refuses an input with more than192prior paths before creating a run. The current114path chain leaves headroom; eventual append-only summary compaction remains future work if history approaches that boundary.

Only the explicit two-hour RPC profile permits two-MiB authorization/status metadata and related-response allowances above the existing256MiB component envelope. Existing lower-level defaults remain unchanged. The larger JSON envelopes do not raise per-response payload limits, physical concurrency or provider rate limits.

Offline regression fixtures use20000historical starts—larger than the requested initial projection—and verify persist/grow/close/reopen/link. Another fixture debits300MiB across chapters and a new linked run without making network requests. A many-book fixture reaches the32MiB aggregate stop; original files and hashes remain unchanged. These are storage/accounting tests, not measured network throughput or elapsed forward operation.

## Resource evidence and remaining uncertainty

Retained one-pool EC2 observation `evidence/high-activity-20261028/ec2-native-40619930479/analysis-summary.json` measured85.644s,1,302,385native socket bytes,1,285,604event-evidence bytes and3.661097CPU seconds. A linear six-pool/two-hour projection is approximately626.5MiB native receipt,618.4MiB event evidence and1846.7CPU seconds. This is a projection across a small sample, not measured six-pool capacity. The1920second CPU cap leaves little room above it; broad-stream work and nonlinear bursts could stop the run earlier.

Retained broad-stream evidence measured919,065,591bytes over895.303s of total elapsed time. That full-run rate projects roughly7GiB over two hours and is a **lower bound** on active receipt rate because setup and a111.926s closed-observation tail are included. An8GiB cap is not proof of two-hour WATCH continuity. The current900second native/broad trial must refine rates, CPU, evidence growth and provider failure assumptions before execution. Do not assume quiet traffic or count local filtering as a network saving.

The extended profile requires1344MiB free at startup:1024MiB evidence,256MiB unchanged low-water headroom and64MiB for new counterbooks, RPC metadata, status/checkpoint atomic writes and reporting logs. The low-water stop remains active throughout.

The native rolling notification/event caches stay bounded over their existing180/60second horizons. They are not enlarged to hide bursts. A gap, unsupported event, queue or cache stop still invalidates the affected window. Existing `maximumProcessingMs` is validated but is not an enforced synchronous parser deadline; this profile does not claim otherwise. CPU/RSS/watchdog observations cannot preempt a blocked event loop.

RPC/native/discovery traffic and broad WATCH traffic retain separate counters and caps. Native and discovery receipt are already included in the related-response cap and must not be double-counted as additional network traffic. Broad WATCH is not archived wholesale. Zero new API purchase does not establish zero EC2 transfer, CPU-credit, storage or reporting expense; the remaining existing allocation is unverified.

## Reporting and evidence boundaries

Status files still update every15seconds from one captured object, with original source facts separate from `generatedAt`. The extended profile archives a bounded initial set of full source objects and later hourly/final objects; it does not retain a full two-hour series of large repeated RPC/watch projections. Unarchived status payloads are not claimed as retained observations. The capture policy and4MiB publisher compatibility (including the file newline) are enforced before writes and covered by fixtures. An oversized periodic status stops the interval; final reporting drops only duplicated raw engine/watch-row/request-history detail with an explicit diagnostic, preserving actual account/source facts, counters, settlement result and STOPPED state.

A bounded synthetic full status with174watch identities and12143cumulative starts measured2,018,836bytes. Recording482copies would consume about928MiB before native event evidence, so the old all-cycle archive shape cannot fit a one-GiB combined evidence allowance. First four periodic snapshots, a later hourly snapshot and both final record copies total seven copies (14,131,852bytes) in this fixture, leaving separate room for native/feed/outer evidence. Actual host snapshot sizes and event growth still need measurement. Final status, receipt and watch checkpoint take priority over optional final full-source event copies when evidence headroom is exhausted. No current market time, bank Clock, audit, predictive or financial timestamp is fabricated to make a report look fresh.

## Start after review, not during the current frozen run

Prepare an exact source/input bundle with the actual settled prior chain, source hashes, watch checkpoint and reporting metadata. Confirm current provider cooldowns, host disk/memory/CPU and existing allocation; use OS timeout/CPU/file limits appropriate to the new finite interval. Keep the reporting publisher an independent read-only process. Do not reuse the old900second OS timeout or240second CPU limit while claiming a two-hour profile.

```bash
node --use-env-proxy --import tsx src/run-native-candidates.ts --run \
  --profile candidate-native-two-hour-research-v1 \
  --input /absolute/private/prepared-input.json \
  --directory /absolute/private/new-run-directory \
  --duration-seconds 7200
```

No command above was executed against live sources for this change. Any resource stop, throttling, failed settlement, missing source state or incomplete window remains a failure/degradation, not two-hour continuity. No PAPER financial entry or live trading is enabled by this profile.

Validation: build, compile and all1041repository tests passed in the isolated worktree. These include existing disposable-ledger fixtures; the new profile/accounting tests open no financial database. Full-regression elapsed80.447s is test execution time, not two-hour live operation. See `evidence/two-hour-profile-20261028/offline.json`.

The native candidate launcher now accepts a separate closed observation-policy
choice through public input `observationAgePolicy` or `--observation-age-policy`.
`observation-age-selected-24h-study-v1` permits activity-selected observation up
to24h; it retains the24-identity/one-deep older caps. The resource profile alone
keeps the original0–2h/selected2–6h observation policy. Entry remains5–120min,
six complete closed buckets and all data checks remain required, and this runner
creates no financial writer or entries. Active policy is included in config SHA,
status, assessments and checkpoints. Static creation proofs may be reused while
current support/ACK/windows are rebuilt; stale historical activity does not
become a new selection trigger. Age-only EXPIRED identities, including previously
selected ones, can be explicitly reselected by a fresh hint. Structural exclusions
and protection/capacity/defer guards remain in force. Expired/evicted unowned proof
caches can be released; original source evidence and protected obligations remain.

A fatal native source now closes candidate admissions and records/stops this
candidate-only process with its actual reason. This policy must not be copied to
a trader that owns positions: independent position protection must continue.
