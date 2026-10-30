# Protocol pool effects: opt-in shadow contract

`confirmed-program-activity-v3-shadow` is a separate research contract. The
existing `parseProgramLogEvidence()` default remains strictv2 and still refuses
the retained Boost transaction. No runtime, strategy, pricing, execution,
financial account, or launcher enables this experiment in this change.

`parseProgramLogActivity(input, scopes, {dataContract:
CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW})` returns ordinary `trades` and separate
`protocolEffects`. It reuses the existing whole-transaction stack/event decoder.
The supported protocol shape is only direct `BoostBuyAndBurn`, with exactly the
known BuyEvent/BoostBuyAndBurnEvent pair, classic WSOL child plus Token2022 Burn
child, exact self-event frames, canonical SOL pool and boost PDA/ATA, default
user base account, consistent positive integer spend/burn/reserve deltas, and
zero event fee amounts/rates. Unknown, routed, mixed inside-frame, alternate
child, inconsistent, or partial shapes fail closed. Separate known ordinary
root frames can coexist without counting the protocol event as an ordinary buy.

The retained transaction proves a protocol-funded quote inflow and base burn in
the selected pool. The event user is the canonical boost-vault PDA; it is not
independent buyer participation, and burned base units were not received by a
user position. The effects remain economically relevant. Their real log/frame
identities, paired exact event bytes, protocol actor, integer amounts, reserves,
and source/receipt/availability timestamps remain available for shadow analysis.
Event-only decoding reports SPL cross-checks and compiled identities unavailable;
the historical full-transaction proof applies only to that captured transaction.
An actual protocol spend is not an executable quote or modeled fill for POE.

`admitProtocolPoolEffect()` preserves the existing 5-second receipt usefulness,
30-second support and program-source ages, slot floor, commitment, and logical
cutoff. It returns an effect rather than `NormalizedTrade`. Duplicate/correction
comparison uses a separate protocol log namespace and exact event fingerprints.
Independent history auditing and current supported-pool validation remain caller
requirements. The decoder alone never establishes a complete market window.

Any protocol frame makes `baselineFeatureSemantics` explicitly unavailable for
strict baseline equivalence, including an unselected pool's frame in the same
transaction. The parent runtime must retain protocol effects, label its shadow
source/configuration version, and refuse baseline financial qualification.
Ordinary feature calculations may be studied separately but must not be presented
as an unchanged baseline window. The original forward refusal remains a failure;
a historical replay cannot supply information to its earlier decision timestamp.

Reproduce offline:

```sh
node --import tsx --test test/protocol-pool-effect.test.ts test/program-log-mapping.test.ts
npm run build
npm test
```

The isolated candidate launcher accepts an explicitly frozen
`--data-contract confirmed-program-activity-v3-shadow` (or the matching public
input field). Strict `confirmed-program-events-v2` remains the default. The
choice is included in the source record, configuration hash, status and watch
checkpoint; conflicting input/CLI selections are refused before networking.
Shadow dashboard decision stages begin `shadow-predictive-`. Financial
execution remains disabled and no ledger is opened.

The adapter retains every selected protocol effect's two actual event byte
strings and integer fields separately from ordinary trades. It never creates a
buyer, wallet trade, net-buy contribution or ordinary amount-ratio price from a
protocol burn. Existing sixty-second/six-bucket ordinary FlowWindow mathematics
and predictive thresholds remain unchanged. Actual-size prices, if used by a
later financial runtime, must still come from freshly validated coherent pool
state; an effect is no fill or quote.

A complete, independently audited shadow window reports any known protocol
frame as strict-v2 baseline semantics unavailable. This is a source-contract
comparison, not a corrected historical baseline pass. Per-scope transaction
markers retain their first validated availability, so identical late deliveries
cannot move an old effect into a later window. For a transaction observed on A
that contains a verified selected-pool B event, B receives explicitly tagged
cross-scope transaction evidence with B-specific counters. That row preserves
the actual signature, slot, hash and availability; it does not claim that B's
subscription delivered a separate message. Independent B history still checks
its full required denominator. Unknown or malformed variants, incomplete
logging, corrections, stale support and processing overruns invalidate affected
windows.

Status contains bounded recent effect summaries and exact aggregate integer
amounts for the current window; complete event packets remain in the selected
append-only evidence. Maps, queues, source deadlines, byte accounting and
retention limits stay bounded. Offline fixtures verify the actual retained
Boost yields zero ordinary buyers/net buying, strict default refusal, ordinary
trade/feature parity, cross-pool evidence, independent signature auditing,
duplicate/correction handling, source-version separation and financial refusal.
They establish mechanics only, not a new forward interval or economic edge.
