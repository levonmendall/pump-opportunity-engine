# PumpApi mapping and bounded RPC enrichment

Research-only module: `src/pumpapi-mapping.ts`. No production connection,
subscription, strategy change, entry-enable path, account, signing or wallet API.
There are no Alchemy/Helius prerequisites. This module does not assert that
PumpApi alone has passed POE's flow contract.

## What the retained evidence actually establishes

The previous PumpApi captures retained field-type inventories but **no selected
raw trade payload**. All broad data was discarded as intended. Thus no direct
provider-to-chain field match, selected instruction precision, commitment or
correction contract can be retroactively established from that capture.

The retained actual public-RPC transaction
`evidence/targeted-transaction-sample.json` establishes one successful direct
canonical-pool Sell at version0. Its current SDK2.2.0 IDL and exact event-CPI
bytes provide the following mapping; this is on-chain decoder evidence, not a
PumpApi completeness or timing pass.

| Meaning | Proven field or mechanism | Scope/limitation |
| --- | --- | --- |
| Direction | Actual PumpSwap instruction plus matching `SellEvent`/`BuyEvent` | One real direct Sell tested; buy/routed/multiple/new variant coverage needs real examples. A top-level PumpApi `action` is a claim, particularly for aggregate same-pool transactions. |
| Token units | IDL `base_amount_in` for Sell; `base_amount_out` layout for Buy | Sell138353716808147 integer units, agreeing with scoped `TransferChecked`. Decode BN to decimal string/BigInt; never JS Number or UI float. |
| Gross curve SOL | Sell `quote_amount_out`; Buy layout `quote_amount_in` | Sell1481514lamports. These are executed values, unlike min/max constraints. |
| User SOL | Sell `user_quote_amount_out`; Buy layout `user_quote_amount_in` | Sell1462993lamports, independently agreeing with user-directed WSOL transfer. Preserve separately from curve quantity. |
| Fees | Event LP/protocol/creator fields, plus cashback/buyback/holder/quote-transfer fields when reported | Sell deductions297/13779/4445lamports reconcile gross to user net. `holder_rewards` can repeat the creator fee; do not sum alias fields twice. Network fee25000lamports is separate. New fee buckets/variants must be checked, not guessed from old arithmetic. |
| Trader | Event `user` equals the actual swap instruction's `user` role; associated token account roles also agree | Not automatically fee payer, top-level `txSigner`, router outer signer or independent person. The actual retained Sell happens to share user/fee payer; separation is tested only with an explicitly synthetic fixture. |
| Pool and quote | Exact compiled account role, canonical PDA derived from the verified mint, wrapped SOL quote mint | Pool/mint program/extension eligibility remains the existing pool verifier's responsibility. Provider `poolId` equality is only a bounded selection hint, not independent verification. |
| Event identity | Signature, program, outer instruction index, swap inner instruction index if routed, **event-CPI inner instruction index**, eventIndex0 for the single IDL record encoded in that CPI | Actual Sell is outer2/event inner5. This zero comes from one encoded Anchor event, not from inventing a missing provider index. Resolving parent stack heights and event-authority PDA is mandatory. Signature alone is insufficient. |
| Representation duplication | Use genuine self-CPI event bytes, not a second copy of the same scoped log | Real Sell logs and CPI encode one event. Repeated identical key/fingerprint is duplicate evidence; same full key with changed executed content is a correction requiring affected-window invalidation. |
| Availability/commitment | Successful **confirmed** `getTransaction` plus local RPC completion time | Provider arrival is retained separately. Do not backdate later confirmed/enriched data into the earlier PumpApi arrival window. A timestamp field does not prove processed/confirmed/finalized status. |

The mapper preserves curve quote, user quote and fee fields separately and
returns `normalizedForStrategy:false`. Current `quoteLamports` has no frozen
fee/economic convention binding it to either one. Choosing one silently could
change net buying/price structure. That convention needs an explicit reviewed
definition before connecting the mapper; thresholds are unchanged.

An explicit `toResearchNormalizedTrade` conversion can compare both `curve`
and `user` amount conventions without choosing a primary one. Its output is
labeled `RESEARCH_ONLY`, requires named supported-pool evidence, refuses failed
base/user-quote transfer cross-checks, and retains the full event identity.
Within the current PumpSwap-only namespace, `instructionIndex` is the actual
outer index and `eventIndex` is the **actual event-CPI inner instruction index**.
Each self-CPI encodes one Anchor event, so this pair is unique within a transaction;
it is not an invented ordinal or signature-only deduplication. Routed swap inner
position/program remain in the complete retained identity. The interpretation
must be reviewed alongside replay before connecting it; current production
strategy types/thresholds remain unchanged.

Validation quality participates in the evidence fingerprint. An unchanged event
with a changed TransferChecked result is a correction/quality loss, not a duplicate.
Neither a failed cross-check nor an unresolved fee convention can enter the
primary strategy via this research-only module.

## Bounded enriched configuration

One PumpApi connection cheaply rejects nontracked mints/pools first. For an exact
selected pool, only its valid64-byte transaction signature is a hint. UI amounts,
metadata URLs, `txSigner`, provider trader strings and unknown commitment claims
do not become trades. Existing raw JSON numbers may already have lost integer
precision; multiplying their parsed value by decimals cannot recover it.

Deduplicate **enrichment requests** by signature using bounded pending/completed
state. A single confirmed transaction fetch can yield multiple genuine swaps;
emit every independently identified selected-pool event, rather than deduplicating
the trades as one transaction. Maintain original local receive/availability times.

Minimum extra work is **one `getTransaction` per distinct selected transaction**
not already verified, plus bounded history checks and current pool/quote reads.
Count unsuccessful/not-yet-confirmed calls, expired pending hints and repeated
confirmation attempts; no unbounded retry queue or free-rate assumption. At
rate `r` distinct selected signatures/minute, enrichment alone needs at least
`r` RPC calls/minute. Held-position quote/protection and verification must fit
the same shared limits first. Public RPC bills no attached account, but its
shared-IP rate/availability and infrastructure bandwidth are not unlimited.

Only exact successful supported shapes and amounts can feed a feature window.
Missing stack height, logs/inner bytes, mismatched account role, unsupported
event/layout or inconsistent transfers stays unavailable; do not manufacture an
event index, buy/sell amount or trader. Null/failed history is not proof of no
activity or a chain reversal. Confirmed corrections/reversals, dropped pending
events or unavailable required evidence invalidate the affected window; restart
warms current windows instead of backdating a historical catch-up.

## Remaining essential evidence

- An actual active supported pool's PumpApi selected payload matched to the
  exact confirmed transaction and executed events during the same interval.
- Direct Buy, routed/CPI and multi-swap examples where available; real current
  token/pool variants and nonempty loaded-address behavior.
- Independent bounded activity denominator, confirmed corrections/finality
  handling and receipt timing; two sources agreeing is not universal coverage.
- The entire enriched workload—broad incoming bytes, selected events, RPC
  requests, quote work, processing/queue age and complete closed60-second windows.

The bounded current program-address page in
`evidence/free-data-20261027/public-activity-2026-10-27T02-02-18.064Z.json`
was selected at2026-10-27T02:02:18.064Z using one program-address page limited
to12signatures and the first three successful transaction fetches. It
contained one actual direct Sell of WSOL **against a custom quote mint** in a
noncanonical pool, plus two transactions merely mentioning the program address
without invoking it. Those samples establish neither a supported active pool
nor provider coverage. They are refused/excluded in the offline tests. No Buy
or routed supported swap was obtained from that small biased page.

The event decoder requires exact round-trip agreement with the packaged event
layout. SDK defaults for absent trailing u64s are not evidence of reported zero
fees: truncated/older unverified layouts fail closed as
`UNSUPPORTED_EVENT_LAYOUT`. A decoded event with transfer disagreement remains raw
unusable evidence (`normalizedForStrategy:false`), never an admitted trade.

Ten focused offline tests reproduce the retained Sell, fee/constraint
separation, signature-hint precision refusal, stable identities/representation
deduplication, mismatched/failed data, corrections/transfer disagreement, local
availability, synthetic fee-payer separation, explicit curve/user research views,
transfer-quality corrections and current out-of-scope samples. Run:

```sh
node --import tsx --test test/pumpapi-mapping.test.ts
```

No test above is a forward PAPER trade or evidence that the free configuration
meets every essential requirement. Live active-pool measurements need a reviewed
remaining byte/time/request reservation first.

## Current approved-preflight extension

The retained `active-approved-record.ndjson` now verifies one real current v1
CPI-invoked sell_v2 (outer3, PumpSwap inner1, event inner7), including precise integer
units, user/curve SOL, transfer agreement and actual fee-payer/trader separation.
It is a canonical SOL-pool identity, but current mint/fee/vault support was not
checked after capacity refusal. No selected PumpApi frame was captured. Current
Buy/multi-swap feed matching and provider semantics remain unverified. See
FREE_DATA_EVALUATION.md and test/active-current-evidence.test.ts.
