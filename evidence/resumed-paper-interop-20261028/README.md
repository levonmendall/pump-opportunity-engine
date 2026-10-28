# Native-to-PAPER interoperability: controlled mechanics only

Verified 2026-10-28 in isolated worktree `poe-native-paper-interop-20261028`
at source `2ce3cf6a2c846bab6987cf0cd3f462fc88ab8be9`, with the separately
hashed, then-untracked `test/native-paper-interop.test.ts`.

The initial command, source and test hashes are in `identity.json`; raw output is
`focused-tests.log`, with its checksum and exit status in `receipt.json`.
Independent review found that the original unaudited-window check disabled
candidate evaluation and therefore did not exercise readiness. That original
70/70 result is retained, not promoted into evidence of correct late-audit
handling. `original-fixture.test.ts.txt` matches its recorded input checksum.

The corrected fixture, using a normal candidate tick before the audit, then
failed 69/70: that first unavailable-evidence tick consumed the candidate's
entire ten-second decision bucket. An audit arriving later in that same bucket
could not obtain an assessment or reservation. `review-corrected/` retains the
failure log, exact matching fixture snapshot and original trader source.

The narrow repair checks synchronous observation/audit readiness before consuming
the financial candidate's evaluation bucket. Unavailable evidence produces one
coalesced deferred diagnostic per bucket, no quote, and no financial permission.
A later valid audit in the same bucket can obtain one evaluation. Completed
strategy/risk/quote decisions are not reopened, and all existing entry readiness,
slot/context floors, quote-age and reservation checks remain. Feature-only
readiness stays separate from financial authorization. The candidate-only
observation path is unchanged.

`final-verification/` contains exact changed-file hashes and raw outputs for
**72/72 focused tests**, **1,152/1,152 full repository tests**, `npm run build`
and `npm run compile`, all passing. Source hashes were checked unchanged after
verification. This is verification of the isolated base plus recorded repair,
not of the newer root source; a cherry-pick there needs its own affected checks.
No provider requests, real pilot account, wallet, production runtime, or Render
publisher were used. Disposable ledgers are created under a temporary directory
and removed by fixture teardown. No existing financial state is reseeded.

## What this verifies

- Synthetic official-layout ordinary Buy events traverse the real program-log
  decoder, actual log identity normalization, FlowWindow and independent-audit
  mechanics into the existing PaperTrader/PilotMarket/SDK/ledger interfaces.
- A complete but unaudited window cannot reserve an entry or request an
  unnecessary candidate quote. An admitted audit is bound to its exact window,
  actual availability and current ten-second decision bucket.
- Controlled qualification reserves capital and rent, then waits the modeled
  delay before requesting a fresh actual-size execution quote and filling.
- The maximum-holding exit retains exposure and an unresolved order across
  same-account restart; it neither invents a fill nor uses an old favorable
  quote. Expiry and a new fresh exit complete the controlled round trip.
- Model gas totals 14,000 lamports for two filled sides; locked account rent is
  not invented as a refund. Same-state SDK fees/impact and modeled costs produce
  a net loss in the controlled fixture, not a claim of trading profit.
- A shadow-contract selection cannot obtain financial readiness even when the
  disposable ledger otherwise permits entries. Feature-only diagnostics remain
  available. An older audit cannot authorize the next bucket.
- A protocol reserve-change slot raises the actual-size pricing context floor
  without inventing an ordinary buyer; a behind-floor quote is refused.
- Existing affected regressions cover ordinary log identities, event grammar,
  audit completeness, quote validity, scoped gaps, exposure protection and mode
  boundaries.

The pool account bytes are retained public observations, but the timestamps,
program events, USD conversion, availability and order sequence are explicitly
synthetic. Neither this fixture nor its audit is natural forward evidence,
executable historical profit, provider capacity, multi-holding native scheduling,
or an uninterrupted operating interval.

## Current contract boundary

`confirmed-program-events-v2` supplies confirmed program-authored ordinary trade
fields and log-array/frame identities. It explicitly reports unavailable SPL
transfer cross-checks, compiled instruction indices and independent whole-
transaction reconstruction. The fixture does not turn these into verified
claims: `transferCrossCheck` remains `UNAVAILABLE` and no instruction index is
invented.

`confirmed-program-activity-v3-shadow` represents supported protocol effects
separately from ordinary buyers and declares financial qualification unavailable.
The newest live candidate study uses that shadow contract. Passing these
controlled mechanics does not promote that source to a financial contract.

## Minimum remaining integration

Reuse the existing trader, SDK market, execution coordinator and financial ledger;
do not build another execution framework.

1. Add a narrow composition adapter that admits the exact normalized native
   events into the trader, binds actual subscription acknowledgment to flow
   activation, and propagates scoped gaps/corrections to candidate invalidation.
   Keep a single financial writer.
2. Expose an immutable current-window readiness result from the native runner:
   candidate identity, exact window endpoints, data contract, independent audit
   completeness and actual validation availability. Candidate financial readiness
   must fail closed for missing/late/unusable windows and for all shadow sources.
   Do not replay later information as if it were available at an earlier decision.
3. Explicitly version and validate the ordinary confirmed-program data authority
   accepted for isolated PAPER. Do not use a `flowVerification: true` assertion
   as a substitute for that validation or silently relabel unavailable SPL checks.
   A strict-v2 unsupported protocol frame still invalidates its affected window.
4. Bind verified pool identity and every relevant slot floor to PilotMarket;
   prepare current rent/account costs only when necessary, obtain the correctly
   sized fresh entry quote, and preserve fresh delayed execution evidence.
   Protocol reserve changes affect quote floors even when they are not trades.
5. Integrate holding/pending-action scheduling independently of candidate-source
   health, retaining owned exposure and unresolved actions across interruptions.
   Then prove native workload plus real current pricing against the repaired
   shared scheduler before allowing new risk.
6. Run the narrow adapter checks at the reviewed root source, then a separately
   versioned live-market PAPER interval on the unchanged experimental account
   only after the current high-activity observation gate passes. Keep publication
   asynchronous and source/account separated from the authoritative portfolio.

No financial permission, data-contract change, runtime launch, or deployment is
performed by this verification.
