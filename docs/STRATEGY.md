# Provisional offline continuation rule

Status: **UNPROVEN, UNFROZEN, NOT CONNECTED TO PRODUCTION ENTRY EXECUTION**. This module
implements one deterministic candidate rule and feature core. It does not prove
PumpPortal field compatibility, enable entries, obtain quotes, spend data money,
create orders, fill trades or change an account. No shadow resident or optimization
is included. The existing observer remains entry-disabled.

The real migration/pool/size-specific quote integration is already demonstrated
elsewhere. Metered selected-token trade observations are still needed to verify
the normalized inputs below. Synthetic tests never supply that production proof.

## Input and availability contract

Each normalized trade requires the mint, wallet, buy/sell side, positive integer
SOL lamports and token base units, actual application receive time, commitment,
and identity consisting of signature **plus instruction index and event index**.
An optional slot remains event context. This is a proposed internal interface,
not a claim that PumpPortal currently provides each field. The adapter must measure
and document available fields, identity completeness and quantity/fee conventions.
If a required identity or quantity cannot be established, it must not invent one
or mark the field contract verified. No transaction-per-message indexer is proposed.
The adapter must invalidate the affected window when a required raw observation
is malformed/lost. This normalized core rejects malformed input; it cannot guess
an unavailable receive timestamp or repair an adapter's discarded observations.

The window uses receive time because an unverified event timestamp cannot be
invented. Information is admitted in nondecreasing receive order. Queries before
the latest available information are refused; replay must deliver observations,
confirmations and corrections when they actually arrived. Processed trades stay
provisional and are counted separately. A later same-payload confirmation upgrades
quality only after receipt, without adding volume. A changed payload, reversal,
feed gap or capacity loss clears the affected feature window and requires fresh
warming; no missed flow is reconstructed.
An invalidated window cannot start inclusively at the exact lost-event time;
it must exclude that boundary before becoming sufficiently observed again.

Deduplication uses complete instruction/event identity. The same signature can
contain multiple counted events. Duplicate identity/payload adds no volume.
Identity history is bounded to120seconds and at most8192records per window;
this is not a promise of arbitrary historical replay deduplication. A provider
currentness/identity contract must establish what replay/delay can be trusted.

## Bounded features

OpportunityBook admits at most12candidates and reports capacity refusal; it never
silently evicts a candidate. Position-priority observation is an orchestration
responsibility, not implemented here. Each window permits at most4096retained
trades, plus bounded consumed-array prefixes and identity history. Capacity loss
invalidates the window instead of dropping correctness-critical events and
continuing to score it. No database/network request occurs in processing.

Features use the last six **closed10-second receive-time bins**, a60-second
lookback. An open partial bin is excluded, so the latest scored information can
lag current receive time by up to10seconds. A complete interval after subscription
activation or invalidation is required, even with zero activity. An adapter must
actually establish uninterrupted observation; elapsed time alone cannot prove it.
SOL totals, wallet buy volume and bucket net flow are updated as trades enter and
leave; the module does not reconstruct history per message.

- Net buying is buy lamports minus sell lamports, retaining integer units.
- Persistence is the number of the six bins with positive net quote flow.
- Participation records distinct buyer wallet strings and the largest wallet's
  share of buy volume. Different wallets are **not proof of independent buyers**.
  Concentration rounds upward in basis points.
- Price structure compares first/last observed lamports/base-unit ratios using
  integer cross-products. It is not a pool mid-price, liquidation mark or executable
  missed profit. Negative fractional basis points round downward, never to zero.
- Liquidity relative to proposed order size is supplied from independently verified
  effective reserves and an actual-size quote; raw vault balances are insufficient.

## One candidate rule

Version:persistent-buying-v0-unfrozen. Provisional migration age:5–120minutes,
using the verified migration time, not first observation or a symbol. No reentry,
averaging down or staged adds. Initial proposed position cost is capped at$50
including entry execution costs; the ledger separately owns maximum3positions,
$150aggregate cost, gas/rent reservations and daily-loss pause. These values
are experimental and are not optimized or a loss guarantee.
The exported parameter object is immutable within one code version to prevent
accidental unversioned mutation. That does not mean a forward experiment is frozen
or authorized; the missing integration/field/budget prerequisites remain.

The primary predictive rule requires all of:

- Net buying of at least1SOL over the closed60-second interval.
- Positive net buying in at least4of6bins.
- At least5distinct buyer wallets and largest buyer volume share at most35%.
- Last observed trade price ratio at least the first ratio.

These are untested hypotheses, not evidence of an edge. Mandatory requirements
are evaluated separately and report missing-data, market-exclusion or risk-refusal
reasons: measured feed-field verification/evidence, verified supported migration,
complete current window, actual ledger entry permission/no previous token entry,
a size-specific quote no older than2seconds, all-in entry cost at most$50 and
proposed size/effective SOL liquidity at most5%. Only then is a predictive
strategy rejection or provisional qualification possible. The caller must record
the full features, quality, identity, rule version and actual quote in the funnel.
No capability to toggle production verification or risk permission is provided.

Provisional order timing is a1-second modeled delay and5-second expiry, one
earliest modeled attempt without retry. Financial execution must enforce that
policy; this pure module does not pretend it already does. Final sizing, field
contract, exact cost assumptions and parameters must be frozen together before
forward strategy evaluation. No acceptance clock can start from this scaffold.

## Exit requests and current limits

Pure exit evaluation requests a complete actual-size liquidation quote when a
mark is unavailable/stale/wrong-sized. With a fresh conservative net mark it
requests an exit at15%loss or30%gain relative to recorded all-in entry SOL cost.
A15-minute holding limit requests an exit even if pricing is unavailable, but
still requires a real supported quote/attempt; it never creates a free fill.
USD risk/equity reconciliation remains the ledger's separate responsibility.
A stop does not guarantee the trigger price or any live fill.

These holding exits use full-size net liquidation, cost and time; they do not
use flow. Candidate qualification still requires every declared flow feature.
Pool-state monitoring cannot recover buyer identity/concentration or a complete
trade sequence. A future flow-dependent exit must retain its required feed.
See OBSERVATION_DESIGN.md; no rule was removed for a cost comparison.

Remaining integration includes measured PumpPortal mapping/coverage/delay/cost,
pool-state/quote scheduling, order orchestration and reservations, current-size
marks/exits, persisted reentry/funnel evidence, held-position priority and recovery,
real burst-capacity measurements and chronological unseen/forward evaluation.
No complete strategy, natural trade, economic result or acceptance gate is claimed.
