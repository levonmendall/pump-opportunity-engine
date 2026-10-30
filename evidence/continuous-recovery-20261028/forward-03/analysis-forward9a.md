# Forward9a — live containment gains and remaining operating failures

**Decision: useful live repairs verified, but this six-slot configuration remains inadequate for reliable current-window qualification under the observed workload.** Candidate-only execution did not open a financial writer. No natural PAPER orders, positions, exits or financial P&L occurred.

Frozen source`9a520267f8e446a634b3e7ca773dd7471e14e7bc`, executable`395d7c9effb4a16004f511ed5647fc02c8666c5af18e5c81995884160f116812`, administration40747004112. Actual start18:38:37.830UTC, logical cutoff18:53:27.830, stop request18:53:27.946, final status/transport settlement18:53:28.562,2026-10-28. The run label184000 is not its actual start. The129 indexed files and complete15,985,029B archive were independently rehashed offline; archive SHA256`dd3e6d55d6179e0ae310882a52b49015ff7fb1e0703fb696e238467cd6b2866c`. Adjacent JSON preserves event references, source/configuration, each audit target and actual timing. Raw selected events remain private; no raw broad feed was archived.

## What the retained repairs actually accomplished

Eight actual1s HTTP support-read timeouts used the new deferred-recovery path. Healthy notification capture and original source timestamps were preserved. Six recovered with fresh validation before the original30s source expiry. Two consecutive later failures did not recover before expiry, so five scopes correctly became unavailable at source ages30.029–30.032s. This is a verified improvement over the earlier generic HTTP-timeout teardown; it is not permission to extend source freshness. Later scheduling defects may have delayed recovery, but the expiry decision itself was truthful.

The compact correction-fingerprint cache reached12,392 records,8,200 active records,27,519 compactions and zero active/fingerprint-capacity refusals. A busy candidate did hit its separate8,192-row notification bound, but it did not poison peer caches. Thirty same-filter subscription rebindings succeeded; no old ID-reuse teardown recurred. This is forward evidence of the corrected cache failure domain, not a test of every future correction or sustained memory bound.

There were48 verified ordinary-flow assessments across17 unique tokens,44 predictive failures and4 passes;25 assessments had zero trades and23 had nonzero trades. The four passes are overlapping windows of the **same EV5 token**, all entry-age eligible, with455/463/459/428 trades,214/212/215/201 distinct buyer addresses and22.97/18.03/22.09/20.57SOL curve net buying. Windows ended18:48:00/10/20/30; information was admitted18:48:03.478/11.866/23.228/33.549. These are useful independently audited predictive observations, not four unique opportunities, independent people, executable entry quotes or profits.

## The37 gap callbacks are not37 independent outages

| Cause | Callbacks | Evidence and meaning |
|---|---:|---|
|WS unsubscribe timeout|5|Operation7080, `logsUnsubscribe`, timed out18:43:40.291; five scopes gapped18:43:40.328–.331.|
|WS ping timeout|6|Operation7341, `ping`, timed out18:49:53.953; six scopes gapped18:49:53.988–.989.|
|Unsupported successful swap labels|10|Candidate-local refusal; one retained shape contains nested MultiHopJupiterBuy/MultiHopSwap/MultiHopCurveSwap, not established ordinary swap economics.|
|Five-second availability/processing bound|6|Three two-scope batches; exact conservative receipt-to-availability ages5.002–5.102s.|
|Rebound generation ambiguity|2|Candidate-local conservative refusal.|
|Unsupported protocol child shape|1|Retained BoostBuyAndBurn/Token2022 Burn child shape.|
|Local8,192-row ledger cap|1|Busy BLAyt candidate, discussed below.|
|Original source freshness expired|5|One batch of prior state reached the unchanged30s bound.|
|Logical cutoff|1|Truthful shutdown information refusal.|

The eleven shared timeout callbacks came from **two actual WS control failures, not HTTP support-refresh coupling**. Their transport closure and required fresh windows are real gaps. Whether control recovery can be narrowed further is a separate repair; successful HTTP containment does not prove WS continuity during unacknowledged controls.

The six five-second refusals violate the current contract. Their receipt timestamp is the documented conservative earliest chunk of an undrained batch, so these records cannot establish exact per-frame source latency or apportion the entire delay to network versus local queueing. Two cases exceeded the boundary by only2–5ms. That does not prove the boundary dispensable or justify backdating information. Report contract failure and timestamp uncertainty separately; any revised usefulness policy needs an explicit versioned timing argument.

## A remaining avoidable evidence-retention cost

BLAyt's first scope lasted44.965s before the8,192-row refusal, without completing a60s window. Its8,192 information records comprised**6,874 failed transactions and1,318 successful transactions**. The offending packet itself was failed. Failed transactions contributed83.9% of this scope's retained rows.

The executed-flow contract does not require a complete per-failed-packet census for predictive features. This is a concrete candidate for smaller diagnostic retention while preserving exact global failed→successful correction obligations and every required successful event. It does not permit treating all1,318 successful transactions as trades, silently dropping successful flow, or claiming the interrupted window complete. The current cache correction prevents cross-candidate poisoning but does not remove this local failed-metadata bottleneck.

## Audits and actual decision failures

67 audit results:48 verified,19 unavailable,0 unusable. The19 unavailable comprise16 physical HTTP timeouts,2 local dispatch-expired refusals and1 slot-boundary ambiguity. Zero unusable results applies to this tested set; it does not prove whole-market capture or repair any historical missing signatures.

The14 expired current-window decisions are10 timed-out audit targets,2 dispatch-expired targets,1 boundary-ambiguous target and1 target never dispatched. Twenty-three ordinary initial fence-warming windows remain separate. These are unavailable decisions rather than strategy rejections; they do not prove14 otherwise executable opportunities.

The new per-target diagnostics establish local contention that was unknown in the prior interval:

- Gwv's window ending18:46:10 waited while two peers' audit requests timed out, received required service/ceiling work, then reached the bounded latest-start boundary without an audit session. The final trace reports free physical capacity,42 starts/minute,6/10s and `outside-bounded-admission-window`. It was not a provider429 or an invented warming failure.
- Doa's18:46:20 target was selected with238ms physical-start slack. Page admission18:46:26.377 preceded component enqueue18:46:26.781 by404ms; latestStart26.615 was already166ms past. No physical request started; more than3.2s remained in the overall decision bucket.
- Gwv's18:53:10 target had306ms physical-start slack. Page admission18:53:14.442 preceded enqueue18:53:14.892 by450ms; latestStart14.748 was already144ms past. No physical request started; more than5.1s remained in the decision bucket.

Both local enqueue failures immediately followed a settled failed history request. Source inspection identifies synchronous chapter close/open and full research-baseline revalidation before component enqueue. The trace proves the404/450ms local interval but does not separately time hash, JSON, filesystem and chapter construction. Preserve the latest-start check; remove or budget demonstrated preparation costs rather than declaring provider saturation or merely widening deadlines.

Sixteen physical audit timeouts split into6 no-header/zero-byte responses and10 HTTP200 partial bodies of39,548–226,575B. Completed100-row pages:43, median213ms,p95669,max1304; completed1000-row pages:5, median1047ms,max1427, median896ms after headers. Completed-page JSON decode remained below1ms. Body acquisition against1.5s is an actual busy-page bottleneck, distinct from no-header stalls and local dispatch delay. No completed multipage case occurred in this interval; prior three-page success remains separate evidence.

## Measured operating envelope and reporting

Six ACKed scopes overlapped690.989s of890s logical admission; longest continuous six-scope span68.829s. There were27,518 information records(12,588 successful/14,930 failed),5,616 normalized ordinary trades and52 protocol effects. Peak receipt records1,358/s,3,103/10s,8,470/minute; these are packet records, not physical requests. Receipt-to-availability median1.221s,p953.516s,max4.999s for accepted information. Refused records are reported separately above.

595 physical starts settled595 times, peak65/minute and20/10s. Of330 recorded HTTP operations,304 had HTTP200 headers and26 had none; no429/503 was observed. There were49 physical timeouts total:38 history,8 support,1 transaction and2 WS controls. Not every history call was a candidate audit. The90/min setting remains a research ceiling, not verified provider entitlement.

New conservative RPC/related accounting170,187,537B; actual cumulative projection7,464units,811,609,562 accounted bytes and389,808,128 uncertain bytes, pending the lead's append-only linkage. Native WS61,217,403B and broad PumpApi1,078,983,250B are separate transport counts. API fees, existing infrastructure and uncertain transfer/storage costs must remain separate.

Source CPU208.53s over890.732s; supervisor peak368,422,912B(351.36MiB), versus374.74MiB previously. Event-loop maximum1.242s. Twelve selected segments retained96,746,486B. Different market traffic prevents attributing every resource difference to the repairs or extrapolating uninterrupted day-long capacity.

Publisher recorded59 acknowledgements/58 source timestamps, maximum acknowledgement gap15.387s; final stopped sourceAt1793213608562 was accepted. Corrected public polling confirms exact identity/counters/source times for the final stopped source across separate polls. **It cannot verify two distinct archived running source cycles:** its start follows all four retained running snapshots. Earlier Cloud proxy failures are not Render receiver outages. Preserve that evidence limit rather than reconstructing unretained source states or claiming stronger parity.

The smallest justified next work is the demonstrated scheduler/domain/preparation correction and failed-diagnostic retention improvement, followed by a pinned forward segment. Candidate completeness, financial readiness and owner-visible reporting remain separate gates. No24-hour acceptance interval has begun.
