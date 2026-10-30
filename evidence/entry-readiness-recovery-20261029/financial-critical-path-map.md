# Financial-readiness critical-path map — 2026-10-29

Read-only diagnosis. No runtime/application change, provider request, service control, financial write, or deployment was performed for this map. Source inspected: `f2ab4593c4c1a5e8c04136685f536c2a647204b3` in the technical-reevaluation worktree. Its application contains the retained technical-retry repair; the observed original service still reported `cdba9d483fdcef105e74e3053a8d4bbf28bdff0c`.

## Verified source-timestamp comparison

The exact public rows are sequence 9307 and 9310 in the lead checkout's `evidence/issue11-consolidation-20261028/coherent-entry-forward-20261029/rolling-supervision/routine-5.ndjson` (lines 1 and 4 respectively). Independent correlation agreed with these values.

| Field | 9307 | 9310 |
| --- | --- | --- |
| Source generation (UTC) | 17:46:40.848 | 17:47:26.469 |
| Render receipt (UTC, independently supplied by lead) | 17:47:05.682 | 17:47:51.004 |
| Financial reconciliation (UTC) | 17:46:40.794 | 17:47:21.419 |
| Reconciliation age at generation | 54 ms | 5,050 ms |
| Original USD timestamp (UTC) | 17:46:38.023 | 17:47:23.220 |
| USD age at generation | 2,825 ms | 3,249 ms |
| Entries / reconciled | enabled / true | paused / false |
| Public blocker | null | explicit verified runtime readiness |

Both rows were flat with no pending order, same run `native-paper-20261029164842357`, same source/configuration, and healthy discovery/capture/watch/resource/evidence/supervision admission. HTTP timeouts stayed 285; errors/throttles remained zero. Primary cooldown had already expired at 17:46:03.063. The evidence does not support attributing this transition to a new provider incident. Both USD prices remained within their genuine 10-second validity contract.

**Conclusion:** 9310 necessarily fails the two-second reconciliation-age guard. This is a demonstrated local scheduling/validity mismatch. The public projection does not expose raw durable `controls.entriesEnabled` and `daily.paused`, so it does not establish that a new durable pause was written. The blocker is the historical control reason copied into a currently ineligible projection.

## Critical path and failure mechanisms

1. `run-native-paper.ts:222` starts asynchronous USD refresh at most every five seconds. The source timestamp is retained; validity remains ten seconds, not the fetch heartbeat.
2. `ResearchHeldMarket.context` (`research-held-market.ts:92`) reads the existing USD price and returns empty marks without a Solana RPC when inventory is flat. Held inventory instead requires coherent actual-size pricing, exact inventory, two-second quote freshness, and a confirmed bank clock no older than 30 seconds.
3. `PaperTrader.drain` (`trader.ts:276`) dispatches due financial actions, obtains/sanitizes context, reconciles, dispatches due actions again, protects holdings, and only then evaluates candidates. Context/read failure or unavailable current equity writes a real pause. Exact-size quote and source checks remain in the execution path.
4. `PaperLedger.reconcile` (`ledger.ts:286`) records current equity and reconciliation time, checks daily loss and day transition, but does not clear an ordinary previously established pause or enable controls.
5. `PaperLedger.resume` (`ledger.ts:313`) requires explicit readiness, original `marketAt` no older than two seconds, complete candidate readiness, recovery and budget readiness, fresh financial reconciliation, valid USD/held marks, and no daily-loss pause. It clears stopRequested if called, so callers must never invoke it blindly over owner/safe-stop controls.
6. `NativePaper.candidate` (`native-paper.ts:79`) currently calls resume only for a predictive-not-rejected candidate, after qualification-proof preparation, SDK entry-cost preparation, and another protection/reconciliation. A transient real pause can therefore remain after ordinary successful reconciliation until another predictive-passing candidate reaches this path. Feature-only failure assessment otherwise needs no quote/RPC.
7. Runtime loop due actions and held protection precede lower-priority work (`run-native-paper.ts:265–266`). Flat maintenance is instead at the bottom of the loop and only after at least five seconds (`:273`). Reporting/setup/source work and a declared 9-second candidate preparation can precede it.
8. `lowerView`/`localAdmission` (`:206–209`), `pilotLowerPriorityAdmission` (`pilot.ts:160`), and report admission (`run-native-paper.ts:127`) reserve held/pending/candidate work, but no flat reconciliation-freshness deadline. Moving the old flat tick to the top and changing its threshold alone does not preserve freshness across awaited multi-second work.
9. Ledger `projection` (`ledger.ts:641`) is read-only. Derived entries require durable controls enabled, no safe stop, no daily pause, reconciliation age <=2 seconds, and known equity. Projection failure does not itself mutate durable controls.
10. Public portfolio validation independently repeats reconciliation/price/mark validity (`pilot-reporting.ts:54`). Runtime reporting currently supplies `state.controls.reason` whenever derived entries are false, which can misleadingly display a past positive resume reason as the current blocker. `financialProjectionReady` indicates projection-pipeline integrity; a valid but unreconciled snapshot can still set it true, so the demonstrated pair is not itself proof of a 15-second recovery latch.

## Required coherent correction (proposal; not implemented)

- Add bounded, local cash-only maintenance with a target around one second and genuine headroom before the existing two-second financial deadline. It should not perform a full trader tick, issue a quote/RPC, or flood diagnostics. It can make progress during asynchronous candidate-source waits, but must not overlap held/pending/active financial operations. Include its deadline in blocking local-work admission, record actual lateness and write cost, and fail closed if freshness truly cannot be maintained. Keep USD's original timestamp and ten-second validity.
- Recover only explicitly allowlisted temporary readiness pauses. Check current owner/manual/safe-stop/daily-loss state; trader evidence failure, financial failure and unresolved-action latches; outstanding adapters; actual provider/resource/evidence/backup/reporting/protection admission; newly valid financial reconciliation; and complete current candidate evidence. A historical allowlisted reason alone is insufficient because later safety failures need not overwrite an already closed control reason.
- General financial permission recovery must not require a predictive pass or manufacture a new market/quote timestamp. The existing ledger API's two-second `marketAt` guard remains binding. One conservative, explicitly versioned global-readiness interpretation is an actual audited window cutoff only when it is genuinely within two seconds and every exact current-certificate/connection/source/feature check passes, with evidence text stating that no entry price is claimed. If that evidence is older, wait for a new valid window; do not stamp `asOf`, certificate admission, receipt, or a cached USD price as a new market observation. This semantic choice needs lead safety review before implementation.
- Preserve the independent per-entry proof, age, persistent-buying predicates, SDK cost preparation, actual-size quote, liquidity/risk checks, two-second order/attempt freshness, no-reentry and durable-accounting guards. General permission recovery alone must create no order or reservation. Preserve the completed bounded technical-reevaluation repair.
- Report current derived-ineligibility cause separately from raw durable permission/control reason. Do not turn a stale projection into an apparent durable financial pause or display an old positive readiness reason as a present failure cause.

## Focused verification required before a versioned deployment

- Reproduce stale flat projection across the exact five-second/two-second boundary without changing durable controls.
- Prove local maintenance remains timely across representative awaited source work and records real synchronous/event-loop overruns; measure ledger/evidence write demand.
- Prove a genuine temporary valuation pause can recover after all gates and fresh complete evidence become valid, without requiring a predictive pass or extra quote/RPC.
- Prove owner pause, safe stop, daily loss, evidence failure, financial uncertainty, provider/protection restriction, stale USD/mark/source, missing/old certificate and active/pending actions remain closed.
- Prove held/pending work retains priority; no duplicate action, historical rewrite, fake timestamp, relaxed qualification or ledger reseed occurs.
- Retain exact source/config identity, focused/full test output, and separate subsequent live evidence. No runtime repair or forward-success claim has yet been established by this map.
