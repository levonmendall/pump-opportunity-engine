# Combined deadline-path validation review

Independent read-only review at lead `474392339127408e537cc9ba595fd9d290ce45b3`, covering the frozen c189 runtime and the three preceding path maps. No runtime, provider, account or deployment changes were made. This is a validation contract for the coherent repair, not a claim that the repair exists or has passed.

## Review conclusion

The maps cover the relevant application path and shared resources: capture, six closed buckets, lower and upper context fences, required native controls, physical admission/settlement, every history page, domain/completeness validation, predictive admission, and optional financial preparation. They also cover synchronous work outside the runner. No additional independent queue or provider budget is justified.

The remaining attribution gap is empirical: a mapped possible blocker is not the demonstrated cause of an individual c189 failure. The final source-pinned trace must join each target to actual competing jobs, physical occupancy, response and validation availability. The earlier first-PAPER trace showed no-header single timeouts, partial-body batch timeouts and selected-without-session misses; these are different failure classes.

Before implementation is called sufficient, explicitly cover these cross-layer details:

- Retirement is a resource obligation with a bounded lifetime, not necessarily an immediate absolute priority over every peer audit. Slow unsubscribe/late close must be modeled; a logical slot is not physically free before settlement, and retired correction obligations cannot disappear.
- Future first-window protection must not turn into permanent migration starvation. A nine-second monolithic verifier cannot fit in every ten-second cycle; resume bounded physical-read progress, preserving real read timestamps and unusable partial proof until validation completes. A longer internal coroutine lifetime must not extend market/source/quote validity.
- Planned native action and actual selected service must use the same classification. An early heartbeat request that instead executes discretionary union support/setup would defeat the admission calculation.
- Per-request protection is necessary inside multi-read entry preparation and verification. A single guard before an awaited chain does not reserve the rest of the path.
- A wall-clock timer cannot preempt synchronous JSON, SQLite or fsync. Admit known optional spans using common slack, measure actual overrun, and fail affected windows closed. Mandatory capture/accounting remain protected and correctly charged. Instrumentation alone does not bound an unmeasured synchronous operation.
- Report/backup deferral needs its own bounded liveness policy; indefinitely hiding current status or abandoning recoverable backups is not an acceptable way to improve audit counts. The publisher must not freshen old source timestamps.

## Combined offline matrix

Run through actual runner/native-service/outer-admission interfaces with one shared dispatcher. Existing isolated tests can be reused, but tests that stub a competing operation to zero duration cannot establish contention correctness.

| Case | Stimulus on the same chronological clock | Required result |
| --- | --- | --- |
| First complete windows | Three and six ACKed warming scopes; new origin arrives immediately before the first six-bucket window closes | Future eligibility appears before discretionary admission; no long verifier/setup chain consumes committed audit runway. No shorter warming or backdated start. |
| Re-promotion | Demote and later re-ACK a known identity while peers are ready | New generation obtains a new full window; old certificate/partial history is unusable; known support proof reuse respects current freshness. |
| Steady feasible load | Sustained three/six scopes, ordinary + failed + protocol notifications, 200ms recorded-like one-page responses, 50/100ms step jitter, realistic 250ms start spacing | Fair per-target validated decisions within original cutoffs, no distinct successful event/page loss, bounded queues/resources. This is simulated scheduling, not actual provider capacity. |
| Slow retirement | Several peers reject; unsubscribe occupies 700/1500ms and one cancellation settles late | Cleanup remains bounded and counted; peers receive feasible audit service instead of unconditional cleanup precedence. No slot or physical gate released early. |
| Multipage peers | Two busy pools require several pages while a quiet peer is ready | Fair continuation opportunities; original page/byte/target bounds remain. A full page without the lower fence never passes as complete. |
| Feasibility overload | Six simultaneous one-page targets each require the declared 2s operation bound, then add support/control/holding demand | Explicitly refuse/suspend excess candidate promises or mark windows unusable. Do not claim all six are guaranteed: 6×2s=12s already exceeds the 9,999ms target interval. |
| Origin fairness | Continuous audits plus a multi-read migration proof; brief slack opportunities across cycles | Finite verified-read progress without monopolizing the physical gate; no repeated expensive prefix reads solely due yielding, no partial proof admission. Infeasible overall demand remains explicit. |
| Source action agreement | PONG, retirement, required support, early ceiling refresh, pending subscribe and heartbeat all become ready in varied orders | Admission's planned action equals actual dispatch; mandatory liveness/source requirements preserved; discretionary setup cannot surprise the caller after admission. |
| Financial priority | Simultaneous owned exit, held coherent batch, due entry and several audits | Owned obligations win; quote≤2s/source≤30s unchanged. Lost candidate windows explicitly suspend/invalidate and cannot admit entries. No claim of protection when price is unavailable. |
| Peer entry preparation | One audited not-rejected candidate performs support/rent/quote reads while peers' audit deadlines approach | Per-read common admission yields/refuses new-risk work as necessary. Preserve own exact certificate expiry, size/context floor and qualified-but-unfilled outcome. |
| Reporting/checkpoint | Report due and checkpoint/manifest writes are injected before and across eligibility; add 50/100/250ms jitter and a real overrun | Common slack admission prevents known conflicts; measured overrun remains visible and late data is rejected. No generated timestamp makes prior observations current. |
| Backup startup/rollover | Due backup holds lock, private-path checks, SQLite/worker setup and evidence rollover while audits are ready | Parent synchronous setup is included, not mislabeled off-thread. No unbounded sync lock wait; backup remains recoverable. Preserve source/financial history. |
| Receipt/persistence pressure | Bursty notifications plus counterbook/recorder/SQLite fsync stalls and garbage-collection-like pauses | Required received bytes/evidence charged, stale or late observations fail closed, no silent backlog/drop. Actual callback availability retained. |
| Pre-start pacing | A discretionary job reaches the gate before an urgent job, but has not invoked because spacing/rate time has not arrived | No incorrect physical release/refund; any safe reselection occurs before invocation. Inherited rolling starts and both transports still share one budget. |
| Timeout/cancellation | HTTP no headers, partial body/no EOF, late body, late ACK, timeout callback jitter and actual close after logical expiry | Physical occupancy persists through settlement; no concurrent hidden operation; uncertain bytes remain; response and validated availability timestamps are separate. |
| Provider recovery | 429/503/Retry-After and pool-local history cooldown while healthy notifications continue | Correct bounded recovery without endpoint/identity rotation; healthy capture survives HTTP cooldown; expired support invalidates actual affected scopes. |
| Generation/evidence failure | Missing successful signature, independently failed missing row, correction, unsupported successful frame, disconnect and stale lower/upper fence | Successful unknown activity still blocks completeness; independently verified failed diagnostics follow the established contract; no priority change weakens evidence checks. |
| Cutoff/resource stop | Request admission before cutoff but body/validation after it; evidence/CPU/disk limits during active work | Stop new information admission exactly at cutoff; byte accounting and actual transport settlement continue; positions/reservations persist; no synthetic liquidation. |
| Unavailable to recovered | Restart with pending action/holding and interrupted candidate windows | Same account and obligations, no duplicate fill/reseed; current candidates re-warm rather than replaying the whole downtime; source interruption remains visible. |

A useful assertion is per target `(mint, openedAt, connection, subscription, windowStart, windowEnd)`, not only aggregate counters. One target may contribute audit-unavailable, deadline-miss and data-gap diagnostics; do not add them as independent lost opportunities. Each target must end in one primary outcome with additional causes linked.

## Required joined measurements

For every target retain bucket close, actual first eligible observation, lower/upper fence and source availability, all selected/refused competing jobs, per-request reservation/pacing/start, headers/first/last body/EOF, timeout/abort request, actual settlement, JSON and domain validation, certificate and predictive availability. Record optional local spans and per-phase wall/CPU, plus maximum synchronous stall/event-loop delay. Preserve raw received bytes, page sizes, successful/failed/unknown history denominator, scope/generation and source/config hashes. Connection reuse requires direct transport instrumentation; neither a default Agent nor average request rate proves it.

## Forward gate after the consolidated offline pass

Freeze all changes together. Run long enough to exercise repeated ready-window cycles, turnover, source maintenance and recovery under actual selected demand; retain a quiet interval as quiet, not as a busy-capacity pass. Start at the measured supported concurrency and increase only when the envelope supports it. A sustained interval must expose both normal traffic and real bursts/multipage demand; if natural conditions lack a required case, name the missing case and retain separately labeled stress evidence.

Compare unique eligible tokens receiving timely verified decisions, per-target failure causes, page/request/byte demand, dispatch and validated-decision latency, peer fairness, actual source gaps, resource trend and financial protection separately. Raw window count, lower average RPC use or zero entries does not establish success. No material avoidable contention mechanism may remain hidden behind total counts. Provider latency and irreducible overload remain declared operating limits, not scheduler passes.

The current c189 interval is baseline evidence for this change set. Its source must remain unchanged and its adverse results preserved. No 24-hour acceptance or natural holding/profitability claim follows from this review or the offline matrix.
