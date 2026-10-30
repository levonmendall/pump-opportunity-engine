The four-slot runner has a demonstrated scheduling constraint under held-position load. This is separate from the actual 12.329-second protection breach reported during the new v2 holding: the controlled fixture cannot identify that live breach's cause.

The current individual history-page bound is2,000ms plus125ms validation. `pilotLowerPriorityAdmission` reserves4,000ms from the last genuinely completed whole-inventory protection evaluation, subtracts250ms setup,1,200ms for the next protection operation and the requested operation bound, then retains25ms dispatch margin. An audit therefore starts only while its current protection-completion age is at most400ms:

`4,000 −250 −1,200 −2,125 −25 =400ms`.

A500ms successful page returns after that opening closes. The next page ordinarily waits for another protection epoch even when the physical connection is idle, provider rate budgets are available, and no timeout has occurred. Required heartbeat/control work has different openings (1,325ms/825ms). The125ms outer source-step admission does not make its nested2,125ms page admissible.

Actual critical path and blockers:

| Activity | Existing authority and contention |
|---|---|
| Pending financial actions | `run-native-paper.ts:317`; due action runs before discretionary work, one action per trader tick. Compound execution/quote handling can delay the next loop turn. |
| Held protection | `run-native-paper.ts:318`; target starts every2s, completion boundary4s. Completed fresh quotes, not connected sockets or timer starts, renew `lastCompleted`. The main loop awaits the complete protection call. |
| Candidate financial workflow | `run-native-paper.ts:324`; an entire SDK preparation/quote/financial workflow is awaited in one outer turn, with a9s phase declaration. Per-request admission and nested `withProtectionWork` rechecks are separate from a whole-workflow protection guarantee. Financial agent owns the urgent compound-path investigation. |
| Ownership, financial maintenance, resources | `run-native-paper.ts:263,270,319`; synchronous bookkeeping, ledger/evidence records, resource/filesystem reads, USD completion and cash maintenance execute in the same event loop. Actual phase timing is retained privately; aggregate low CPU cannot exclude a pause. |
| Backup, entry-proof preparation, reporting/checkpoint | `run-native-paper.ts:319–324`; worker launch, evidence pinning, JSON serialization, atomic files/checkpoints and sync durable operations can consume local time. Their admissions must respect every committed page and actual held completion. |
| Source capture and native service | `native-candidate-runner.ts:307–327`; required support refresh, confirmed Clock ceiling, heartbeat, recovery and retirement can precede history work. Setup/retirement discretionary changes yield when ready audits exist. A ready peer missing a usable Clock ceiling currently requests a shared support refresh before any other page. This shared dependency is not independently proven defective. |
| Physical provider gate | `run-native-paper.ts:282–283`; one physical operation,250ms starts,20starts/10s and90/minute, independently persisted HTTP/history/control backoffs. Capture permission is separate from physical request headroom. Per-request admission rechecks actual financial runway. |
| Audit selection | `native-candidate-runner.ts:183,318–335`; original deadline, last page dispatch and allocation determine fairness; history-query cooldown, uninvoked retry floor and required native runway can block dispatch. Ready audits take priority over replacement setup and origin verification. Production optional HTTP batching remains disabled. |
| Audit page and prediction | `native-candidate-runner.ts:244–254`;1.5s physical timeout,2s logical page,2.125s reservation, full multipage census and original ten-second cutoff remain. Proven uninvoked pages are retained; changing source generation/cutoff invalidates them. An expired previously auditable window increments the deadline counter at`:297`, not a strategy rejection. |
| Admission/decision records | All mandatory validation/assessment/financial records must succeed. Storage failure cannot be relabeled as completed evidence. High diagnostic volume is not permission to lose required flow. |

Controlled reproduction uses the actual `NativeCandidateRunner`, `PilotRpc`, rolling physical gate and independent audit helper with injected market/provider responses. Four scopes include one3,000-row busy pool and quiet controls. This is neither a real provider measurement nor an actual held financial account.

| Injected history response | Four-target assessments with unpriced synthetic protection epochs | Expired original targets |
|---|---:|---:|
|25ms|4|0|
|250ms|4|0|
|500ms|3|1|
|750ms|3|1|
|1,200ms|2|2|

These runs had no modeled physical timeouts, one physical in flight and synthetic completed-protection gaps at most1,975ms. The first exploratory raw output predates the final test fixture's explicit90/minute/20-per10s setting; final97-test output repeats the same result against the final source. Both are preserved, not presented as live measurements. Physical fetch counts in these11-second model intervals can include the next bucket; assessment/miss counts isolate the original target.

A bounded early actual protection planner is implemented in `src/native-held-audit-scheduling.ts`, with no runtime integration yet. It requests an earlier protection turn only when the ordinary2s cadence cannot fit the current EDF one-page commitments, the original audit and native-service cutoffs still permit a bounded financial read plus first page, current source/physical gates permit it, and both rolling request windows retain the existing four management starts after the known financial request plan plus one audit page. Unknown cold request cost, incomplete whole-inventory protection, an unfinished protection attempt, pending actions, provider backoff, exhausted headroom and expired/prospective targets defer. A planner return creates no quote, completion, order or entry permission. The existing actual protection path must provide a new genuine completed whole-inventory evaluation before the page can start.

A second model charges each injected150ms warm protection batch to the actual shared90/minute,20-per10s,250ms-spacing, single-physical gate:

| History latency | Ordinary completed targets | Early-protection completed targets | Ordinary/early total physical starts over11s |
|---|---:|---:|---:|
|500ms|2|3|8/12|
|750ms|2|3|8/12|
|1,200ms|1|3|8/10|

All six charged runs retain zero modeled timeouts and completed synthetic protection gaps at most2,000ms; observed10s starts never exceed12. The additional requests improve useful coverage but do not recover every busy target. This helper is therefore an incomplete scheduling improvement, not a full solution or a reason to deploy ahead of the urgent protection repair. Source support/heartbeat costs and genuine SDK decoding are not modeled by these injected protection completions. A full financial-path test and sustained actual provider/resource measurements remain necessary.

Coherent implementation priorities:

1. Repair the measured holding-protection failure without relaxing4s or clearing its hard pause. Ensure compound successful SDK/rent/price/evidence work cannot monopolize required completion scheduling, and preserve the current failed-interval evidence.
2. Use deadline-aware actual financial turns and fair per-page work under the same durable rolling provider accounting. Share coherent SDK/Clock support with holding-pricing reads where validated; the current separate support and held pricers otherwise repeat acquisition.
3. If a second physical channel is chosen for protected finance, retain one financial writer, globally reserved rolling rate starts, actual transport settlement and provider backoff. Merely removing an in-flight guard is unsafe and does not prove provider capacity.
4. Keep original qualification windows, complete history, original decision deadlines, quote freshness, source identities and failed-packet accounting. Do not increase deadlines or lower operation bounds to manufacture coverage.
5. Expose or export bounded current-run per-target dispatch reasons, physical timings, local phase maxima and held evaluation failures through the existing operational evidence path. Those private records already exist; public aggregate counters cannot attribute all live deadline misses or the12.329s breach.

Verification:97/97 focused tests and TypeScript build passed. No main checkout application edit, service action, financial database read/write or provider request was performed by this work. The new planner is IMPLEMENTED BUT NOT INTEGRATED/NOT FORWARD VERIFIED; all real market claims remain with the parent's retained forward evidence.
