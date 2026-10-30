# Native candidate path → isolated PAPER: focused wiring review

Read-only source review on 2026-10-28; inspected lead HEAD `e7ffe502161a3d4f965cc30c4d6a75f3776744fa` plus retained evidence. No provider request, test execution, financial-file read, runtime change, or deployment was performed by this review. The commands below are reproduction instructions, not newly obtained passes.

## Decision

Reuse the existing financial runtime; do not build another ledger, order engine or provider platform. `src/pilot.ts` already composes the isolated account, `PaperTrader`, `PilotMarket`, protected dispatcher, backups and financial reporting. `src/run-native-candidates.ts` instead composes the newer native source and auditor **without any financial writer**. Its `onTrade` callback currently increments `NativeCandidateRunner` counters and does not feed a trader. The passing native/PAPER interop test is a disposable composition inside `test/native-paper-interop.test.ts`, not a production adapter or a natural trade.

There is no new owner credential or real-money authorization needed to close that integration gap. The present six-slot failure-containment/audit-priority defects remain operational prerequisites; merely changing mode cannot fix them.

## A defensible versioned source contract is possible

Do not simply relabel `confirmed-program-activity-v3-shadow` or switch its `financialQualificationAllowed:false` flag. Preserve that historical contract. A separately identified experimental **program-authoritative ordinary-flow PAPER** contract can deliberately use:

- Successfully executed, confirmed/finalized Pump AMM program event amounts, integer fee fields and event `user` attribution, bound to freshly verified canonical SOL pool/mint support. User addresses are program-reported trader roles, not fee payers or independent people.
- Actual `(signature, program, log index, frame ordinal)` identities. Compiled instruction indexes are not available and are not required merely to uniquely identify an event under this explicit contract.
- Original receipt and complete-validation times; the program Clock is not `getBlockTime`. Preserve the existing receipt-usefulness, support/source-age, correction, cutoff and truncated/unknown-frame refusals.
- Independently completed pool-signature coverage for the exact current 60-second window and ACK generation, admitted before the actual decision deadline. A future audit cannot warm an earlier decision.
- Separate validated protocol pool effects. A protocol burn is not an ordinary buyer, net buying or an external-wallet price observation. Known reserve-changing effects must advance the quote slot floor. Unknown/unsupported effects must invalidate the affected window.

Source support is substantive: `program-log-mapping.ts` checks exact pinned IDL bytes/frame grammar and maps the fields actually used by the strategy. `evidence/high-activity-20261028/log-native-after-legacy-buy-repair.json` records **96 paired accepted transactions/events** with equal event bytes/economic fields, covering direct/routed Buy/Sell variants; fee payer differed in three and program Clock differed from block time in 25. This is retained field validation, not live continuous completeness. The newer native forward records provide actual notification/audit evidence, including failures.

The concrete unavailable assertions are **per-transaction SPL transfer cross-checks and compiled account/instruction identities**, not missing ordinary-flow amount/trader fields for the supported event shapes. Do not claim those assertions became verified through sampling. They need not remain permanent prerequisites for an explicitly different PAPER evidence contract if event authority is deliberately the contract, matched field regressions remain intact and unsupported shapes fail closed. Full transaction fallback remains necessary only where a required shape/role/amount cannot be established by that contract. Real multiple-swap coverage is limited; synthetic mechanics cannot establish prevalence or complete natural variant coverage.

The V3 ordinary-flow exclusion of protocol operations must be named as a data/feature-semantics choice, not retrospectively called a strict-V2 pass. Existing strict baseline results remain separately attributable. Current entry thresholds, actual-size pricing and financial safety rules need not change to implement this source contract.

## Smallest integration checklist

1. Add an explicit frozen native-source selection to the existing isolated `runPilot` composition. Keep its existing account/inception, single writer/leases and `resume` path; do not initialize capital. Import only verified origin proofs and freshly supported canonical identities, retaining the existing baseline books and unresolved-transport state.
2. Route native candidate admission/actual subscription ACK to `PaperTrader.admit` / `activateFlow`; route each validated ordinary `trade` to `ingest(trade,'curve')` with its original availability time. Apply `PilotMarket.minimumSlot` to ordinary trades **and protocol effects**. The latter needs a bounded explicit callback/existing event hook; a diagnostic summary alone must not silently become an earlier quote floor.
3. Expose a bounded exact-window audit certificate/readiness accessor from `NativeCandidateRunner`, instead of parsing logs to authorize money. Bind mint/pool, ACK generation, window start/end, result and actual availability. Use it for `predictiveReadiness`; financial `candidateReadiness` additionally applies unchanged entry age, source-contract eligibility and current data readiness. A candidate tick after a late-in-bucket audit is already supported without a pre-audit quote (`pilot-trader` regression).
4. Route scoped loss to `candidateGap`, which cancels only that mint's unattempted buy and preserves unrelated financial obligations. Watch states must reflect actual `ENTRY_PENDING` / `HELD`; native demotion/expiry must not remove owned pool proof, mark cache or pending-order state. Held-token flow is not required by the current exits, but pending entry evidence remains owned until outcome/expiry.
5. Reuse `PilotMarket.prepareEntryCosts`, per-mint deposit plans, decision quote and delayed `executionQuote`; do not fill against the native event price. Keep original slot floors, current rent, 1-second delay, 5-second expiry, 1% modeled slippage, embedded SDK fees and modeled gas. Preserve post-delay fresh reconciliation before a buy.
6. Reuse the existing protected loop in `pilot.ts`: pending financial actions and coherent holding pricing precede native controls/audits/replacement admission. Candidate source failure may suspend/rewarm candidates; it must not execute the candidate-only launcher's whole-process shutdown when exposure exists. Record real completed evaluation gaps; a status heartbeat or fresh mark alone does not reset them.
7. Reuse `FinancialBackupStore`, `PaperExecutionCoordinator.recover`, same-account resume and immutable startup provenance. Recovered buys cancel; uncertain sells retain exposure until resolution/expiry. Restart warms current market context without replaying the whole outage. A finite run must checkpoint unresolved exposure; extended supervision must continue management rather than fabricate liquidation at a research time limit.
8. Reuse `buildPilotPortfolio` / `pilotExperimentalAccounting` and the dedicated authenticated `/api/pilot` publisher. The native candidate projection currently hardcodes financial zeroes/nulls by design; a trader status must instead use the validated ledger projection. Keep source fact times, original Render portfolio identity and dedicated pilot identity separate. Publish/report asynchronously, outside protection/financial work.

## Reusable mechanical proof and remaining live evidence

`test/native-paper-interop.test.ts` demonstrates official-layout native events → independently audited window → real SDK delayed buy → retained uncertain pending exit across restart → fresh maximum-hold exit and reconciliation. It also demonstrates shadow refusal, prior-bucket audit refusal and a protocol-driven quote floor. Inputs/times are controlled, not natural trades.

`test/progressive-pilot-fixture.test.ts` / `scripts/progressive-pilot-fixture.ts` exercise one-account progression to three positions, shadow candidates while held, outage retention, three exits, exact costs and backup/restart. `test/pilot-concurrency.test.ts` separately preserves a real failure of the modeled overlapping entry/exit envelope rather than claiming concurrent fills succeeded. `research-held-market` tests prove fresh post-delay full-size mark reuse and source expiry; execution/backup/reporting tests cover idempotency and durable projections.

Focused offline commands (no provider credentials or live ledger needed):

```sh
node --import tsx --test test/native-paper-interop.test.ts test/program-log-mapping.test.ts test/protocol-flow-evidence.test.ts
node --import tsx --test test/pilot-trader.test.ts test/pilot-integration.test.ts test/progressive-pilot-fixture.test.ts test/pilot-concurrency.test.ts test/research-scheduler-execution.test.ts
node --import tsx --test test/research-held-market.test.ts test/execution.test.ts test/backup.test.ts test/pilot-reporting.test.ts
npm run build
```

Before calling the integration operational, require the **actual integrated executable** to demonstrate: source callbacks/audit certificates matching the trader's current window; qualified natural or explicitly controlled isolated entry with valid quote/deposit; actual held evaluation timing under concurrent candidate work; delayed exits and reconciled costs; same-account restart with retained obligations; persistent source-accurate Render reporting. Existing field parity, pricing components and fixture passes should be reused, not represented as those combined forward outcomes. No 24-hour acceptance claim follows yet.
