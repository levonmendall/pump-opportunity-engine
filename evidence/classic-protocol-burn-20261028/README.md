# Classic-token protocol burn refusal repair

The actual forward run40704936322 failed candidate observation on five
`LOG_NATIVE_PROTOCOL_BASE_BURN_FRAME` notifications. Only one representative raw
stack was retained; the four other shapes remain unverified. This work does not
retroactively repair their windows or declare a passing forward interval.

The retained sample is transaction
`63M9NGVXPDxwToGP9gHKMWvNYviU3XueRKMu8iBdRhhHKfrakwrhZHBEegKSQqKFq7okWzrGUu9sqhvJPvpVdQHd`,
slot462508581, mint`D9NXzZxiJxgp2U69EDWJ1tJDMtGcEiWh2xGGY58Gpump`, pool
`gEAeFNaUVjjYLmcCdk7y4fWCbiEvKmo7bEWq9zxYW3g`.

Freshly validated original support at14:22:59.061UTC/source slot462508578
established classic Tokenkeg mint ownership467ms before original receipt. Its
exact paired BuyEvent/BoostBuyAndBurnEvent at log indexes12/16 records a
448404891-lamport protocol contribution and1001324648595 base units burned.
Canonical pool, boost-vault PDA, zero fees, clocks, and base/quote/boost reserve
changes agree. This is program-authored evidence, not an SPL transfer cross-check.

The old explicit shadow decoder accepted only Token2022 + labeled Burn. This
sample instead has the classic program's two unlabeled token CPIs. Classic
support was already accepted by the pool validator, so this is a recoverable
protocol shape coverage limitation, not proof of corrupt or missing ordinary
trade data.

The repair accepts that exact classic shape ONLY when the supplied supported
scope explicitly binds the base mint to the classic token program. Missing,
mismatched, and unsupported owners fail closed. Existing Token2022 behavior is
compatible without the optional field; supplying an explicit owner always
requires a match. All paired-event, canonical identity, PDA role, zero-fee,
integer-amount, reserve, timing, and frame checks remain. No protocol effect is
converted to a buyer or NormalizedTrade. Strict-v2 continues to reject Boost.
The V3 shadow contract remains financially ineligible.

Root must wire the optional `baseTokenProgram` from **fresh
`support.summary.tokenProgram`** when constructing `FreshProgramLogScope`.
Never fill this binding from a feed mint, an unlabeled CPI's position, or a
historical owner's assertion. No extra RPC request is necessary: the existing
coherent support batch already validates and reports the mint owner. This
isolated change does not modify `pilot-native-flow.ts` owned by the control
repair worker.

Reproduction is offline:

```sh
node --import tsx --test test/protocol-classic-burn.test.ts test/protocol-pool-effect.test.ts test/program-log-mapping.test.ts test/pilot-mapper-forward.test.ts
npm test
npm run build
npm run compile
```

Raw logs, exact source-file SHA256 identities, receipts, and independent review
are retained beside this report. The focused35test result is controlled replay
and adversarial fixtures; it is not a new live observation or financial result.

Final verification: 1206 full repository tests passed; build and compile
passed. This was the isolated880512f base plus the hashed parser/test repair.
Root must rerun relevant integration tests after the fresh-owner field is wired.
