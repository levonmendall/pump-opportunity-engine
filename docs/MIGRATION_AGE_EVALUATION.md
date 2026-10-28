# Migration-age evaluation

**Keep entry eligibility at 5–120 minutes; separate observation from that rule.**
No economic optimum has been proved. POE now supports immediate observation after
canonical migration/support verification and bounded non-entry research for
selected active 2–6-hour pools. Earlier and older observation do not authorize
purchases. The known SI and FRONGUS moves already occurred inside the baseline
entry interval, so widening entry age alone cannot repair those coverage losses.

The initial retrospective analysis below uses unchanged retained evidence. Later
sections identify subsequent implementation and actual live evidence separately.
No counterfactual profit is presented as a fill or portfolio result. Source,
input hashes and reproducible results are in
[analysis.json](../evidence/migration-age-20261028/analysis.json).

## Frozen comparison and evidence

The settings were written before calculation, without a threshold grid:

| Variant | Entry-age condition | Other rules |
|---|---|---|
|A,baseline |5–120min |Unchanged persistent-buying rule and financial/data requirements. |
|B,earlier |1–120min |Same60second window, buying/participation/concentration and price structure. |
|C,older |5–360min |Same rules and execution assumptions. |
|D,adaptive |Not assessable |No frozen adaptive rule or adequate matched economic data; none invented. |

Settings hash and exact definitions are in [settings.json](../evidence/migration-age-20261028/settings.json).
Net curve buying≥1SOL,≥4positive10second buckets,≥5buyer wallets,largest≤35%,
nonnegative trade-price structure, actual-size$50maximum initial cost,
15%stop/30%profit/15minhold,1sdelay/5sexpiry/1%slippage, pool fees, gas and
refundable rent treatment remain unchanged. Different wallets do not establish
independent people. The three-position/$150aggregate and daily-loss controls
are not changed by an age comparison. No stale quote becomes usable because
its token is older: maximum quote age at use remains2seconds.

The script strictly re-decodes77unique migration origins from retained original
confirmed/finalized transactions and requires identical genuine migration,
canonical SOL-pool and actual base/quote roles. It uses their original validation
availability. It never promotes current index-created times into on-chain proof.
A bounded current manifest snapshot supplies only nonfinancial identity metadata;
expired identities have been pruned, so immutable creation proofs preserve their
actual times independently of the current cache.

Of10independent case-study price histories(9current-indexed leads plus
owner-nominated SI), only3have retained verified creation proofs: SI,
FRONGUS `2nPP…pump`, and WANSULEK. The7unproved timestamp cases, including INGUS
and Something, are excluded from age-bin performance comparisons. Their
independent in-run price moves remain important coverage leads; they cannot be
assigned a reliable migration age from index hints alone.

This sampled universe is survivor/current-volume biased, not a market census.
There is no independently sampled weak/loser population with complete executable
paths. The broader121recorded feature assessments are selected POE windows over
47tokens; they must not be confused with the3verified independent price cases.

## Pre-repair age-gate audit

| Component | Current behavior | Consequence |
|---|---|---|
|`strategy.ts:4,188–191`;`pilot-contract.ts:6` |Verified migration required; primary entry5–120min. |An entry hypothesis/boundary, not a proved economic optimum. |
|`pilot-watch.ts:18,38,41` |WATCH eligibility and deep promotion start at5min; verified identity expires at2h. Unverified hints retained125min from receipt. HELD/ENTRY_PENDING protected. |Observation is coupled to the entry interval; early full windows are never collected, and older shadow awareness is removed. |
|`pilot-watch.ts:74,113,117` |Wait/fairness/coverage denominators are anchored to migration+5min; transition to deep calls the same eligibility predicate. |Changing only a strategy constant does not enable earlier observation or correct its coverage denominator. |
|`pilot.ts:68` |Historical cache selector permits warming from4min, plus remaining-window runway. |The current WATCH/prepare5min gates still dominate; this does not provide actual4min observation. |
|`pilot.ts:199,204` |Restart imports non-owned proofs only through2h5min; proof pruning releases non-owned entries at2h. Owned/pending identities remain. |An older-watch experiment needs explicit separate retention/import rules, not a widened entry constant alone. |
|`pilot.ts:231,295–302` |Preparation returns before5min and after2h; ready-to-activate checks include5–120min. Current support and audit runway checked before preparation/admission. |Normally first complete audited information is obtained later than5min, not immediately when entry age is reached. |
|`pilot.ts:142–145` |First closed bucket end=`ceil(now/10s)*10s+60s`; earliest audit starts5s later and must precede2h expiry. |Fresh warming takes65–75s optimistically, plus real preparation, confirmation and audit completion. Near-expiry admissions are correctly refused. |
|`pilot.ts:318`;candidate retirement |Non-owned deep scopes retire at2h, on evidence loss, or after180s allocation; normal weak-window rotation remains separate. |Entry-age widening needs consistent lifecycle changes; it must not turn the slot lifetime into continuous unbounded enrichment. |
|`trader.ts`;candidate cadence |Predictive features use six complete closed receive/validation-time buckets, with slot/context floors and independent readiness. |A nominal1min minimum cannot supply an instant usable window. No historical unobserved flow may be backfilled. |
|`pilot-market.ts`;`rpc-market.ts`;pricing |Require migration identity/slot floor and current supported mint/vault/fee/source state. They do not use migration age as price freshness. |A quiet/older supported pool may be priced freshly. No source-age, extension, fee or integer validation should be loosened for it. |
|`execution.ts`;order coordinator |Modeled delay, expiry, actual-size fresh state and slippage apply. No separate migration-age predicate is added at the fill attempt. |Current entry age is decided at signal time; any future age-at-attempt change must be explicit, not silently inferred. |
|`strategy.ts:207–219`;position management |Exit depends on actual-size liquidation, cost and holding time, not token migration age. |Protection continues after the token's entry horizon ends; WATCH expiry must never discard held exposure. |
|Unadopted overload worktree |Capacity-await/probe policy uses5sreassessment, bounded probes and the same age eligibility; technical guard reassessment30s. |These are resource/recovery conditions, not earlier/older entry permission. |
|Unadopted origin-recovery helper |Index time selects a bounded temporal search; actual confirmed/finalized creation establishes age. Current pool support and entry eligibility remain false. |Recovering an old identity does not make it age-eligible or restore missed flow. Slot-time hints are not migration proof. |

The pre-repair development excerpts, hashes and worktree paths are retained in the
analysis's`sourceInventory`; they are not claims about every historical release.
The primary strategy currently excludes ages strictly greater than120min while
WATCH/retirement use an exclusive120min boundary. The observable pipeline is
therefore effectively[5,120). This one-boundary discrepancy should be unified
explicitly during a reviewed implementation, not used to claim new coverage.

## What the retained observations establish

Age bands below are measured from the actual verified chain migration time.
OHLC close timestamps are candle-end conventions, not guaranteed publication
or transaction times. Full bars are counted only when wholly contained in a
band; missing minutes are not interpolated. A point near a boundary is not a
complete strategy minute.

| Band | Age |Verified independent tokens / close endpoints |Wholly contained nonempty bars |Recorded predictive windows(all verified POE tokens) |$50capacity quote states |
|---|---|---:|---:|---:|---:|
|A |0–1min |3 /3 |0 |0 |0 |
|B |1–3min |3 /6 |3 |0 |0 |
|C |3–5min |3 /6 |3 |0 |0 |
|D |5–10min |3 /15 |12 |0 |0 |
|E |10–30min |3 /55 |52 |35 |2 |
|F |30–60min |3 /64 |62 |41 |4 |
|G |60–120min |3 /80 |77 |45 |2 |
|H |2–6h |2 /9 |8 |0 |0 |
|I |6–24h |0 /0 |0 |0 |0 |

All121recorded predictive assessments have an original-time available migration
proof and lie within5–120minutes. All fail the unchanged predictive rule. A/B/C
therefore have the same121assessable age-eligible observations and0feature passes;
this is **selection-biased parity**, not evidence the age variants are equivalent.
There is no complete earlier-than5min or older-than2h flow window in this sample.
Restoring age metadata from immutable creation proofs improves retrospective
attribution; it does not add trades or backdate information into a decision.

The3verified price cases illustrate why price-only rankings cannot select an
entry-age optimum. Within1–3min, the largest observed exact1minute pair was
WANSULEK+10.83%;3–5min FRONGUS+13.63%;5–10min SI+319.34%, during a research
interruption. The FRONGUS22:14→22:29 close-endpoint rise(+1967.87%) occurred at
60.32→75.32min age **inside the current baseline** and an active run, yet no
complete audited predictive window was obtained. SI's main20:28–36 rally was
also inside5–120min; its major rise/collapse occurred in a process gap, with an
eligible pre-rally interval left unobserved. WANSULEK's initial deep scope lost
mapping evidence before its21:50–51 move; late quiet rejections cannot explain it.
These facts support repairing coverage and data completeness before attributing
misses to the age thresholds.

The full artifact contains exact1/5/15minute pairs, including periods spanning
research interruptions; it marks whether both endpoints lie in one actual run.
Their appreciation is indicative USD, not executable net SOL return. The largest
ex-post pairs can be exceptional and handpicked by the ranking itself. They are
not independent signals or proof of a fill, an exit, drawdown or an economic edge.

Eight retained FRONGUS states support a historical$50all-in SDK size estimate,
all at14.66–89.42min age. They preserve fees, gas, locked refundable rent and actual
quote availability. None supplies a complete observed post-delay entry plus
rule-timed protective exit path for this comparison. There are no such size
states below5min or above2h. Sparse2–6h endpoint observations and absent6–24h data
cannot justify extending entries or assuming older tokens are harmless.

## Safe capability improvement and next measurement

The smallest useful change is to split **observation admission** from **entry
eligibility**. After genuine migration identity and current support are verified,
allow bounded early observation and collect all required trade events. Keep the
baseline entry check at5–120min. Independent early feature diagnostics may report
complete/unavailable features and age-ineligibility without permission, quotes
or financial actions. Expensive admissions remain subject to verified demand,
holding/pending priority, capacity probes and honest gap invalidation.

Optimistic early-warming arithmetic illustrates the potential, without inventing
observations: FRONGUS identity was available21:14:17.832, making a closed window
no earlier than21:15:20 and audit eligibility21:15:25(age1.73min); WANSULEK could
reach audit eligibility atage1.8min; SI atage3.4min because identity verification
was later. These are necessary timing bounds. Actual support, enrichment and
audit completion can delay them further. Even observing from migration itself,
six closed10second buckets plus audit latency cannot produce a valid entry in
the0–1min band. The existing1s execution delay follows a usable decision; it does
not shorten warming.

Prepare one bounded600second **candidate-only shadow** interval with up to3slots:
a newly verified supported pool observed before5min; one5–120min comparison; and,
if a genuinely supported active identity is available, one2–6h non-entry shadow.
Use current providers, request/byte/resource caps and shared scheduling. Keep
source/config frozen; no live or PAPER orders; no duplicated active test. Log
identity/support availability, all selected hints, confirmed enrichment, six-bin
warming, audit completion, slot wait, RPC use and incomplete windows. If a class
cannot be observed, report it unavailable rather than replace its identity using
index time. Do not promise complete3slot coverage when burst capacity fails.

This first measurement answers whether separating warming actually supplies
useful earlier complete evidence without damaging existing work. It does not
settle15minute exit economics. Only after complete chronological flow and
actual-size quote paths exist should separately labeled1–120min or5–360min
entry variants be compared on held-out observations. Bounded lightweight older
WATCH awareness(2–6h, and6–24h only when measured useful) can collect missing data
without continuous full enrichment or widening entry permission. It requires its
own finite retention/capacity denominator and must not displace held protection.
No adaptive threshold or optimum is recommended from the present evidence.

Reproduce offline, writing a new output directory so prior evidence is preserved:

```sh
node --import tsx scripts/analyze-migration-age.mjs /tmp/poe-migration-age-recheck
```

The result separates independently recorded market prices, actual recorded
predictive evaluations, historical size-capacity estimates and synthetic timing
arithmetic. No natural trade performance or profitability claim follows.

The reproduction command requires the retained nonfinancial research archive at
`/workspace/poe-pilot` and the named review worktrees. It fetches no replacement
history when those inputs are absent. Initial derived output is preserved under
`evidence/migration-age-20261028/initial/`; the top-level artifact includes the
completed source-gate inventory.


## Implemented observation separation and actual forward evidence

The baseline strategy and financial limits remain unchanged. Source
`e69ad8bf012582a004b1820f28743e6e3e34d056` includes:

- Observation from verified market availability, with a genuine fresh six-bucket
  window and independent audit. The primary entry callback still requires
  5–120 minutes. Independent predictive readiness has its own observation-only
  callback; it requests no quote merely to assess buying features.
- A 174-identity registry: 150 primary identities plus at most 24 selected older
  research identities, with at most one older deep slot. A fresh activity hint
  can select an otherwise age-expired 2–6-hour identity; it supplies no qualified
  trade data and clears neither provider cooldowns nor capacity gates.
- Retention of reusable origin identity through the selected observation horizon.
  Required pool, mint, vault, fee and Clock inputs remain freshly validated.
  Existing positions and pending actions remain protected from age retirement.
- Missing cached proofs no longer occupy a non-runnable selection head. Exact
  retained origin signatures enter the existing verification queue on fresh
  activity; terminal/protected/expired identities cannot be revived. There is
  no fabricated origin time or reconstructed historical flow.

The first age interval, source `1657bb4`, ran for 318.444 seconds and obtained
three audited windows using 35 physical operations. It exposed the missing-proof
head blockage and was deliberately stopped for repair. Its immutable before-state
and regression are retained under `selection-head-block/`. Younger candidates
waiting during that interval are technical coverage losses, not evidence that
early trading is unattractive. Two earlier starts refused before network use;
local history-runway and feed-limit composition defects were repaired and tested.

The corrected frozen six-slot interval
`pilot-20261028022044929-0a67e810` began at 02:20:44.929 UTC. Source SHA256 is
`07590f2df97516d595f24bc7d12ec3b5041b91d275bac101cd643bd86e6bc16b`;
configuration is
`4f159a554019e1d9c52af7df825b4ccbd4e43dedae5ead7ef771013c2001a18d`.
This is candidate-only operation with no financial entries or ledger resets.
Its final scorecard must be read after natural settlement; an interim concurrency
peak is not proof of sustained six-pool capacity. All 939 repository tests,
build and compile passed before this interval.

Separately, the existing EC2 administration route completed a read-only native
confirmed-program-event component for FRONGUS. Its original verified migration
identity was reused; current support and activity were independently rechecked.
The exact closed window was **02:16:40–02:17:40 UTC**, assessed at
02:17:44.251 UTC: **149 trades, 97 buys, 52 sells, 44 buyer addresses, net
−23.821587658 SOL and two positive buckets**. The unchanged buying predicate
legitimately failed. This is cohort H observation, not an age-eligible baseline
entry. The 21.17% trade-price decline is not an actual-size liquidation result,
a stop-loss execution or realized portfolio loss.

An independently bounded history audit matched all 293 interior pool-address
transaction signatures using three pages; boundary slots remain excluded.
Four fetched representative transactions matched exact economic fields and SPL
transfers. Those later checks are not backdated into feature availability and
do not prove per-event full-transaction equivalence for every program log.
The explicit `confirmed-program-events-v2` source is a separately reviewed
research contract. There were no orders, holdings, signatures or transaction
submissions. No combined multi-pool protection capacity was tested.

One ten-second bucket contained 34 trades. The old eight-getTransaction-per-ten-
seconds path cannot reconstruct that complete burst within its five-second
usefulness deadline. This is a demonstrated selection bias against busy pools,
not a poor age-cohort return. Native receipt-to-validation was at most 2 ms in
this component, with 24 total remote operations, 1,493,492 measured response
bytes, 3.66 CPU seconds and 133.75 MB peak RSS. Continuous operation and a
six-pool workload remain unverified. Existing infrastructure and transfer costs
are separate from public API access; no zero-total-cost claim follows.

The existing Render service now displays the separate observation policy and
current early/entry-age/older WATCH counts. Reporting commit
`9161d3849eae1ffa549a6afa2a1c263b6f3d1185`, deployment
`dep-dbgl96ugekts73889s40`, is live. Two actual corrected-source cycles matched
local counters, identity and timestamps exactly. Authentication, mobile rendering,
stale/stopped behavior and the unchanged original portfolio were verified.
[Reporting evidence](../evidence/migration-age-20261028/reporting/README.md).
This remains a Cloud publisher, not proof of persistent EC2 PAPER supervision.

**Readiness decision:** do not widen entry ages from these data. Preserve the
observation improvement, finish the corrected cohort scorecard, and integrate
and test the demonstrated high-volume data-path alternative before claiming
sufficient coverage for a 24-hour autonomous PAPER interval. The initial data
cannot distinguish age strategies economically: earlier/older complete flow,
actual-size post-delay entry/exit quotes and an independent prospective control
population remain insufficient. No acceptance clock has started.


## Completed cohort intervals and CPU repair

The corrected `e69ad8b` interval ended at **765.250 seconds**, rather than its
planned 900 seconds: CPU reached 240.415 seconds under the unchanged 240-second
allowance. It admitted 22 distinct tokens, assessed 17, and recorded 32 timely
predictive assessments, all failed. Five early tokens were promoted, but none
received an audited early assessment. Mapping, audit and enrichment failures
explain those unavailable observations; they are not strategy rejections.

Equivalent WATCH projection changes removed full-registry copying from hot
single-token reads. Expiry, capacity readiness, protected states and information
were preserved. Source `cf8d8bcd5b674ba6d510e92c1ae181d3cc6e5e4d` then completed
its finite interval normally in **895.320 seconds**, including the standard
shutdown reserve: 165.929 CPU seconds, 358.33 MB peak RSS, 491 physical operations,
870.66 MB broad-stream receipt, and no financial actions. Different markets and
traffic prevent causal attribution of all CPU savings. The narrower offline
lookup benchmark and actual forward resource outcome are separately preserved.

The latest run admitted **25 distinct tokens**, assessed **21**, and reached six
simultaneous scopes. It had 51 retrospectively audit-covered endpoints, but only
50 actual predictive assessments; all 50 failed. One complete audited early
assessment occurred at age **4.464 minutes** (`3B2Kz…`), with quiet buying features.
That observation is useful scope evidence, not an estimate of early-market returns.

| Migration age | Unique tokens observed in band | Raw complete feature endpoints | Timely audited assessments |
|---|---:|---:|---:|
| 0–1 minute | See source scorecard | 0 | Unavailable |
| 1–3 minutes | See source scorecard | See source scorecard | Unavailable |
| 3–5 minutes | See source scorecard | See source scorecard | 1, failed |
| 5–120 minutes | Multiple bands, separated in source | See source scorecard | Valid failures; no passes |
| 2–6 hours | Selected research only | See source scorecard | Valid failures; no passes |
| 6–24 hours | Unobserved | Unavailable | Unavailable |

This compact table does not merge overlapping windows or unique-token counts.
The full A–I matrix and exact token timelines are in
[the three-interval scorecard](../evidence/age-forward-20261028/cpu-forward-three-intervals/scorecard.json).
It strictly re-decodes original confirmed/finalized migration proofs. The
independent five-lead indexed sample remains biased and incomplete; only FRONGUS
has a retained strict migration proof in that reference, so no whole-market age
recall or profitability percentage is reported.

One otherwise usable `5jV…` window ended at 02:55:50, became audit-ready at
02:55:56.767 and had no recorded assessment before 02:56:00. Unlike the earlier
late-audit case, it was blocked locally: another token's pending enrichment
closed a shared network-work gate even though feature-only assessment needed no
RPC. Commit `ed09597` separates this CPU-only candidate-mode service from that
gate, retaining financial/protection priority, duplicate-window coalescing and
an explicit admission estimate before competing request/window deadlines.
Actual completion time is still checked; the estimate is not a zero-jitter
promise. Disposable tests show zero quote/context/execution calls and byte-exact
ledger/WAL preservation. Forward verification of that correction remains separate.

The native selected-flow adapter is committed as a reusable component with
bounded subscriptions, exact emitted-event mapping, support batching, reconnect
invalidation and an independent-audit notification ledger. It is not yet the
active integrated source. Its component result cannot be used to mark multi-pool
or unattended acceptance complete. No 24-hour test has started.
