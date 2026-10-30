# First native PAPER forward interval — actual result, not acceptance

Frozen source `6d894c1262b93d22f288e214016bfb314799e0ae`, bundle `9baf5500b40eb26bc1ae898c8dbdb8801b9798e8c03de0280bb3896556cb6553` ran 2026-10-28T19:52:47.298+00:00–2026-10-28T20:14:28.523+00:00: **1301.225s**. It ended safely flat at the candidate CPU reserve, before the30-minute target. All516 physical starts settled. The same account/inception and original observer were preserved.

## What was actually evaluated

**17 audited windows over14 unique tokens**, all17 valid predictive failures; **2530 native normalized trades**. Overlapping windows are not independent coverage minutes, and78 summed feature trades are not78 unique trades. The old PAPER reporting projection incorrectly showed0evaluations/0normalized trades. That is a reporting defect, not absence of candidate work or a missed financial permission. No candidate qualified, no order was submitted/filled, and no holding/protection evaluation/exit occurred.

## Why audits and decisions failed

-61 audit results:17 verified,41 unavailable,3 unusable.
-40 unavailable results were physical HTTPtimeouts;1 was slot-boundaryambiguity. There were no dispatch-expired results in thisinterval.
-32 genuine current-window deadline misses:28 timed-out audit targets,1 ambiguity, **3 selected targets that never opened an audit session**. The three all concern9tVNg at20:11:10/30/40. Their last trace showed a free gate,32–38 starts/min and8–9s remaining runway, followed by no history dispatch. This is a demonstrated local service failure; the exact early-return branch was not instrumented. It cannot be blamed on provider saturation or normalwarming.
-Three unusable audits found30 unknown successful signatures and1516 independently failed missing rows. The successful identities are not proven all executed swaps; metadata alone cannot adjudicate their importance. The successful evidence cannot be waived. Three other windows completed despite missing independently failed diagnostic rows, showing that the current contract already separates failed-only metadata from required executed flow.

## Batch transport is the strongest measured bottleneck

17 HTTPbatch envelopes invoked37 logical queries. Only5 envelopes/10 logical queries validated;12 timeouts made27 logical queries unavailable. Every failed batch returnedHTTP200 headers in65–110ms and22,644–46,287 partial bytes. Its last body chunk arrived107–173ms afterstart, then the body did not finish before1.5s. Successful batches completed171–209ms with45–49KB. No parsing-latency explanation is supported; connectionreuse is uninstrumented. These partial-body tails do not prove bandwidth saturation or identify server versus network delay.

All33 physicaltimeouts were HTTP:32history and1getTransaction. The12 batchtimeouts had headers/partialbodies;20 single-history and1getTransaction timeouts had noheaders/0B. Cancellation settled19–25ms afterthe timer. All279 observed HTTPheader statuses were200; no429/503 occurred. Peaks were19/10s and46/minute. Average demand does not establish provider entitlement.

## Gap accounting and containment

19 engine quality callbacks comprise12disconnect1006 callbacks in four3-scope incidents,3 historymismatches,2 unsupportedlabels,1 unsupported protocol child and1 explicit cutoff. Eighteen are adverse pre-cutoff callbacks. Four socket errors reported`WS_ERR_INVALID_CLOSE_CODE`; noWS physicaltimeout occurred. Nativeaggregate50 includes the same scope failures plus17 deliberate post-rejection retirements,12 repeated-audit-failure retirements and2 orderly segment retirements; it is not50 independent quality-losswindows. There was no global fingerprint-capacity refusal or candidate metadata-pressure refusal. Failed-packet diagnostic compaction retained the executed-flow obligations.

## Financial and resource result

Read-only auditPASS: revision9451, cash/equity9,920,142,850lamports,0reserved/locked/realized/cost/positions/pending, contiguous9452journal rows and valid actionlinks. Stored source fields matched. Net tradingP&L is0; reportedUSD+22.965131 was passiveSOLvaluation, not tradingprofit. No heldmark was independently repriced because none existed.

CPU180.252709s triggered the intendedcandidate reserve; sourceRSS387,461,120B and supervisor sourcegroup402,427,904B stayed within the existing bounded process/group controls; the observed stop was the CPU reserve, not a demonstrated RSS failure. BroadPumpApi received1,071,650,829B for590 unverified watchhints, while nativeWS received27,692,392B and supplied all2530normalized trades. No broadpayloadarchive was exported. APIfee0 does not establish free infrastructure/transfer.

## Next bounded workload

Keep maximum3deep slots and existingfinancialcapacity. Default off the unreliable public-RPC first-pagebatch path; preserve separate single-page deadlines and physical accounting. Correct/instrument selected-without-session returns and the reportingprojection. Then compare a new source-pinned interval. Do not increase to6–12 or relax deadlines based on thissample. Two-lane scheduling may be investigated separately but does not retroactively explain partial batches. A natural qualification/lifecycle and holdingprotection remain unobserved.

The reproducedJSON contains every deadline case and physical timeout plus exact inputhashes. This is allowlisted metadata, not a complete market-flow archive. Original selected evidence remains privately retained.
