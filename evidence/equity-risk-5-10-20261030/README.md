# PAPER equity-risk implementation — 2026-10-30

Scope: isolated financial implementation. No EC2 operation, original ledger read,
financial controls, funded execution, provider request, deployment or profitability
claim was performed by this agent.

## Policy and persistence

The active adaptive contract uses 500bps of fresh complete portfolio equity as
maximum consumed entry cost, including network fees. Persistent refundable base
account rent and temporary quote-account rent are separately reserved as cash.
Rent is not consumed cost. Cash, gas reserve, exact-size liquidation marks,
reconciliation freshness, strategy qualification, independent audits, duplicate
prevention, two concurrent holdings and four deep observation slots remain.
No active cumulative mint/deposit-count ceiling is introduced. Every retained
refundable asset is validated; a130-settled-mint regression preserves all assets,
cash, fees, identity and full history across restart. The old128-admission rule
remains only in the unactivated legacy benchmark.

Fixed $50 entry, $150 aggregate cost and $50 daily loss caps remain only in the
unactivated legacy benchmark. No forced sale is caused by appreciation.

The 1000bps daily drawdown is measured from complete observed USD executable-equity
high-water marks, including passive SOL/USD valuation. It does not promise a
continuous or unobserved midnight market peak. The first complete valuation after
UTC rollover may occur later during an outage. All old financial rows are retained.

Activation is a versioned action in the original sole-writer transaction. On first
activation, all retained same-day authoritative reconciliation receipts are scanned
in 256-receipt chunks, with durable progress and digest. Current fresh observations
continue advancing the high-water mark during migration. Journal prefix cardinality,
revision boundaries and action linkage are checked before every page, including
final certification. Receipt identities, hashes, prices and amounts are validated.
There is no recent-tail sampling, hindsight repricing or favorable peak reset.
Unknown/missing history blocks new risk. A verified old-rule latch is retired only
through this explicit authorized policy transition; owner/manual stops persist.

Missing or corrupt optional entry-policy state closes budget, buy reservation,
buy attempt and resume. It never selects a legacy allocation after recorded policy
activation. Runtime core financial validation permits existing holdings and valid
exits/accounting while preserving the raw policy fault. Exported backup validation
remains strict. Transient startup activation failures retry without a permanent
technical pause or implicit legacy allocation.

New allocation proofs bind decision/attempt equity, USD conversion and exact
integer SOL allowance. A falling allowance rejects a stable order; the ledger
never silently resizes, changes its minimum or replays it. Historical fills are
not repriced. New >$50 positions require these proofs.

## Execution interface

New modeled orders bind immutable plan/intent/fees/timing and temporary quote rent.
Temporary rent is cash-reserved for buys and sells and is never net-debited,
charged as a fee or recorded as a permanent asset. Only validated supported
post-delay landing scenarios can fill. Unsubmitted preparation failures cost zero
network fee; supported modeled landing failures charge plan fees exactly once.
Old model-less orders retain original payload hashes and accounting semantics.

The actual SDK producer / create-close-unwrap proof is developed independently by
the execution owner. This finance slice alone does not establish real-market
execution reliability or prove an actual transaction landed on-chain.

## Compatibility

State schemaVersion remains1 with additive versioned fields. Account identity,
inception, initial contribution, prior financial records, held quantities, pending
identity and sole ownership remain. New-policy fills above$50 cannot be loaded by
the old financial validator. Rollback must retain the compatible financial manager;
no downgrade or database restoration should be claimed safe after activation.

## Retained validation

The first suite (309ce33) retained2178/2181 passes: failures were stale legacy
configuration assertions and a daily-loss fixture lacking its preceding complete
reference observation. The next suite (85e6323) retained2188/2189 passes; its only
failure was the compiled-entrypoint fixture's20s TypeScript subprocess timeout
(SIGTERM without compiler errors). Both exact source guards passed; logs remain.

Independent adversarial probes found and repaired a missing driving journal row
that could hide a peak and a retained activation receipt with absent policy state.
Additional tests retain old actions/journal/metadata byte-for-byte across migration,
restart, old owner-reset provenance retrieval, UTC change, actual held exits with
missing/corrupt policy, consumed-cost rounding and temporary-rent settlement.

The10000-receipt in-memory workload used40 migration chunks; observed maximum
chunk time was approximately16ms and median5ms in this Cloud environment. These
measurements are not EC2 latency or holding-protection acceptance evidence.

Source1b9fa95 passed2193/2193 tests plus build with all370 source/test/package
files and HEAD unchanged. Final financial source653eb4a, after removing the active
128-deposit ceiling, passed87/87 tests covering every changed financial/native/
adaptive/history path and the existing Ledger/backup tests; build and exact370-file
guard passed with no added files or HEAD change. See source-653-after.json.

The corrected combined execution candidatead31b58 separately passed2235/2235 tests,
build and its465-file guard in the execution owner worktree. Parentroot composes
and validates final combined source7d3f0ca separately; this financial evidence does
not substitute for that source guard or actual forward operation. The test process uses bounded
concurrency2 to reduce unrelated concurrent compiler pressure; this does not change
any production runtime concurrency, timing or risk parameter.
