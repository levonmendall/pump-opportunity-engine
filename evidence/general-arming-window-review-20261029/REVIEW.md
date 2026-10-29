Read-only general-arming critical-path review, 2026-10-29

The deployed application source reviewed is ba33ee535ad1703da36905a5e2f44088ae19a43d. The isolated review worktree starts at evidence/operator-only descendant f31967e. No application implementation was changed, no RPC was issued, and no operating financial state was read or written.

Observed operation supplied by the parent

- Owner reset at22:16:55 cleared the current daily-loss latch.
- Fresh new-source Render acknowledgment became available after22:19.
- Early complete active assessments were followed by READINESS_REQUIRED.
- Actual source22:22:27.976 / snapshot10403 reported entriesENABLED, blocker null,16 active preliminary assessments and5 preliminary passes. This disproves a persistent arming outage in that observed interval.
- Preliminary passes are not executable qualification or fills. This review does not claim a trade, protection result or missed profit.

Critical path and all source-visible blocking activities

| Stage | Required state / activity capable of blocking it | Source |
|---|---|---|
| Exact independent audit | Correct candidate identity, active connection/ACK generation, complete60s flow, independent executed-flow reconciliation, certificate bounds/hash and the original decision deadline; provider/pacing, pending deadlines, resource admission and protection priority can defer audit acquisition. | native-candidate-runner.ts / native-paper-contract.ts |
| Mandatory assessment persistence | Baseline assessment and, for v2, active assessment are recorded synchronously before onAuditAvailable. Record/serialization/SQLite or filesystem work consumes real cutoff time and may fail closed. Active profitability does not gate callback dispatch. | native-candidate-runner.ts230–242 |
| Immediate readiness callback | Persistent service, current work phase source, zero physical in-flight/waiting RPC operations, and idle trader. Failure skips this immediate callback; weak rejected candidates retire immediately afterward. The local maintenance timer can retry surviving candidates, but must not fabricate a retired window. | run-native-paper.ts289 |
| Local maintenance dispatch |250ms timer /1000ms target; not stopped or management-only; not candidate/protection/pending financial work; trader idle; flat with no pending obligations. Financial work and existing positions take priority. | run-native-paper.ts288 / NativePaperCashMaintenance |
| Current financial context | Flat cash accounting, functioning original writer, original USD timestamp no older than10s, valid positive price. Missing USD enters the known temporary pause. Mandatory reconcile is synchronous; its real elapsed time is rechecked. | native-paper.ts151–162 |
| Permission recovery admission | recover requested; controls not already enabled; no daily-loss latch; recovery/evidence/financial state available; zero uncertain actions. Financial admission additionally requires source health, provider not closed/fatal/cooling, current reporting projection, no overdue protection, healthy resource/evidence admission, backup, independent supervisor and real disk headroom. The current callback also requires physical RPC idle. | native-paper.ts162 / run-native-paper.ts286–288 |
| Original audited market cutoff | Candidate registered and (if supplied) matches freshly audited mint; certificate exists; original windowEndAt is not in future and no more than2000ms old. The same cutoff is checked again immediately before resume. A new audit timestamp does not refresh old market flow. | native-paper.ts165 /172 |
| Candidate evidence readiness | Entry history/reentry restrictions, verified migration age, current source connection/support/no quality loss, exact current features hash/window and unexpired independent certificate. Neither baseline nor active predictive pass is required. | NativePaper.ready / entryHistory / entryAge |
| Owner and hard-control authority | An ordinary recognized temporary pause is recoverable. Owner stop/manual pause, new hard pause or unknown/hard history cannot be auto-cleared. The exceptional internal-stop path requires exact same-account/revision bounded ordered control proof. | native-paper.ts166–169 / ledger.internalShutdownRecoveryProof |
| Authenticated ledger resume | Ledger validates the original marketAt no older than2s, current UTC day, financial reconciliation no older than2s, no current loss latch, explicit readiness booleans and bounded version/evidence. It is still a permission action, not an order. | ledger.ts399–410 |
| Mandatory readiness proof and final checks | Required readiness record must persist; final safety, admission and current ledger projection must still be good after real recording time. Failure cannot be reported as successful recovery. | native-paper.ts174–176 |
| Subsequent trading authority | Permission alone never substitutes for predictive qualification, complete independently audited decision evidence, fresh actual-size pricing, source/provider/protection capacity, risk and order identity checks. Reservation/attempt recheck financial state; no duplicate or stale order is manufactured. | native-paper.ts candidate / trader.ts / ledger.order / ledger.attempt |

Controlled fixture outcome

One new test exercises two otherwise equivalent complete weak windows at original cutoff+1500ms and+3000ms. In both cases NativePaper.ready is true under the existing exact independently audited certificate contract (deadline windowEndAt+9999), financial reconciliation is performed at the real current time, USD is current, no RPC/quote/entry/order is attempted, and no predictive pass exists. At1500ms general permission recovers; at3000ms it does not.29/29 focused tests passed.

This proves that the general market-cutoff requirement is a separate stricter condition than the strategy decision deadline and the2s financial reconciliation condition. It does not prove the live early pauses had this cause: the public observations omit exact certificate windowEndAt and every individual recovery refusal. The parent then observed genuine autonomous recovery without another reset or deployment.

No implementation change is recommended solely from the early cold-run pause. If later actual missed executable opportunity evidence demonstrates this policy is unnecessarily restrictive, a coherent change must preserve the original window cutoff and independent decision deadline, current2s reconciliation, actual-size executable quote freshness, required evidence, owner/hard controls and duplicate-order prevention. Do not substitute audit completion time for original market time. Any change to the ledger's readiness schema/market-age validation must also update the strict historical resume validation in internalShutdownRecoveryProof (ledger.ts681), with legacy receipt compatibility; an isolated bridge-only timeout change would fail or damage recovery.
