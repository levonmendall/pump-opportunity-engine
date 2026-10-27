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
and authenticated publishing were untouched. The initial comparisons below are
offline; the separately labeled overnight section adds authorized live component
measurements. No deployment, entry enablement or acceptance clock. Natural PAPER
trades created by this work: zero. Latest reporting read: snapshot1049 at08:04UTC;
this is not a direct host health or private-database audit.

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

## Prepared component proposal — historical state at4bbb213

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

The owner subsequently approved that exact proposal. Its single execution and
current linked counters are recorded below; this historical proposal is no longer
a pending owner action or an active grant.

Evidence lives in `evidence/adaptive-monitoring/`. Detailed matrices are losslessly
compressed; hashes and the preserved initial fixture result are retained. Software
checks, replay and synthetic outcomes do not establish production capacity,
profitable trading, a24/72-hour unattended interval or economic edge.


## Approved public-RPC component — actual 2026-10-27 result

**INCONCLUSIVE: no supported active pool was established within the four-read
selection allocation.** The grant was executed once and stopped during setup.
It did not reach Clock validation, position pricing, subscriptions or reconnect.
This is a selection failure of this bounded sample, not evidence that Clock-based
pricing or free data is unsuitable. No second session or retry ran. The unchanged
proposal at 4bbb213 remains the historical limit specification, not a new grant.

Authoritative receipts: [summary.json](../evidence/public-component-20261027/summary.json),
[supervisor.json](../evidence/public-component-20261027/supervisor.json), and the
linked [rpc-budget.json](../evidence/public-component-20261027/rpc-budget.json).
The exact retained responses and availability times are in `observations.ndjson`;
no provider or wallet credential is present. Reproducible code is
`scripts/public-rpc-component.ts` (local tested harness commit 83b0623). The source
hashes in `grant.json` identify the exact code used independently of later report
commits. `node --use-env-proxy --import tsx scripts/public-rpc-component.ts` is a
network-free inspection; adding `run-approved` is the one-use live command and
now refuses because the completed grant directory exists. Do not delete that
directory to rerun it. Offline checks: `npm run build`, `npm test`, and strict
TypeScript checking of the two component scripts; 397 tests passed before the run.

| Actual measurement | Observed result |
| --- | --- |
| Total supervised wall time |3.992 seconds,06:09:45.482–06:09:49.474UTC (child completed06:09:49.447UTC) |
| HTTP operations |2 `getSignaturesForAddress`,2 `getTransaction`; 4 new units |
| HTTP response bodies / WebSocket receipt |104,424 bytes / 0 bytes |
| Actual start spacing |1,003 ms,1,004 ms,1,002 ms; one physical operation at a time |
| HTTP response times |52–564 ms; lower-median 121 ms; p95 564 ms |
| New429 / overload / retry |None / none / none |
| Supervisory peak RSS / CPU |137.57 MiB / 1.270 CPU seconds including Node/SDK startup |
| Child event-loop lag maximum |0.800 ms after the child's watcher began |
| Pricing / notifications / reconnect |0 completed quotes / 0 connections /not attempted |
| New evidence before supervisor receipt |198,036 bytes; below 8 MiB and cumulative 32 MiB limits |
| Original records and source hashes |All checked prior evidence and test source unchanged |

The seed pool `6ztGkeEPFbrBVh53fKbRtJk4Y74UBjPE8R5q5Ke2hvZv` returned eight
successful address transactions, but the newest was approximately 4.5 hours old.
It did not meet the fixed 30-second activity requirement. One current program page
contained 256 transactions (197 successful) in two chain seconds. The two systematic
successful-transaction samples did not establish an invoked canonical SOL swap.
Program-address activity alone was correctly insufficient to admit a pool. This
was activity-biased transport selection, not an opportunity cohort or strategy
performance test. The [offline selection audit](../evidence/public-component-20261027/offline-selection-audit.json)
resolved both exclusions against the captured instructions and pinned SDK IDL:

- The first successful v1 transaction invokes `multi_hop_swap`: two canonical
  pools with non-SOL quotes and a non-SOL bonding-curve hop. None is a canonical
  SOL pool. The selector does not currently discover/normalize `multi_hop_swap`;
  that named coverage limitation did not exclude an in-scope pool in this record.
- The second successful v0 transaction carries PumpSwap in its account list but
  has no PumpSwap instruction invocation. Its log says `No profitable route`.

Three retained-evidence regression tests reproduce the cumulative counters,
actual start spacing, route account/PDA exclusions and address-only refusal:
`node --import tsx --test test/component-live-evidence.test.ts`. They add no
network use and do not claim trade-flow or pricing acceptance.

The old counterbook remains byte-for-byte **20 units / 272,634 bytes with
`RPC_HTTP_429` retained**. The new linked chapter adds4units /104,424 bytes, giving
**24 cumulative units / 377,058 measured response bytes**, with no pending response
reservation. Remaining aggregate ceiling: 216 units / 66,731,806 response bytes.
The unused 66 units of this completed component grant are inactive; unused ceilings
are not another test authorization. Original PumpApi actual/reserved counters,
time reservations and unused capture remain unchanged. No PumpApi, Alchemy,
Helius, wallet or production endpoint was used. Public-RPC API fees were $0;
existing infrastructure and unverified transfer costs are separate.

Live Clock layout/owner/context/source-time behavior, same-byte SDK parity on
current accounts, independent slot block timestamps, two-second quote freshness,
evaluation gaps, actual price changes, threshold recognition, notification
delivery and the planned reconnect are **all unmeasured by this attempt**.
Offline tests for those mechanics remain offline evidence. No natural trading
result, continuous protection, three-pool saving, combined workload capacity,
profitability or unattended acceptance follows from the four successful reads.

The smallest remaining component gap is a current supported canonical SOL pool
identity that can be established within the fixed setup budget, followed by
actual Clock/pricing/notification observations. The captured transaction
exclusions are now resolved offline; the next setup
would need a fresh in-scope seed, preferably an identity already discovered by the
existing free migration path, instead of this 4.5-hour-old seed or two unfiltered
program-transaction samples. This is a test-selection correction, not a candidate
strategy screen. No additional selection or live capture ran. Do not add a price screen, alter strategy,
weaken quote validity, adopt blanket 5-second polling or silently expand selection reads.
A further live attempt requires a separately reviewed grant. No new allowance,
provider purchase or owner infrastructure action is requested here.

The two-second reference remains the recommendation. The observer, account and
inception, financial history, public Render viewer and machine authentication
were untouched. No production health/freshness check was performed this session.
PAPER entries/live trading remain disabled; acceptance clocks remain unstarted.


## Overnight live component and integration evidence — 2026-10-27

This section adds real observations; it does not relabel the earlier synthetic
policy comparisons as forward trading. Full receipts, code provenance and exact
usage: [OVERNIGHT_HANDOFF.md](OVERNIGHT_HANDOFF.md) and
[final-summary.json](../evidence/overnight-20261027/final-summary.json).

| Question | Measured answer |
| --- | --- |
| Fresh Clock/account/SDK validity | Quiet supported pool passed full validation; two three-pool16-account unions produced six exact same-byte quotes |
| Two-second three-holding pricing |35periodic union evaluations during69.530s of combined feed observation; all used quotes15–41ms old |
| Completed evaluation delays | p952.073s, maximum3.224s;1.425s censored tail. Fresh-cache gap2.688s/3.866%. No sampled stop/TP crossing |
| Subscription/recovery | Seven desired accounts acknowledged/restored after one planned reconnect; fresh state851ms after upgrade, before all ACKs. One changed version matched in the earlier interrupted run; changed delivery after reconnect unverified |
| Actual trade fields | Captured seven sells (two direct/five CPI), two V2 exact-quote buys corrected offline; separate delayed legacy exact-quote Buy proof. Complete event identity/commitment still needs per-signature getTransaction |
| Combined flow quality | Four sells normalized; two Buy failures; audit5underlying swaps/5hints/3original normalizations. Zero usable forward60s windows |
| Corrected replay | One raw warmed closed window using original information times, still fails buying/concentration rule; no entries or P&L, no forward acceptance |

Measured steady union pricing demand was30.20starts/minute for three holdings;
enrichment was5.18/minute for one light candidate. Relative to three independent
Clock checks at the same cadence, one batch projects90→30pricing starts/minute.
The test establishes actual batching/math, not a continuous60/minute capacity
pass: one-second start pacing, delayed hints and quote completion interact. With
an illustrative12/minute integrity/recovery/headroom reserve, only about18/minute
remain for aggregate enrichment, admissions and any costs exceeding that reserve.
Short bursts and recovery may fail even when the average fits. No endpoint
entitlement, EC2 capacity, profitable exit or arbitrary shortlist size is proved.

A strict reservation of every future two-second start was tested offline and
**rejected as the default**:10ms pacing jitter can indefinitely starve candidate
enrichment. Its opt-in negative experiment remains off in every runner. The
observed3.224s gap is unresolved; no slower policy, raised limit or stale quote was
used to obtain a pass. The next engineering task is a bounded shared deadline
policy that exposes infeasible demand rather than dropping required evidence.

Equivalent improvements remain first: coherent dependency union and compatible
fresh post-delay quote reuse. Clock bank time changes timestamp provenance and
is explicitly separate from independently retrieved block time. Optional lazy
quotes preserve the existing predictive predicate and slot floors, but defer
quote/refusal knowledge and can change asynchronous decision timing; default off.
Candidate10-second buckets and zero held-token enrichment already existed and
are not counted again. No preliminary price screen was added. Economic comparison
of full-flow versus a price-only challenger remains unassessable on this sample.

The peak Cloud RSS was155.57MiB and CPU3.685seconds for the combined component;
broad traffic was65,179,210bytes/69.530s. Local filtering does not reduce that
incoming traffic. The conditional continuous projection is80.99GB/day and2.43TB/
30days, not a measured free infrastructure allowance. API fees were$0; no EC2
experiment or production deployment occurred. All stream reservations are now
committed, so no automatic forward rerun is permitted.


## Shared scheduling correction — offline continuation after52855aa

This continuation makes no market-data/RPC requests and changes no production
service/account/dashboard. The previous actual forward failures, corrected Buy
replay, HTTP429 and all counterbooks remain intact. Read the new bounded evidence
under `evidence/scheduler-correction-20261027/`; the final scheduler artifact is
`scheduler-evaluation-v4.json` (older prototypes remain separately retained).

### Demonstrated cause

The actual longest completed-evaluation gap was07:48:29.025→07:48:32.249UTC.
The exact partition from retained timestamps is:

| Interval | ms | Evidence meaning |
| --- | ---: | --- |
| Previous completion→next nominal pricing eligibility30.903 |1878| Remaining reference interval, not processing delay |
| Pricing eligible→job selected31.276 |373| Second admitted enrichment overlaps due time; includes36ms unseparated dispatch residual |
| Pricing selected→physical HTTP start32.174 |898| Shared1s start spacing plus unseparated local preparation |
| HTTP start→complete response body32.221 |47| Combined network/proxy/provider response interval |
| Body→account snapshot32.226 |5| Result delivery/bookkeeping/snapshot capture combined |
| Snapshot→three-holding validation/use32.249 |23| Decode/SDK/parity/recording combined, not isolated CPU |
| Total |3224| Exact actual gap |

Both hints were eligible30.128. First enrichment selected30.167, physically
started30.169 and completed30.216. The second selected30.270, entered pacing,
started31.172 and completed31.240. Pricing became due while that lower-priority
job already owned the dispatcher; its own next legal start was then32.172.
No rolling request ceiling bound this interval. Provider saturation is not proved;
the pricing response was47ms. Exact queue-enqueue timestamps beyond selected-hint
receipt and individual persistence/parsing costs were not recorded and remain
unseparated. `trace-analysis.json` reconstructs every available job/gap and verifies
unchanged original input hashes.

### Implemented correction and information/timing changes

The existing physical gate now exposes a read-only dispatch-ready view. The
research dispatcher peeks at retained hints without activating them, chooses work
only at physical readiness, gives due holding checks priority and admits at most
one enrichment/control start per protection cycle. A finite100ms dispatch window
replaces equality at one exact start instant. Admission reserves25ms inside that
window for durable setup; the captured pre-invocation costs were1–7ms. This is
a conditional overhead assumption, and the unchanged physical deadline still
fails closed if it is exceeded. The actual start deadline is checked
again after durable reservation; expiry never silently retries or refunds a unit.
The same single gate retains one-second spacing, rolling60/minute and30/10s limits.

If a known late-phase hint cannot use that window, at most one early coherent
holding refresh can create a service opportunity. It coalesces one future target,
reanchors the next target earlier, and cannot repeat before the granted other
operation or an ordinary due check. There are at most5early checks and43total
pricing attempts in the proposed75s component. These are additional measured work,
not free request savings. Adaptive sleeps wake at the next relevant pacing,
protection or eligibility boundary rather than a fixed100ms grid.

**Early refresh changes observation phase. It is not an equivalent exit-timing
optimization.** Synthetic checks4,5,7 can miss a temporary15%stop during5.5–6.5 that
checks4,6,8 observe; the reverse temporary path favors the earlier phase. No natural
price path is interpolated and no P&L is constructed. All target misses, actual
completed gaps and information delays remain visible.

Enrichment receives a whole-job envelope up to1,200ms: at most1,000ms physical
HTTP plus200ms research processing reserve. Near the5s usefulness deadline its
HTTP timeout is tightened within that same maximum, with100ms start headroom.
The processing reserve is an assumption, not a guarantee. Actual normalization
availability is now sampled after full transaction validation and preparation;
late validation invalidates the window before ingestion. All constituent swaps
enter atomically. Original executed-event RPC receipt, identities, quantities,
trader roles, fingerprints and fee/transfer proofs are unchanged.

New diagnostics distinguish eligibility, dispatch, pacing, physical start/settle,
RPC receipt and completed validation;1s aggregate byte samples are bounded and do
not archive broad traffic. Post-invocation telemetry/storage failure keeps the
physical slot until actual settlement. Refused selected events remain explicit
required-evidence failures. Pending financial actions stay owned/unresolved,
never disappear as obsolete candidate work.

### Timing contract

| Requirement | Current contract |
| --- | --- |
| Polling target |2000ms, with explicitly reported early phase changes |
| Maximum accepted completed-evaluation gap | UNFROZEN; no new acceptable delay is approved by this correction |
| Quote age at actual decision/use |≤2000ms, unchanged |
| Confirmed source-state age |≤30000ms, unchanged; Clock bank time remains separately labeled |
| Enrichment | Eligible after1000ms; full validated information required within5000ms of receipt |
|100ms dispatch/200ms processing envelopes | Research admission assumptions, not protection tolerances |
| Outage/unknown settlement | Block admission, invalidate affected flow, preserve exposure/actions; no invented price/fill/replay |

The old `scheduledAt+2000ms` job deadline never meant that completed evaluations
were at most2s apart. Its passing status did not make the actual3.224s gap safe.
This correction does not retroactively approve it, or approve a2.041s maximum.

### Tested limits and remaining evidence

Final tables and fault outcomes are in `scheduler-evaluation-v4.json`. Rescheduled
response costs are counterfactual: another request time could have returned other
market state or taken longer. Actual provider behavior is still the retained
trace, not the simulated schedule. The fixed-wake prototype is preserved as a
negative result; use the final adaptive-wake/FIFO model for the implemented policy.

With recorded costs/arrivals,0/10ms wake jitter serves6/6selected transactions;
the modeled maximum gap is2041ms. It uses43working starts (37pricing+6enrichment),
versus41working starts in the legacy model; setup is separate. Maximum information
availability delay grows to3312/3383ms. This improves the demonstrated protective
scheduling defect at the cost of extra work and later candidate information.
It does not establish unchanged features, entry timing, prices or outcomes.

At50ms added wake jitter, only5/6enrichments complete; one is refused explicitly.
At100ms, none complete: five refusals and one end-censored job remain. These
windows are unusable. Three-event bursts and slow responses also remain failed/
incomplete workloads. Refusals and deadline-censored work cannot count as complete windows.
Two simultaneous pending actions and reconnect competition use the same gate;
the pending actions meet their deadlines while a candidate fails and the modeled
protection gap reaches4008ms. This combined workload is not adequate for complete
candidate observation: pending/recovery capacity must be reserved before admitting
new risk. A single reconnect control operation represents this PumpApi path,
not a seven-account RPC subscription restoration. Pure scheduler recovery after a simulated settled timeout
is distinct from the actual component, which halts its measurement on that fault.
No reliable arbitrary-candidate capacity or production protection equivalence is
claimed. The feasible tested envelope is one light candidate with the actual
retained burst pattern and low scheduler jitter, plus one coherent3holding batch;
higher uncertainty closes admission rather than adding another queue.

Build, compile and512regressions pass, including the24scenario scheduler
comparison and both exact-quote Buy/Sell validation proofs. The original
six-event corrected replay remains semantically identical with its original
information clock and immutable artifact. Build/compile/full-suite validation is
recorded in the final offline receipt. No source test is forward acceptance.

### One concrete forward proposal — not executed

`forward-proposal.json` requests ONE new140MiB PumpApi reservation for up to90s
connection time:75s measured from successful open,5s drain and bounded setup/
shutdown. Existing256MiB/230s reservations are untouched. Requested cumulative
ceilings become396MiB and320s: **+140MiB and+20s** above the existing limits; the
90s reservation uses the70s unreserved time plus that20s increase. No extra RPC
allowance is requested.

The73planned units are3preparation +2coherent prewarm +1upgrade +38regular/5early
price checks +10enrichments +14independent audit (2history pages,10transaction
lookups,2finality checks). Four of the existing77units remain headroom. Every
phase counts inside120s total; the stream phase has its own90s maximum. Response
cap32MiB fits the63,520,956accounted bytes remaining. New evidence≤6MiB remains
within the existing32MiB cumulative ceiling.

Measured broad ingress was65,179,210bytes/69.530s. A2×mean sizing scenario for75s
requires140,613,858bytes, below the proposed138MiB socket stop; application stop
136MiB/hard ceiling140MiB preserve headroom. Broad rolling peaks were not captured,
so this is a sizing scenario, not a guaranteed bound. Any byte/resource/deadline/
audit stop means incomplete, never a fabricated successful window.

The full aligned60s target ends within70s of open, leaving5s for confirmation.
Three hypothetical holdings and one predeclared active canonical pool are used;
current support is separate from unverified migration-origin/entry-age eligibility.
A legitimate rule or eligibility rejection is valid. Auditing must independently
cover the exact interval and all required constituent swaps. More than10selected
transactions, an unserviceable burst, a missing field or incomplete denominator
invalidates that window; no sampling or silent provider/strategy change.

This proposal is **not active authorization**. Current64MiB runtime receipt limits
and durable reservations remain in force. The future explicitly granted profile
must apply the proposed stops/caps and phase deadlines before any connection.
No capture, RPC retry, production restart/deployment, account reset or entry
permission is created by the proposal. API fees would remain$0; infrastructure
transfer/storage entitlement is unverified and is not labeled free.

Reproduce offline only:

```sh
npm run build
npm run compile
npm test
node --import tsx scripts/replay-overnight-correction.ts --verify-existing
```

The trace and scheduler test modules recompute the retained trace, shared deadline
policy, stress failures and phase counterexamples without contacting providers.
