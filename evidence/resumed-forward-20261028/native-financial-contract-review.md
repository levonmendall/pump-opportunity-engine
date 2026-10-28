# Native-to-PAPER contract review (read-only)

Reviewed existing root code descended from5362/63f4 and the separate native-paper
interop fixture. No tests, providers, credentials, ledgers, runtime files or active
source were touched. This is an implementation review, not forward acceptance.

## Exact reusable evidence contract

- `program-log-mapping.ts` validates successful confirmed/finalized notifications,
  the complete bounded invocation stack, official pinned IDL event bytes/labels,
  canonical supported pool/mint binding, executed integer base quantities, the
  exact Buy variant convention, curve/user quote amounts and individual fees.
  Trader is the program event's `user`, never an inferred fee payer. Distinct
  wallet addresses are not evidence of independent people.
- Real identity is signature + AMM program + log-array index + frame ordinal.
  `strategy.ts` already accepts this disjoint `program-log` identity. Do not
  fabricate compiled instruction/event indices. Multiple/routed events must all
  pass grammar, scope and variant validation; unknown/truncated/unsupported frames
  invalidate affected information rather than being silently omitted.
- Normalization requires support<=30s old, event slot>=scope floor, actual receipt
  and validation<=5s old, and program Clock timestamp<=30s old/nonfuture. Program
  timestamp is not `getBlockTime`. Strategy buckets use actual validated information
  availability; retain receipt/source times separately and never backdate.
- `native-flow-audit.ts` establishes bounded pool-address signature completeness
  between conservative strict slot fences. It does NOT establish SPL transfers,
  compiled indices, or amounts for missing notifications. Every page preserves
  original upper `minContextSlot`; gap/correction/ambiguous boundary/missing history
  makes the affected window unavailable. Reconnect requires fresh ACK generation
  and six newly complete closed10s buckets.

## Strict-v2 versus protocol-aware shadow

`confirmed-program-events-v2` is an explicitly versioned program-authored evidence
contract. `transferChecks`, compiled identity and transaction completeness remain
unavailable. Existing live sample/full-TX comparisons support only their actual
observed denominator, not per-event transfer verification.

`confirmed-program-activity-v3-shadow` additionally separates supported
BoostBuyAndBurn effects: protocol PDA reserve funding/base burn is not an ordinary
buyer, buyer count, or net external buying. Code explicitly states financial
qualification false, and affected baseline views are unavailable. Never rename
that existing contract or its historical assessments as financial qualification.

Native PAPER does not inherently require restoring a getTransaction request for
all events. The standing authorization permits a separately frozen, honestly
named program-event-authority experiment after its field/completeness evidence
and controlled lifecycle pass. That contract must explicitly preserve unavailable
SPL cross-checks and supported variants. For the smallest initial financial bridge,
accept strict-v2 current windows only; refuse any protocol-contaminated window.
A later protocol-aware financial version requires explicit feature/price-effect
semantics and separate forward comparison, not an arbitrary boolean change.

## Smallest remaining wiring

1. Reuse `PaperTrader.admit/activateFlow/ingest/candidateGap`, `PilotMarket`, existing
   execution coordinator, ledger, backup, recovery, risk and reporting. Native ACK
   activates at actual ACK time; trade callback ingests `curve` normalized data;
   candidate-local/global gap closes entry evidence while holding management lives.
2. Expose one bounded read-only audit-readiness certificate from the existing
   NativeRunner admission point. Bind mint/pool, subscription/ACK generation,
   exact window start/end, actual audit availability/deadline, contract and current
   quality/support. A recorded assessment or snapshot.auditVerified=false is not
   such a certificate. PaperTrader predictiveReadiness uses current audited evidence;
   candidateReadiness additionally requires the financial source contract, original
   entry-age eligibility and all existing risk/permission checks.
3. Raise `PilotMarket.minimumSlot` for every ordinary trade and every admitted
   reserve-changing protocol effect, even if no ordinary trade is emitted. The
   existing trade callback supplies ordinary slot. A small explicit pool-state
   evidence callback is preferable for protocol effects; no per-effect RPC is
   needed. Never accept an entry/execution quote behind the known slot floor.
4. Preserve existing actual-size SDK quotes, <=2s quote age at use, current pool/
   mint/vault/fee/rent validation,1s modeled delay,5s expiry,7k modeled gas, embedded
   pool fees once, refundable locked rent without invented refunds, and independent
   account identity. Do not substitute an indicative trade price for a fill.
5. Run native controls/audits below held protection and unresolved/due financial
   actions on ONE scheduler/gate. Candidate data failure invalidates/suspends
   admission; it must not stop the independent holding manager or invent exits.
   Current NativeRunner explicitly schedules with nextProtectionAt:null and owns
   no positions; merely putting a ledger beside it would not satisfy this step.

`runPilot()` still constructs legacy PilotFeeds/getTransaction and uses
`PILOT_FLOW_EVIDENCE=pilot-confirmed-curve-v1:...`; that full-enrichment attestation
must not be reused for native authority. Its existing market/execution/accounting
components are suitable reuse points, not a new framework requirement.

## Integration defect already under separate repair

The interop review exposed that an early unaudited tick can consume a candidate's
financial evaluatedBucket before a later audit becomes available in that SAME
bucket. The owning isolated worker is repairing and regression-testing that bug.
The original vacuous fixture and genuine69/70 failure remain historical evidence.
This review neither changes that worker's files nor declares its repair complete.

## What the fixture does and does not prove

The disposable official-layout fixture covers decoder->flow->audit->realSDK->
PAPER entry->pending-exit restart/uncertainty->expiry->fresh max-hold exit and
same-account reconciliation; it verifies shadow refusal and protocol slot floors.
It is synthetic mechanics, not natural qualification, live full-flow completeness,
concurrent holding protection, sustainable provider capacity or financial readiness.
The frozen live source remains candidate-only throughout this review.
