# Derived RPC status persistence reduction

Implemented in an isolated worktree from `90625f53b686578637accf73ebc457f841743ee2`. The lead checkout and its frozen forward run were not modified.

The duplicate is established: each `accountControlBytes` chunk first durably updates the authoritative `ComponentBudget` chapter, then previously wrote a second durable projection to `rpc/status.json`. Only that second, derived write is coalesced. Financial state, request reservation before I/O, exact byte accounting, chapter persistence and provider limits are unchanged.

Successful passive receipt now marks the projection dirty and uses one non-resetting trailing timer, with at most one second of **scheduled** delay. A receipt that reaches that deadline flushes immediately. Event-loop stalls can make an actual timer late; source generation times, pending age and maximum observed dirty age remain explicit. Live `usage()` always reads current state. The projection timestamp is metadata generation time, never market observation time.

Constructor/chapter/method-start/admission/cooldown/operation-finally/close writes still flush synchronously and cancel any pending timer. A timer write failure is contained, counted and reported; admissions stop. Authoritative receipt still reaches its durable chapter before any derived status failure. No automatic retry or hidden background request is added.

## Measured result

Final paired **Cloud filesystem synthetic microbenchmark**, 500 identical 1024-byte chunks per version, 9 ms virtual arrival spacing:

| Measurement | Baseline 90625f5 | Coalesced |
| --- | ---: | ---: |
| Authoritative writes during receipt | 500 | 500 |
| Derived writes during receipt | 500 | 4 |
| Measured loop time | 196.04 ms | 105.26 ms |
| Process CPU for loop | 103.05 ms | 49.06 ms |
| Derived save time | 59.42 ms | 4.36 ms |

Derived write count decreased 99.2%; measured loop time decreased 46.3% in this sample. The exact SHA256 chain of **all 500 per-chunk authoritative files** and final authoritative file SHA256 match between versions. Units, received bytes, inherited uncertainty and final projections match. No request, API traffic or provider-cost savings are claimed.

The first paired sample is retained separately. These are bounded microbenchmarks, not EC2 capacity or forward-market evidence. Filesystem cache, host contention and JIT affect elapsed/CPU measurements; the authoritative save time itself varied between trials. The stable result is removal of redundant derived writes without changing the authoritative books.

## Verification

Final focused result: **68/68 tests passed**, covering RPC, component-budget and five new derived-status tests. Build passed. Independent review: GO for source SHA256 `2a885ee841277d47b09e1d3751174f39c3f39236d6abe3488a7f916a820c8477`.

The new tests check durable bytes after every chunk, fresh live usage versus an honestly older file, a silent-tail timer flush, synchronous operation/cooldown/final flush, timer cancellation after close, contained derived-disk failure, and an actual child process exiting before the pending flush. That abrupt-exit case recovers all 77 bytes and inherited uncertainty from chapter books rather than the stale projection. The initial build's test-only literal typing failure and its corrected final build are retained.

Reproduce from this component branch:

```bash
node --import tsx --test test/pilot-rpc.test.ts test/pilot-rpc-derived-status.test.ts test/component-budget.test.ts
npm run build
node --import tsx scripts/benchmark-rpc-derived-status.ts /tmp/poe-derived-status-benchmark.json
```

All test state is disposable and synthetic. No provider request, wallet, trading account, real counterbook, deployment or live runtime was used. The component is ready for lead integration and repository-wide regression verification. Measure actual EC2 save pressure and forward scheduling behavior before claiming that an operating bottleneck is resolved.
