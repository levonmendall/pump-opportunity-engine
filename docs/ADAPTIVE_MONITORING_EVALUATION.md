# POE adaptive monitoring and data-reduction evaluation

2026-10-27 UTC · isolated review branch `poe-free-data-evaluation-20261027`

**Decision:** do not replace two-second monitoring with five seconds plus triggers
as a general policy. It saved 60% of pricing requests in the synthetic quiet case,
but saved nothing under high account-change activity and missed stops when
notifications were silently lost. The simplest better-supported direction is
coherent batching without slowing the baseline, reusing fresh post-delay execution
state, and investigating unnecessary candidate quotes. **Do not add another
support/liquidity screen.** Those checks already exist; a new price gate changes
selection and needs separate economic evidence.

The observer, original account/inception, financial history, public Render viewer
and authenticated publishing were untouched. No provider/production network
request, deployment, entry enablement or acceptance-clock start occurred. The
last production read remains the earlier snapshot522, not a new health claim.
All results below are offline. Natural PAPER trades created by this work: zero.

## What was tested and what was not

- Six policies on identical evidence: fixed2s, fixed5s, fixed10s, hybrid5s+triggers,
  adaptive5s/2s, and an experimental adaptive quiet10s mode.
- Twelve synthetic case families, with five frozen timing phases for four families:
  **168 schedule comparisons**, plus **180 shared-load comparisons**. Policies and
  fees were fixed before evaluation, not selected by a threshold search.
- The actual retained record:16coherent batches,15usable quotes, one unavailable
  block-time read. All successful outputs were229,733lamports and account bytes
  were unchanged. Seventeen notifications changed no pool/vault content. Quote
  availability gaps reached7,628ms. This is quiet, sparse evidence, not a changing
  market or continuous-price recording.
- SDK-priced synthetic reserve transitions seeded from one retained verified pool
  with approximately301SOL raw quote reserve. Integer constant-product stress
  states preserve native WSOL backing, fixed captured fee configuration and the
  existing decoder. They are not reconstructed chain trades. The hypothetical
  holding comes from a0.01SOL entry, not the maximum$50 position.

Actual sparse replay never renews the original quote timestamp or invents fresh
prices between captures. Its availability sensitivity produced11/27usable checks
at2s versus3/11at5s, but these are consequences of sparse recorded availability
and phase, **not a causal endpoint/policy comparison**. No natural crossing,
entry/exit return, flow advantage or economic edge is measurable from that source.

The initial synthetic WSOL fixture did not update native lamport backing with
changed reserves. It was corrected and the original output preserved. Every
price, decision, request, timing and modeled outcome remained identical. Subsequent
ledger-boundary corrections were also semantically replayed against all168/180
results. See `fixture-correction.json` and `parity-verification.json`.

## Monitoring comparison

The common quiet comparison spans120synthetic seconds, with200ms modeled RPC
completion. Values are **pricing starts**, excluding cold discovery, subscription
management and exit preparation. Every used quote was at most2s old; old cached
quotes were never used to make an actionable exit decision.

| Policy | Quiet requests/120s | Projected requests/held-hour, one holding | Quiet max completed-fresh gap | Quiet time without a fresh cached quote | High-churn requests/120s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fixed2s |60|1,800|2s|10%|60|
| Fixed5s |24|720|5s|64%|24|
| Fixed10s |12|360|10s|82%|12|
| Hybrid5s + changes |24|720|5s|64%|60|
| Adaptive5s/2s |24|720|5s|64%|60|
| Adaptive quiet10s |19|570 in this120s transition sample|10s|71.5%|60|

Fresh-cache availability differs from freshness **at use**. Five-second polling
can safely request a new quote when it evaluates, but it has no usable cached mark
for much of the interval. A new entry, reconciliation or exit requiring current
portfolio value may force another read. Such reads reduce the apparent savings.
Even2s polling has cache gaps with200ms responses; this table does not certify
continuous protection. Source-age validation remains30s and quote age at use2s.

Across the28case/phase pairs for each policy, lifecycle metrics stop when the
hypothetical position closes. Standardized request-load comparisons separately
continue counterfactual monitoring over the common horizon.

| Policy | Missed threshold episodes while open / denominator | Worst recognized threshold delay, including RPC faults | Worst gap between fresh completed checks in common-horizon stress | Filled / unresolved cases |
| --- | ---: | ---: | ---: | ---: |
| Fixed2s |0/25|16.1s|20.2s|26/2|
| Fixed5s |4/27|14.9s|20.0s|24/4|
| Fixed10s |15/30|19.9s|30.0s|16/12|
| Hybrid5s |2/27|15.5s|20.6s|26/2|
| Adaptive5s/2s |2/27|15.5s|20.6s|26/2|
| Adaptive quiet10s |2/27|15.5s|20.6s|26/2|

Missed episodes have no finite recognition delay; they are not dropped from the
table. Different filled lifetimes explain different denominators. A lower maximum
among recognized episodes does not mean5s is safer: RPC recovery phase differs,
and some5s episodes were missed entirely. No policy overcomes an unavailable RPC.

In healthy step-drop/rally cases, fixed2s recognized within2.0s, fixed5s within4.9s,
fixed10s within9.9s, and hybrid/adaptive within1.9s in this phase grid. Actual-size
quotes at those decisions were200ms old. The price-change-to-next-fresh-check
measure is recorded separately in the detailed results; recognizing a new value
is not the same as recognizing a threshold or obtaining a modeled fill.

## Exit outcomes, costs and uncertainty

The existing15% stop,30% take-profit and15-minute hold limit are unchanged.
The timer schedules a fresh check even between periodic ticks. All schedules
recognized the modeled maximum-hold intent with a usable quote200ms later in the
normal-latency case. A timer intent without a fresh quote is not actionable pricing.

Execution uses one earliest permitted attempt after1s,5s expiry and a5% gross
slippage constraint. The10,007,000lamport entry cost includes10,000,000budget plus
7,000gas. SDK fees/impact are embedded in gross proceeds; exit gas7,000is deducted
once. Expiry is `now >= expiresAt`, before gas. A fresh-looking quote from before
`executeAt` cannot fill. Failed attempts retain the position and charge the
specified7,000gas; no favorable later quote or automatic retry is substituted.
Disposable ledger/coordinator tests verify cash, realized/marked results, exact
gross-slippage boundaries, expiry and retained exposure against the existing writer.

Examples from the explicit synthetic paths:

| Case, phase0 | Fixed2s net result | Fixed5s | Fixed10s | Hybrid5s |
| --- | ---: | ---: | ---: | ---: |
| Step drop |−0.001780830SOL|−0.001780830|−0.004136110|−0.001780830|
| Temporary rally |+0.003217782SOL|+0.003217782|No exit; position remains open|+0.003217782|
| Silent notification loss |−0.000212631SOL|−0.001780830|−0.004136110|−0.001780830|

The monotonic step-drop example implies modeled drawdown of0.001780830SOL for2s
versus0.004136110SOL for10s before exit. Against the explicit$1,000 reference and
synthetic constant$100/SOL normalization, those are0.0178083% and0.0413611% account
drawdowns. This normalization is not an actual USD/SOL return series. Passive SOL
has zero change only by this fixed-FX assumption. SOL price effects are not credited
to token selection. Natural strategy P&L, drawdown and operating-cost economics
remain **not assessable**; toy outcomes are concentrated in one seed/period.

Hybrid/adaptive had two additional missed lifecycle episodes, six lower filled
proceeds and no lost baseline fills across the28pairs. Earlier stops can also
sell before a recovery, so lower proceeds alone do not establish an inferior
strategy. The missed stop under silently lost notifications is sufficient to
reject blanket protection equivalence. Profitability is not inferred from the
positive rally outcome or averages over only filled cases. Open/unknown outcomes
remain explicit; there is no fabricated liquidation or public performance feed.

## Event triggers and adaptive policy behavior

Account changes are dirty-state hints. A trigger requests a fresh complete batch;
it supplies no liquidation value. Changes arriving during an in-flight request
remain dirty and cause a subsequent check. Redundant notifications coalesce, with
trigger starts no faster than2s. Any due holding refreshes the whole active union
rather than causing staggered duplicate requests.

Frozen adaptive conditions:

- Normal5s; elevate to2s on a relevant change, fresh loss at least10%, fresh gain
  at least20%, known subscription failure, or maximum hold within30s.
- Minimum30s dwell; leave elevated mode only after three fresh safe checks with
  loss below8% and gain below15%, plus a healthy control channel.
- Experimental quiet10s requires60s observed unchanged state and fresh safe
  checks. It is not proof of low risk and is not recommended from this evidence.

Known disconnects fall back to2s, reconnecting alone does not restore readiness,
and each required pool needs fresh coherent state after resubscription. A missing
pool cannot be hidden by another pool's fresh response. Stalled requests retain
physical occupancy. New-risk readiness closes on missing/stale held marks or
unreconciled monitoring. **Silent missing selected notifications despite healthy
heartbeats remain undetectable until independent refresh.** Old safe prices do
not protect against that failure. High change frequency drives hybrid/adaptive
back to2s, so it eliminates the expected RPC saving.

The historical public-RPC probe did obtain7subscription ACKs, restore them after
one planned reconnect, and receive24,825WS bytes. Its17notifications were unchanged;
a later unexpected close had no observed recovery. This verifies a past capability,
not current entitlement, changed-state delivery or protection. WebSocket setup,
resubscription and unsubscribe starts must join the RPC budget; notifications add
bytes/CPU even when they do not cause pricing.

## Batching, complete workload and capacity

Offline `quoteMany()` now validates1–3full holdings from one coherent confirmed
union,8/12/16distinct accounts including Clock. Cold discovery plus state costs
two calls; steady state costs one. All fees, mint extensions, vaults, links, signed
virtual reserves and integer rounding use the existing decoder. Per-pool faults
isolate that pool; Clock/context failures invalidate all. Fixtures combine retained
pools into an explicitly synthetic common context; live multi-pool equivalence is
still unverified. No production price adapter was replaced.

At2s, three independent one-read price checks would cost90starts/minute; the union
costs30: **67% fewer pricing requests without slowing that cadence**. At1/2/3held
positions,2s pricing amortizes to1,800/900/600requests per position-hour. At5s it
is720/360/240; at10s360/180/120. These exclude setup, invalidation, orders and other
work. One-second sustained pricing alone would consume60/minute and is unsuitable
with active candidates and safety reserves.

Use `P + S +6 +2C +4 +6` as a conservative steady scenario: pricing `P`, unique
selected-signature enrichment `S`, six admission/own-action-cost reads, two bounded
integrity reads per candidate `C`, four recovery and six headroom starts. The
integrity allowance assumes its history page actually covers the disclosed window;
truncation or missing events needs more work or invalidates the window.

| Held / active candidates | Assumed S/min |2s union total|5s union total|10s union total|
| --- | ---: | ---: | ---: | ---: |
|1 /1|6|54|36|30|
|2 /3|18|70|52|46|
|3 /5|30|86|68|62|

With six unique selected signatures per candidate/minute, these assumptions allow
1/4/4candidates at2/5/10s; at twelve,1/2/2. These are **local-budget projections**,
not verified usable candidate windows or practical public-provider capacity.
Hybrid/adaptive must reserve the2s peak `P=30`, so quiet savings cannot fund four
permanent candidate windows while claiming that fast protection remains reserved.
More admissions are opportunistic and can lose their windows during escalation.

The180load comparisons enforce60rolling starts/minute, at least1s between starts,
one physical request and held/pending priority. Candidate jobs are modeled RPC
work tokens, not genuine normalized flow or qualified tokens. For example, three
holdings/three candidates at six signatures/minute completed36candidate jobs in
120s, with a common six verification jobs/minute:2s used108starts versus5s72.
Adding the missing admission/recovery/headroom reserves gives70versus52/minute,
so the apparent2s load success is not a complete operating budget. Under high
change activity hybrid returned to108starts. Queue deadlines, missed work and
long physical-RPC delays remain measured rather than silently discarded. In the
five-candidate clustered case,2s completed36/60candidate jobs and missed24, while
5s with unrestricted background admitted48/60and missed12 despite only42starts
in its busiest minute. Average headroom therefore did not cure burst deadlines.
Those raw-demand cases do not include all admission/recovery reserves.

Method accounting: pricing uses `getMultipleAccounts`; each new selected signature
needs `getTransaction`; history/finality use `getSignaturesForAddress` and further
transaction reads; admission includes actual migration/support/rent checks. A
multi-request helper is not counted as one. Held price/time exits need no other
trader's transactions, which the existing proposed design already excludes:
**incremental held-enrichment saving is zero.**

Current `RpcMarket` still makes more reads than this prototype. The execution
coordinator calls context then quote; without reuse even Clock adapters need two
steady reads per sale, and the old helper path can need `3H+3` for Hholdings,
plus a decision estimate. A focused test-only integration now proves one fresh
post-delay Clock batch can supply both interfaces with original timestamps,
exact size and gross quote. Stale, wrong-size and pre-delay cache reuse fail closed.
That integration is **not installed**. Until integrated/request-count tested,
plan the separate reads and test simultaneous exits; six spare mean starts do
not guarantee three orders meet five-second expiries.

## Candidate computation and equivalent work first

The actual development trader **already evaluates once per10s bucket**. Comparing
an independent1s research control with10s reduced calculations7,200→720for12
synthetic candidates/600s, while all9,096actions were ingested and720common-boundary
snapshots matched. This is not a new90% saving over the current trader, and it
saves **zero enrichment requests**. The descriptive Cloud CPU measurement was
194.795→59.396ms; context-driven recalculations add work not included in that ratio.

Corrections, gaps, reversals, risk pauses and quote expiry must take effect
immediately. Strict10s scheduling alone delayed an external-risk-resume example
by4s and could miss a short qualifying window. A tested context recalculation hook
preserves actual availability and does not move the next bucket, but its timing
change is separate from equivalent feature batching. No baseline scheduler was
changed or additional cadence layer attached.

The matrix process used about2.6CPU seconds and218MB peak RSS on Cloud for all
synthetic monitoring/load runs. Per-row CPU measures monitoring only; row wall time
includes monitoring plus lifecycle, with uncontrolled JIT/order. These are replay
processing costs, not EC2 capacity or unattended elapsed time. Broad-stream parsing,
notification wire payloads and actual provider waits are not synthesized into a
claim of live resource compatibility.

## Data-reduction and entry-strategy comparison

The additional comparison reuses the same current baseline, common synthetic
universe, three-minute periods,10s signal clock,$1,000reference and unchanged
$50position maximum, three positions/$150aggregate cost and$50UTC-day loss
pause references. These entry-signal fixtures create no orders or ledger risk gates. It creates no financial
account or fills. Quotes are explicitly synthetic prevalidated inputs; it cannot
establish actual $50-size execution or economic performance. Retained natural
entry economics remain null: no complete matched flow windows exist. Settings
were frozen as `entry-data-comparison-v1`, with no threshold search.

| Optimization | Information/timing changed | What is actually saved |
| --- | --- | --- |
| Fetch transaction, retain mapped projection | Removes raw instruction/log replay material unless selected proofs are kept separately | Two actual serialized results23,630→2,939bytes (87.56%); **same two requests, no incoming HTTP or JSON-parse saving** |
| Skip already-impossible entry quotes | Same full flow and thresholds; changes ordering of cheap predictive rejection before expensive quote, and earlier quote/context knowledge | Synthetic control saved10reversal-case and13quiet-case modeled quotes; operational equivalence still needs slot/knowledge parity |
| Current pool state instead of transaction | Loses executed direction/amounts, buyer roles, concentration and event identities | Avoids a transaction only by supplying different information; not an equivalent flow input |
| Additional price gate before flow | Adds a new selection decision and delays observation start | Conditional avoided enrichment, offset by gate reads and rejected/delayed opportunities |
| Price/liquidity challenger | Removes buyer/net-buy/concentration hypothesis entirely | Can omit proposed PumpApi broad stream, but becomes a separate strategy |
| Remove held-token flow | No change: current exits already need only price/cost/time | **Zero new saving** |

Keep selected raw proofs needed for reproducing normalization/fee bugs. Projected
storage reduction is not wire reduction. Locally dropping PumpApi fields or
irrelevant events saves none of its incoming106,994,938previously measured socket
bytes. A/B still need the broad stream when any candidate needs flow. C could
omit that future stream entirely while retaining free migration discovery and
verified RPC pricing; that is not a saving from production, which has no such
continuous PumpApi stream installed. Continuous infrastructure/transfer costs and
CPU for that alternative remain unverified.

Three entry approaches, not interchangeable optimizations:

- **A — existing flow baseline:** retain all required events and the original rule.
  Supported for the tested software mechanics; economic edge unproven.
- **B — price selection then full flow:** no duplicated eligibility, liquidity or
  size checks get credit. Its only new gate is nonnegative10s same-size price
  return. After admission it starts a fresh60s/six-bin flow window, without
  backfill. It reuses a same-time quote rather than requesting it twice.
- **C — separate challenger:**60s same-size price return at least300bps, seven
  uninterrupted10s price snapshots, and the same liquidity/safety/quote rules.
  Buyer count, concentration and net buying are explicitly absent/null.

Matched-opportunity synthetic results:

| Case | A current | B | C |
| --- | --- | --- | --- |
| Sustained trend | First signal60s;55modeled calls |70s;58calls|60s;24calls|
| Initially ineligible thin liquidity | Already excluded;3initial calls |Same exclusion; no screen credit|Same exclusion|
| Stale quote interval | First usable signal110s|110s|170s after fresh price-window warmup|
| Outage/required-flow gap | First usable signal140s|140s|140s|

Calls include modeled initial validation, observation/enrichment, quotes, integrity
and recovery in these three-minute fixtures, not new physical network usage. Repeated qualified ticks are not independent opportunities or trades; re-entry
would remain prohibited for a real filled lifecycle. No
P&L, drawdown, concentration of winners or passive-exposure advantage is invented
for unfilled signals. All synthetic exclusions/decisions are retained; no outcome
is inferred from a later peak. There is no representative natural screened-out
cohort or chronological held-out economic sample in the existing records.

An equal-budget control is important. The readiness-enabled development trader asks for a quote on warm
buckets before checking predictive thresholds. The installed observer has entries
disabled/unverified flow and makes no such candidate-entry quotes; these are not
claimed savings from its current workload. A research-only lazy-quote control
preserved the provided-oracle qualification booleans across all five scenarios
without adding a price gate. In a quiet one-signature/minute scenario, currentA
costs22starts including declared reserves; the lazy control16; B21if it rejects
and22if it admits. At12signatures/minute, A/lazy33; B21only under optimistic
complete rejection, or33if admitted. Fewer calls obtained by excluding all
opportunities are not improved useful coverage.

Deferral is not yet proven operationally equivalent: skipped quotes also remove
intermediate price/context knowledge. A future qualifying quote must retain the
maximum required verification-slot floor, current source checks and exact
size; the flow-slot-to-market handoff is not integrated. Refusal timing/reasons
also change. Review and prove that narrow ordering optimization first rather than
attaching another screen. Do not count absent unneeded information as a free
replacement for required safety evidence.

**Entry recommendation:** retain A for qualification; reject integrating the
proposed extra B layer on current evidence (extra work/delay, no demonstrated
benefit); C's economics are **not assessable**, although its isolated signal
mechanics are testable. Detailed flow's incremental economic value cannot be
answered from quiet quotes and isolated sells. Do not remove it from A or claim
C is better merely because it needs fewer transactions. No entry or monitoring
policy was deployed.

## Exact next action and remaining evidence

The strongest next measurement is the equivalent pricing/notification component,
not a strategy change. [next-live-proposal.json](../evidence/adaptive-monitoring/next-live-proposal.json)
is a **proposal only**, requiring a new explicit live-research grant because the
previous experiment completed with a preserved429:

- Public Solana RPC only; one supported active pool with hypothetical holdings;
  no PumpApi capture or wallet operation. First verify current Clock/time and
  coherent pricing. It does not certify three-pool trigger coverage.
- At most90s total: setup15s, common observation60s, cleanup10s, shutdown5s. One socket at a
  time, one predeclared reconnect, no automatic retry/second session.
- At most70request units:43HTTP reads (including one preflight Clock batch,
 30common periodic batches and five extra triggered batches),21subscription-management messages,
  two upgrades and four shutdown headroom. All share60/rolling minute,
 30/10s, at least1s start spacing and one physical read/ACK at a time.
- Responses at most32MiB (HTTP24+WS8), socket/application stop7/6MiB with headroom;
  retained evidence8MiB within the existing32MiB ceiling. Cloud nonroot,
  heap128MiB/RSS256MiB/CPU20s/FD64/payload64KiB/event-loop lag500ms.
- Stop on429/overload, bad state, stalled physical slot or any ceiling. Missing
  real changes, gaps or deadline violations remain inconclusive, not protection.

This would leave150request units and33,281,798response bytes. Current values remain
**20/240requests,272,634/67,108,864bytes**,220requests/66,836,230bytes remaining,
`RPC_HTTP_429` unchanged. Original PumpApi112MiB/100s reservations and the unused
new capture remain intact. Nothing here resets usage or overrides the refusal.

A subsequent economic A/B/C comparison needs a common discovery cohort, complete
available flow windows and chronological size-specific entry/exit opportunities.
The existing quiet data cannot supply that. The bounded component above does not
pretend to answer profitability or substitute for combined flow/pricing/failure
acceptance. No provider purchase, larger budget or repeated marginal experiment
is requested. The current exact owner-only next action, if continuing live research,
is approval of the one concrete component proposal; no infrastructure action.

Evidence lives in `evidence/adaptive-monitoring/`. Detailed matrices are losslessly
compressed; hashes and the preserved initial fixture result are retained. Software
checks, replay and synthetic outcomes do not establish production capacity,
profitable trading, a24/72-hour unattended interval or economic edge.
