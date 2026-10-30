# First corrected forward interval — retained trace analysis

**Decision: useful data-path gain; inadequate for reliable continuous six-slot qualification or PAPER acceptance.** This is actual candidate-only forward evidence, not simulated rescheduling, financial execution, or profitability.

The immutable runtime was `90625f53b686578637accf73ebc457f841743ee2`, bundle `be2a5fc3132c7a2bfefe04ec7717d61e0d7030c6c462ccebca2e384d5558915a`, configuration `5a55cc6635b814cb4b76d5b9636d2eecca1439ebd534ed1c84ed587c03aa377b`. GitHub run40726448588 ran from **2026-10-28 16:29:30.001 UTC**, with logical cutoff **16:44:20.001**, stop request **16:44:20.003**, final status **16:44:20.294**. The remaining ten seconds were reserved for shutdown. Physical/application transports settled. Readback verified all81 selected files and the entire9,625,590-byte archive against SHA256 `4338b7996d42fc16470bcfe0052152e804d5c1a8c7eb8ba29b775cd21da6c473`. Private raw data remains outside Git; adjacent JSON identifies event-file hashes and exact targets. No accounting/state mutations or market requests were made by this analysis.

## What improved and what failed

- **HTTP cooldown containment was observed working.** There were no native teardowns caused by HTTP cooldown. All12 timed-out audit requests ended without HTTP headers/body; capture continued through those HTTP failures.
- **Replacement admission yielded to ready audits:**14 explicit `existing-ready-audit-batch-before-replacement-setup` deferrals. The seven remaining undispatched target windows were not displaced by discretionary replacement setup in their critical ready batches.
- **41 audited assessments across19 tokens**, comprising26 zero-trade and15 nonzero-trade windows.38 predictive failures and3 `not-rejected` assessments. Overlapping windows are not independent minutes of coverage; this does not measure recall against a whole-market denominator.
- **3,005 normalized ordinary trades**,8,840 validated packet records (5,956 successful/2,884 failed). Peak1,611 validated packet receipts in10seconds, not1,611 RPC enrichments. No per-transaction enrichment was used by the native path.
- Six ACKed scopes overlapped for693.449seconds of the890-second logical interval. The run therefore challenged concurrent capture; it did not demonstrate six simultaneously busy pools or any held-position workload.

The three predictive passes were two windows on `6EKmRQ…pump` at16:31:05.013 and16:40:55.737 (entry-age eligible), and one on `4Ytm5F…dar5` at16:32:14.879 (**pre-entry age**, protocol-aware ordinary-flow shadow). The first two contained378/402 trades,92/145 buyer wallets, +9.25/+24.49 SOL net buying, five positive buckets. The latter contained62 trades,26 buyers and +13.75 SOL net buying; it was not baseline entry-eligible. These are feature predicates only: no current executable quote, risk permission, financial qualification or filled order was established.

## The48 quality-gap callbacks

**Six callbacks occurred at/after the deliberate cutoff**: one information-admission cutoff and five transport-close scopes. They are truthful shutdown gaps, not evidence of a pre-cutoff outage.

The other42 comprise:

| Cause | Callbacks | Interpretation |
|---|---:|---|
| Four `NATIVE_FLOW_SUBSCRIPTION_ID_REUSED` refusals |24| Avoidable shared interruptions when a re-promoted same-pool subscription returned an ID retained in the retired-ID cache. Each incident affected six scopes. |
| One actual `logsSubscribe` physical timeout |6| Real control operation failure; not an HTTP-cooldown cascade. |
| Candidate-local refusal/correction/audit failures |12| One processing deadline, one receipt deadline, three unsupported swap labels, one unsupported protocol child shape, four audit completeness failures, two confirmed corrections. These must remain distinct; unknown successful event semantics cannot simply be excused. |

The first ID-reuse case is unusually clear: `vvJXEV…pump`, pool`35SedZ…LXF`, was ACKed onconnection1 at16:29:34.739 with ID101877376, retired after an audited rejection at16:30:53.374, and unsubscribe retirement completed16:30:53.999. On re-promotion at16:32:16.465 the provider returned ID101877376; active-match wasfalse, retired-matchtrue, supportfresh, notcancelled, notclosing. The local refusal closed the healthy shared connection at16:32:16.496. The same pool received the same ID after later fresh connections, so “an ID was previously used” alone is not proof of conflicting ownership. A correction must still fence old queued packets, candidate generation and actual ACK availability; merely deleting the reuse check would not prove safety.

## The13 unavailable audits and16 missed decisions

**13 unavailable audits =12 first-page physical timeouts +1 strict slot-boundary ambiguity.** The12 timeouts were concentrated in four candidates (`9tVNgp`, `BtM6yv`, `7KbSWy`, `az55LN`), three each. Every one timed out **before any headers or response bytes**. JSON processing and large downloaded response bodies did not cause those12 failures. Absence of headers cannot distinguish server queue/query latency, network delay, DNS/TLS/connection acquisition; connection reuse was not instrumented.

The45 completed pages were all first pages:

| Requested rows | Pages | Response bytes | Median elapsed | p95 elapsed | Maximum elapsed |
|---|---:|---:|---:|---:|---:|
|100|38|876,433|133.6ms|746.5ms|1,010.1ms|
|1000|7|1,644,622|1,170.5ms|1,366.0ms|1,366.0ms|

For1000-row pages, median time after headers to body completion was858ms; maximum JSON decoding was1.23ms. Small pages materially reduced transfer for sparse windows without changing completeness. This interval did not require multiple completed pages and did not test the old6955-signature busy target; the four-page structural limitation remains outside this sample. Failed first-page request limits were not logged explicitly, so they are not attributed to either size group from successful samples.

**16 missed current-window decisions =8 audit timeouts +1 boundary ambiguity +7 no-dispatch targets.** Normal initial lower-fence warming (36windows) is separately counted. Four failed third attempts retired before the following expiry census, explaining why twelve timeout results are not twelve deadline-miss counters. These are real unavailable decisions within the original next-bucket deadline, not evidence that the strategy would have passed or that an executable opportunity was lost.

The seven undispatched targets occurred in three batches: four ending16:30:40, two ending16:33:30 and one ending16:43:00. Trace examples show a timeout, mandatory physical settlement, local two-second HTTP cooldown, heartbeat, successful peer audits and immediate unsubscribe operations consuming the remaining bucket. The conservative two-second physical-operation admission guard then prohibited starting another audit. Replacement setup was already withheld. The remaining bottleneck is therefore timeout/failure-domain handling and control/retirement overhead plus finite deadline capacity, not the previously demonstrated replacement-priority defect alone.

All250 received HTTP headers were200;18 operations in total ended before headers (12 audits plus other work). There were **no observed429/503 responses**. The measured pattern does not establish global provider saturation or justify increasing request rates. A repeatable address-query stall while other pools respond quickly deserves query-local handling; actual throttle/Retry-After and unsettled physical operations must still block as required.

## Four unusable audits: genuinely unknown data versus a stale snapshot

Together they reported nine missing successful and two missing failed history rows.

- **6EK target ending16:39:00:** three successful packets and one failed packet were actually validated16:39:03.717–16:39:04.042, after the audit snapshot at16:39:03.157 but before audit completion16:39:04.179. These are available post-snapshot corroboration, not missing flow. A generation-bound diagnostic-tail refresh can repair this audit without adding late trades to the earlier target feature window.
- **6EK16:33:30, AdTk16:34:50, 5Jap16:37:50:** six successful and one failed history rows have no matching retained information record in the whole interval. They are **unknown successful pool-address activity**, not yet proof that six executed swaps were lost. They cannot be waived or invented. Six bounded historical transaction lookups would distinguish executed supported swaps from inert/other account-touching activity. Later retrieval would be diagnostic evidence, never a retroactively available earlier decision.

Thus the proposed tail repair addresses one of these four results, not all four. Independently confirmed failed-only missing rows can be diagnostic rather than mandatory executed-flow evidence; however **no verified window in this run depended on that exception**, and successful unknown rows remain blocking.

## Resource/accounting and the next correction

508 physical starts settled508 times. Observed peak58/minute and20/10seconds; the90/minute setting was only a local research ceiling.156 `getMultipleAccounts`,89 `logsSubscribe`,88 pings,79 history queries,54 unsubscriptions,33 migration`getTransaction`,8 upgrades and1 discovery subscription were counted. New response accounting81,184,569bytes comprises32,556,857measured and48,627,712uncertain; no uncertain reservation was refunded. Broad PumpApi receipt974,999,851bytes, native selected socket23,621,867bytes, discovery2,096bytes are separate transport measurements; broad traffic was filtered locally rather than archived. Zero API purchase is not zero infrastructure/transfer cost.

Maximum RSS330.62MiB under384MiB, CPU178.77seconds over890seconds, event-loop maximum711.46ms. The derived RPC status projection was synchronously persisted14,569times, costing98.63seconds. Authoritative component accounting was separately durable. Coalescing that redundant projection is justified; it must not coalesce financial writes, consumed-byte charges or physical-settlement records.

The narrow next repairs are safe subscription-ID reuse/generation fencing, query-timeout isolation and ready-audit retirement scheduling, real post-snapshot corroboration, and derived-status write coalescing. Unsupported successful event shapes and genuine unknown successful history rows remain unusable until their meanings are established. None of these results establishes held-position protection, PAPER fills/exits, financial recovery, profitability or unattended acceptance. The financial ledger remained unopened and original portfolio untouched by this candidate-only interval.
