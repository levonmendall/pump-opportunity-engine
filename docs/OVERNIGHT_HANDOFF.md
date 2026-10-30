# POE overnight handoff — 2026-10-27 UTC

## A. Executive result

Fresh Clock pricing now has real one-pool and three-pool evidence. Free PumpApi
payloads were matched to confirmed swaps, including actual Jupiter CPI sells and
exact-quote buys with a fee payer different from the trader. Two Buy event
semantic bugs were found and fixed without weakening transfer checks. An isolated
held-market adapter connects coherent marks, post-delay execution and the existing
ledger/coordinator; its lifecycle/recovery evidence remains offline.

**This is not an autonomous production PAPER trader.** The combined forward run
had two mapping failures and zero usable full flow windows. Its corrected replay
is separate. No deployment, entries, natural PAPER trades or acceptance clocks.
The strongest supported direction is coherent batching with the two-second
reference, not a slower policy or another screening layer.

## B. Actual live evidence

| Measurement | Actual result and limitation |
| --- | --- |
| Basic pricing, leg01 | Two fresh full-size quotes on a previously verified quiet pool; current pool/mint/vault/fee checks, exact 40-byte Sysvar Clock/owner/context and identical-byte decoder/SDK parity. No recent-swap prerequisite. |
| Three-pool pricing, leg02 | Two 16-account union batches, six valid actual-size quotes on three distinct pools. Cold discovery plus full state: two reads; steady full state: one. Independent block timestamps recorded separately. |
| Discovery, legs03–04 | One migration-only connection produced one hint. Actual instruction/event proof showed its `mint` was the quote asset of a custom-token pool. Correctly outside SOL scope. New pure identity decoder uses actual base/quote/pool roles, not that hint assumption. |
| Activity-biased selection, legs05–06 | Chose from the first three raw canonical-SOL PumpApi hints, then independently verified a successful swap and fresh supported state. This is a transport sample, not representative discovery, Pump-origin or entry-age proof. The sampler actually used1.637s/77,425bytes; its separate parent10s hard deadline was added afterward, so timeout-failure behavior was not established by that run. |
| Field capture, leg07 | 29.289 seconds open, 14,612 frames /23,684,526 socket bytes; three SellV2 events, one direct and two Jupiter CPI. Three confirmed lookups, no selected quality gaps; maximum confirmation availability after receipt 1.847 seconds. |
| Independent field audit, leg08 | All three compiled swaps matched in the bounded 25-second chain-time interior; two finalized rechecks agreed. This is not full-market coverage or a 60-second qualification window. |
| Notification partial run, leg09 | Seven ACKs and one changed account version matched to a fresh full snapshot. Parent resource/evidence monitor stopped during reconnect. Preserve failure and its 2 MiB response reservation. A reproducible atomic-file scan race was fixed and regression-tested; the old generic error lacks exact syscall detail. |
| Notification run, leg10 | All seven subscriptions restored after one planned reconnect; fresh RPC state returned before all ACKs completed. Fifteen periodic evaluations in 30 seconds, actual-use age 5–15 ms. One 658-lamport liquidation-value change during the subscription gap; no threshold crossing. No changed notification arrived in this particular window. |
| Combined workload, leg11 | Three hypothetical holdings plus one active candidate; 35 periodic union quotes and six transaction lookups. 69.530 seconds open; 40,556 frames /65,179,210 socket bytes. Four sells normalized; two exact-quote buys failed the then-current mapper. Application byte stop reached before planned 75 seconds. Zero usable forward 60-second windows. |
| Combined audit, leg12 | Bounded 65-second interior: five compiled swaps, all five had feed hints; only three were normalized by the original forward run. Both rejected buys remain explicit failures. Two sell finality rechecks agreed. |
| Buy finality, leg13 | Both actual rejected buys were subsequently retrieved at finalized commitment; corrected executed content and transfer proofs agreed. These later checks are not backdated into forward decisions. |
| Delayed legacy Buy, leg14 | The retained sampler Buy was retrieved at finalized commitment 5,572.489 seconds after the hint. Independent transfers proved the same field-meaning reversal for `buy_exact_quote_in`. The original failure remains; no fresh pool-support or timely flow claim. |

Across the first pricing components, timestamps recorded after parity show ages
11–31 ms. Clock bank time is **not** an independently retrieved block timestamp.
No headline price or vault balance alone supplied liquidation value.

Combined quote age at use was 15–41 ms, but completed evaluation gaps reached
3.224 seconds (p95 2.073 seconds), with a 1.425-second censored tail. Pricing cache
was outside the two-second age limit for 2.688 seconds /3.866% of the observation.
There were no sampled stop/take-profit crossings. A reported lack of declared
whole-period deadline failures is not a claim of continuous fresh protection.

Actual trade shapes: seven captured sells (two direct, five CPI), plus two V2 buys
recovered by the narrow correction and one separately delayed legacy exact-quote
Buy proof. Multiple selected swaps in one transaction, other buy variants, and SOL-pool `multi_hop_swap` completeness remain unverified.

## C. Implementation delivered

Build, compile and481regressions pass, with focused independent review. These
checks substantiate code/accounting behavior, not forward trading acceptance.

Review branch: `poe-free-data-evaluation-20261027`; main and installed release are
unchanged. Exact source hashes and receipts accompany each measurement under
`evidence/overnight-20261027/`; earlier grants/counters/429 remain immutable.

- `ResearchHeldMarket`: one coherent holding batch, conservative net marks and
  exact-size gross exit quote reuse from compatible fresh post-delay state. Own
  pending action, inventory, slot, timing and fee checks; gap/restart refusal.
- Optional lazy quotes: defer only when existing predictive conditions already
  reject the closed window. No new screen or threshold. Fresh possible-entry
  quotes retain current knowledge floors through awaits. Default remains off;
  changed observation/refusal timing is disclosed, not called outcome-equivalent.
- Trader fix: recheck exit-decision quote age after handling due actions; malformed
  optional quote fields cannot advance accepted slot knowledge.
- Purpose-specific preparation/results: quiet current-state validation is separate
  from activity, ACKs, restoration, changed delivery and threshold recognition.
- Buy corrections: independently proved `buy_exact_quote_in_v2` and
  `buy_exact_quote_in` reverse the assumed event-field meanings. Actual
  user/vault/buyback transfers prove each; Sell fingerprints stay
  unchanged. LP + protocol + creator explain the fee difference; buyback is a
  protocol subset, not another fee to add.
- Current migration identity extraction: validates actual migration/create/event
  roles and canonical actual-quote PDA. Identity never substitutes for fresh
  pool/mint/vault/fee/extension or entry-age validation.

PumpApi numeric `quoteAmount` matched gross curve proceeds for sampled sells but
whole user debit for sampled exact-quote buys. `txSigner` was a fee payer different
from the genuine trader in one buy. Full event identity and commitment are absent
from the payload. **One confirmed transaction read per selected transaction remains
an operating dependency.** Retaining fewer fields would not remove that request.

Corrected chronological replay uses original receipt, request and confirmation
availability times: six events and one raw warmed closed window, with negative
net buying and one buyer at 100% concentration. It still fails the buying rule.
Original forward gaps/zero windows remain unchanged; no orders, profits or capital
were manufactured. See `offline-corrected-replay.json` and `offline-mapping-audit.json`.

## D. Capacity and cost

Authoritative rollup: `evidence/overnight-20261027/final-summary.json`.
The earlier `summary.json` is an unchanged intermediate milestone.

- Cumulative **163 research request units**, including 139 overnight units;
  **77 remain**. Two read-only Render GETs are recorded separately as administration.
- **1,490,756 measured RPC/related response bytes**, plus **2,097,152 retained
  uncertain bytes** from leg09: 3,587,908 accounted /67,108,864; 63,520,956 remain.
- Overnight physical starts: minimum spacing 1,001 ms, maximum 42/rolling minute
  and 10/rolling ten seconds, one physical operation at a time. No new 429.
  Completed HTTP body-response samples: 101 samples, p50 71 ms, p95 228 ms, maximum 328 ms;
  the aborted uncertain response is not a completed sample.
- PumpApi: 195,936,099 actual cumulative socket bytes; **256 MiB reservations fully
  committed**, 230 seconds reserved /300. Preserve all reservations; no automatic
  refund or further capture. Prior112 MiB/100 seconds remain untouched.
- 9,619,543 bytes across all evidence directories before the final rollup,
  below32 MiB; final completion records remain within that ceiling. No broad-stream archive. Loaded Cloud SQLite3.53.4 through
  better-sqlite3 13.0.3 was checked without opening financial data.

Measured light combined demand: 30.20 pricing +5.18 enrichment starts/minute, for
three holdings and one candidate. An illustrative 12/minute verification/recovery/
headroom reserve leaves about18 aggregate enrichment starts/minute. That is a
projection, not proof that three candidates or arbitrary bursts fit. The live scheduler
missed the nominal two-second interval. A stricter reserved-start alternative
starved enrichment under only10 ms jitter and was rejected as the default. It
remains an opt-in negative experiment, not an accepted fix or capacity claim.

Measured broad ingress projects **80.99 GB/day /2.43 TB per30days** if that rate and
continuous duty persist. More local filtering does not save incoming traffic.
Sampled Cloud peak RSS155.57 MiB, CPU3.685 seconds and loop lag29.3 ms do not prove
EC2 compatibility. No EC2 load experiment ran.

API/data charges for these credential-free endpoints: **$0**. Existing hosting,
Cloud execution and network-transfer allocations/costs were not established;
whole-system zero cost and continuous public-endpoint reliability are unproven.

## E. Production status

No EC2 host, private database or service-control check ran overnight. At
**08:04:36 UTC**, the original public Render URL returned health200 and accepted
snapshot1049: account `poe-3123e352-4581-455b-85db-acd7e825e99e`, inception
`2026-10-26T22:07:36.212Z`, release `bce3d22bb434eb429aafacb788a18f39ec189c1b`,
strategy `UNIMPLEMENTED_FLOW_BLOCKED`. Source reconciliation was true, zero
positions/trades, entries disabled; underlying facts were39.682 seconds old.
This is authenticated read-model/source evidence, not an independent financial
DB audit or proof of continuous host health.

Reported virtual equity$995.865917 equals passive-SOL equity; the$4.134083 change
from inception reflects SOL/USD exposure with no token trades. Operating costs
and economic P&L remain unavailable. No research balances were sent to Render.

## F. Next action

The next engineering step is a bounded, shared deadline policy that avoids both
the observed3.224-second evaluation gap and the offline starvation counterexample.
Then validate the corrected mapper in one forward, matched-flow window and the
same bounded independent audit. The
existing stream reservation ceiling prevents another automatic capture in this
session. No provider purchase, wallet funding or completed infrastructure action
is requested. Preserve this concrete evidence for the next bounded authorization.

The reusable integration candidate is **not deployment-ready**: source-variant and
broader completeness evidence, scheduling validation, frozen rule/amount/cost
contract, actual EC2 capacity/recovery/backup/alert proving and production wiring
remain. Ledger schema stays1; follow the account-preserving release/rollback notes
in RUNBOOK.md. No merge, deployment, PAPER-entry enablement, live trading or
24/72-hour acceptance clock is authorized by this handoff. Edge remains UNPROVEN.
