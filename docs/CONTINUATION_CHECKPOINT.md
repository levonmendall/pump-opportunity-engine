# Recorder repair continuation — 2026-10-27

Source8c2a639 was published to the existing review branch and ran stage two on
the SAME pilot account. Actual run `pilot-20261027195343952-418513ae` reached
about157seconds, two concurrent quiet candidates,15usable windows and13predictive
rejections, zero selected trades/orders/positions, then failed with
PILOT_FEED_EVIDENCE_CAP. Original raw events/source remain immutable. Forty new
RPC units,710cumulative; all RPC physical operations settled and the book closed.
The final status projection failed too because snapshot reads emitted more
feature records. An explicit incomplete-run receipt preserves the last known
facts without manufacturing a final performance snapshot.

Root repair: independent feature-emission cursor, bounded latest100 history,
read-only snapshot projection, explicit feed-watch feature ticks and a candidate
recording reserve that closes new admissions while preserving holding management.
No strategy, quote age, fees or risk thresholds changed. Forty-six focused tests
pass and a full frozen suite is running. Commit only after final review; then
resume the same account under a new labeled source interval. Do not reset history
or claim the failed interval was a forward pass.

The Cloud environment recovered after the earlier interruption. Original EC2
observer/account and Render portfolio remain untouched. The independent pilot
reporting publisher is running in this Cloud environment; stale old source facts
must not be treated as ongoing trading. No owner action is required for the
current isolated repairs.

## Earlier checkpoint history

# Progressive pilot continuation — 2026-10-27

Current isolated integration lives in `/workspace/poe-stage-review`, based on
87708b4. Root is finalizing the progressive change set for the existing
`poe-free-data-evaluation-20261027` branch. The Cloud environment disconnected
and recovered; prior failed/interrupted checks remain historical. No production
or account reset occurred. The pilot remains the original experimental account
poe-pilot-8468add6-f916-48cf-a585-6cd008a81360, inception17:56:13.252Z.

Progressive disposable mechanics now pass single lifecycle/restart/recovery,
two shadow candidates while holding, three positions and three overlapping exits,
exact gas/rent and persistent daily-loss pause. Original liquidity refusal is
preserved before the declared synthetic-liquidity concurrency fixture. No natural
multi-position claim follows. Timing correction records actual completed exit
evaluations, original source expiry, first-position origin and open outage tails;
candidate retirement no longer waits for delayed transport close. Source/financial
review and full regressions are running before a frozen forward interval.

Next: finish source review/full checks, commit on the existing review branch,
resume the SAME pilot account in a bounded concurrent stage, capture honest
coverage/entry-eligible/rejection/unfilled/timing/usage results. Do not mutate
pinned source during the run. No owner approval is needed for these isolated
PAPER stages. Original EC2 observer/account and Render portfolio remain untouched.
Dashboard diagnostics use their existing separate reporting-only publisher.

## Earlier checkpoint history (retained)

# POE continuation checkpoint — standing research, 2026-10-27

Branch `poe-free-data-evaluation-20261027`, base `5a0fa96`. Standing owner authorization supersedes the old one-capture, lifetime-request and no-reservation-release restrictions. It authorizes bounded read-only research using PumpApi, public Solana RPC and free PumpPortal discovery. Alchemy/Helius/paid feeds remain excluded. No production change, account reset, deployment, entries, signing or spending.

Production EC2/account/inception/Render preserved. Public read-only reporting checked around16:13UTC: sequence1948, original account/inception, installed releasebce3d22, entriesdisabled, reconciled=true,0publishedpositions/trades, source48.609s old at response. This is reporting evidence, not direct EC2/systemd or database verification. See `evidence/standing-research-20261027/production-read-only-check.json`.

## Completed this continuation

- Explicit wall/monotonic logical cutoff at request and validated-information admission. Record stop request, actual socket settlement and all drain bytes separately. Original75.002s result unchanged.
- Proposed completion-deadline scheduler, target2s, quoteage≤2s, sourceage≤30s, enrichment≤5s; proposed4s maxgap is UNAPPROVED research behavior. Prior financial actions/holdings retain priority; impossible candidate windows are invalidated, not silently sampled.
- Offline retained-trace + stress comparison: at both1s/250ms spacing,15/16 workloads meet proposed protection timing; complete required flow9/16→12/16 at250ms. Slow/overrun/outage limitations remain explicit. Same60/min,10/10s,onephysicaloperation for250ms cases. Not endpoint/EC2 capacity proof.
- Matched actual5-event replay honestly rejects missing verified migration and failed buying features. Separate disposable same-byte-SDK execution/held mark/restart/quarantined exit/recovery/final exit reconciles; no natural trade claimed.
- Append-only unused-byte reconciliation releases143,286,477 local reserved bytes; consumed271,949,619 and oldRPC2,097,152 uncertainty retained. Original396MiB/320s gross books unchanged; no time release inferred.
- Legacy budgets retain original defaults. Explicit standing experiment budgets remove only lifetime caps and retain cumulative actuals, refusals and uncertainty. Official publicRPC terms rechecked; limits non-guaranteed and public endpoint not intended for production.

## In progress / next command

Root is reviewing `scripts/standing-research.ts` before one specifically informative corrected combined research measurement. Do not invoke concurrently. Root alone owns network and usage writes. External process controls required; runner refuses absent bounds. Proposed250ms spacing keeps60/min,10/10s,oneflight,100units/120s,32MiB related bytes,140MiB streamreservation/75s observation,6MiB new evidence within32MiB total. Strict cutoff/proposed scheduler; no provider/strategy/screen change. Preflight must pass current support/activity; no second capture automatically.

All old raw evidence immutable. Current linked baseline221requestunits,2,314,558 measured related bytes+2,097,152oldunknown=4,411,710 accounted. These are cumulative visibility, not current lifetime prohibitions. Any newrun must append its own linked book. New evidence17,832,952bytes before next run.

Focused tests pass; initial full suite568pass; rerun final relevant tests/build after all final edits. Source ownership: root dispatch/field/pricer/transport; component_review budget+baseline frozen; component_preflight simulator+tests/artifact frozen; component_parity E2E+cutofftests; component_budget standing runner (finishing). Preserve unrelated `docs/FUNDING.md`, `operator/funding/` and existing empty lockfiles. Do not merge/deploy or infer production health beyond source check.


### Checkpoint after first new live capture and correction

Source3297490 completed01-paced-combined:47units,97,702,483streambytes,38freshthree-holdingchecks/maxgap2085ms. ThreeSells mapped; fourthshortBuy hit a new24-byteinstructionlayoutdefect. Candidatewindowinvalidated; holdingscontinued; no429. Allold/sourcehashesmatch. Strictlogicalcutoff75s;stoprequest+1ms/socketsettlement+3ms;nonewinfoaftercutoff. Originalfailureimmutable.

Fixpinned79d0146: exactrecognized24-bytebuy_exact_quote_in only, no inventedtrack_volume; mapper,selector,audit sharedecoder. Newconfirmed/finalizedpair02-failed-buy-audit succeeds, originalwindowstillfailed. Currentbaseline must append01rpcbook THEN02rpcbook:270units,3,013,315measuredrelated+2,097,152unknown=5,110,467accounted; PumpApiactual369,652,102. reservation-reconciliation-01 releases49,098,157unusedbyteswithouteditingoldbooks.

Root is running final frozen fullsuite, then one specifically justified corrected combined rerun (new output03-corrected-combined, previous01 and02 in order). No blind retry or favorable-sample loop. Never mutate oldraw files or publishresearchdata. Existingnonroot processcaps/strictphase/observationguards unchanged. Noowneractionrequired.

## Integrated pilot build in progress — 2026-10-27, ~18:00UTC

Latest owner directive authorizes isolated live-market PAPER entries, without changing production. Review branch remains `poe-free-data-evaluation-20261027`; production/account/Render untouched. Root is wiring `src/pilot.ts` and `operator/pilot.sh`; agents own `pilot-discovery.ts`, final feed/RPC fault isolation, and the disposable full integration test. No pilot initialized or launched yet. Existing source modules preserve the current primary rule; opt-in requires a distinct `poe-pilot-*` identity and frozen contract hash. Start checks and an actual bounded forward run are next, then same-account resume and an honest scorecard. Do not report the build as already running.

Most recent actual research is `evidence/standing-research-20261027/08-current-combined`:11/11Buys independently confirmed;39coherent three-holding evaluations,max2046msgap; no threshold crossings. First finality audit returned429 and stopped. Original audit remains incomplete;68newunits,348cumulative; measured related bytes4,004,168 plus4MiBretained uncertainty. New stream68,057,169bytes, cumulative437,709,271actual bytes. `09-finality-recovery` driver is prepared but has not run. Old lifetime ceilings are historical; new finite pilot budgets preserve cumulative accounting. Preserve unrelated `docs/FUNDING.md`, `operator/funding/`, old `.lock` files, and all raw receipts.

## Repair checkpoint — 2026-10-27 18:25UTC

The isolated pilot now exists and has completed four labeled live intervals on the SAME account `poe-pilot-8468add6-f916-48cf-a585-6cd008a81360`, inception `2026-10-27T17:56:13.252Z`. All are stopped, transports settled, no natural trades/positions/pending actions, no reseeding. Current committed HEAD98ebbb9; further repairs below are uncommitted, build/focused checks running. Original EC2 account/observer/Render remain untouched.

Fourth interval `pilot-20261027180538359-2e0d1205` ran724.484s from18:05:38UTC:322.824s age-eligible active-flow collection;19bounded-audit-covered closed60s windows,290s union (not19×60s);93.625s literal control-enabled time;18predictive rejections,0qualified/reserved/unfilledorders,0fills. Five normalized real events.85newphysical units,390,173,631PumpApibytes.503invalidatedonecandidate; preparation/backoff defect lostanother;14hints/1.28s burst exceeded local10/10cap afterprep8starts; chapterexpiry caused a spurious discovery reconnect. All failures retained. SOL trading P&L0; USD−$1.785625 entirelypassiveSOL effect; economicP&Lunknown. Final backupgeneration10/revision1242 agrees with result. Sanitized scorecard/index in `evidence/pilot-20261027/`.

Narrow repairs now prepared: guardflowreference≤128(root earlier182char wiringbug is fixed); readyverifiedorigins get service despite continuousdiscovery; fresh postdelayexecution contextreconciles beforequote (no2sageweakening); sourcehashwatch/endstop/accountcrashmarkers; passivecontrolbytes no longer disconnect at5minchapterexpiry; bounded503bodyread accounts actualbytes while incomplete/429 uncertainty remains; candidateprep waits feedbackoff; opening waits15burstslots(14enrich+upgrade) and20minute slots. Publicdocsretrievedshow100all/40singlemethod per10s but explicitly notguaranteed. Next research config20/10,60/min,250ms,oneflight; defaultadapter10unchanged. Real-gate timing replay14hints fits60–250ms responses after8.482s prepdrain, fails500–1000ms; notproviderproof.

Next: finish focused checks, commit repairs, resume samepilotledger for new frozenv1 interval and measure chapter/reconnect/burst behavior. No owner grant needed. Agents parity/review are preparing stage2/3 concurrentcontract/feeds patches under `/tmp` ONLY; these are not applied to active source. They must not change source during a live interval. Root still must integrate shared deadline dispatch/per-candidate gaps before live concurrency; initialoneposition cap is temporary, not an architecture limit. Existingoffline3holding/1candidate stress fixture retains processing/cancellation failures and stale-reconciliation overlap refusal.
