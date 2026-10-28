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
