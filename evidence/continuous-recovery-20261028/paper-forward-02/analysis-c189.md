# c189 forward PAPER interval — observed result, not acceptance

Frozen source `c189a54b7978692ef2f7d098d6b3374aea8deb72`, main bundle `02d455d81e672bddb08958fc822520aefaaa6241e78b8b9b32ee57146895556c`, run `native-paper-20261028210805129`, **2026-10-28 21:08:05.129–21:31:39.379 UTC: 1,414.250s**. The intended 1,800s was not reached. The candidate CPU reserve stopped the flat account safely at **180.271528 CPU seconds**. No operational or 24-hour acceptance follows.

The independently verified readback is 1,033,668 bytes, SHA256 `8bfcd46f0f7c71171a3f56dd0c13d84876667936bb1396c519872bb0f532db98`, 15 indexed files with matching hashes. This is allowlisted metadata and projections, not complete provider-payload replay. Raw source evidence remains on the host.

## Candidate result

- **38 independently audited predictive assessments, 20 unique tokens**, all 38 failed the frozen buying rule. Twenty-eight assessments were entry-age eligible; ten were older observation-study assessments. Those are assessment counts, not disjoint token populations.
- **771 native normalized trades**, 53 promotions across 30 unique tokens, 47 re-promotions. Three ACKed scopes coexisted for 1,353.755s, about95.7% of this interval. The population is selected by POE, not an independent whole-market denominator.
- The union of valid observation intervals within each token is2,280 token-seconds. In this sample the repeated windows for a token did not overlap. Concurrent token-seconds are not additional elapsed market time or whole-market recall.
- Sixty completed audit results: **38 verified, 20 unavailable, 2 unusable**. All38 successful audits completed in one page. Two second-page attempts occurred but failed; successful live multipage completion remains unproven.
- The largest verified window contained303 trades and110 buyer wallets, fetched through one1000-row page. It correctly rejected with net buying−1.074798612SOL, one positive-net bucket, and−205bps price return. Activity alone did not qualify it.
- Sixty-three fence-warming views were explicitly unavailable initial context; they were not counted as valid assessments or deadline failures.

The public financial funnel's zero primary trading evaluations is separate from38 independent predictive failures. Weak candidates retire after the independent assessment, before expensive financial preparation. No natural predictive pass existed to demonstrate entry preparation or fill.

## The14 deadline records are part of20 unavailable targets

The complete per-target join is in `evidence/deadline-miss-join-c189-20261028/cases.json` and its reproducible analyzer.

**All14 expired-window records match14 of the20 physical-HTTP-failed audit targets.** Six other targets were immediately retired after their third consecutive failed audit, before another expired-window event could be emitted. Adding14 to20 would double-count loss. There were **zero selected-without-session misses**, unlike the three observed in the first6d run.

Eighteen failed targets were first pages with zero captured notification rows: six pools each failed three successive queries. Zero captured rows is not proof those pools were genuinely inactive, because their independent histories were unavailable. The remaining two were active second pages, with87/84 and80/78 captured/required rows.

The failed requests were admitted promptly: enqueue-to-physical-start median7ms, max9ms. First readiness to first physical page was median1,836ms, max2,445ms, including upper-ceiling preparation. Audit failure was known with6,012–6,664ms of the original10-second decision runway remaining. These particular failures demonstrate unavailable responses, **not queue starvation or work that ran until the decision cutoff**. The expired classification truthfully means no valid decision by cutoff, but does not establish a scheduling root cause.

## HTTP failure pattern

All23 physical timeouts were HTTP and received **no headers and zero body bytes**:22`getSignaturesForAddress` and one`getTransaction`. Twenty history timeouts belonged to the candidate audits; two to other history work. No batch request, WS physical timeout,429 or503 was observed.

Timeout-callback lateness was at most1.231ms; cancellation settlement followed23–25ms later. Multi-second main-thread timer starvation does not explain these particular1.5s timeouts. The321 HTTP operations included298 successful complete responses, successful elapsed median102.1ms/p95577.7ms/max743.5ms. Completed JSON decode max1.291ms does not explain headerless timeouts.

Every timeout followed a successfully completed HTTP request. Audit failures commonly started127–638ms after the prior HTTP completion, often directly after a valid current-account read. One failed getTransaction followed10.674s of HTTP idle but a recent WS ping. This is not solely a long-idle pattern. HTTP connection reuse remains uninstrumented; provider computation, connection/dispatcher behavior and network delay are not distinguished. Average rates do not prove provider saturation or entitlement.

Physical usage: **560 starts and560 settlements**, peaks40/minute and20/10s. Methods:213`getMultipleAccounts`,77`getSignaturesForAddress`,31`getTransaction`,53log subscriptions,47unsubscriptions,134pings, four upgrades, one migration subscription. Native ordinary-trade validation used zero per-transaction getTransaction enrichment; getTransaction was still needed for origin/support workflows.

The next targeted measurement is a small same-host, same-endpoint transport diagnostic using two repeatedly failed first-page pools and a successfully audited quiet control, retaining the original parameters/context floors and a separately labeled3s diagnostic timeout. It must not silently change the1.5s operating timeout or trading deadlines. A coherent local scheduler correction cannot itself make a missing HTTP response arrive.

## Evidence loss and necessity

Seven engine quality callbacks comprise one shared1006disconnect affecting three scopes, two history-signature mismatches, one unsupported protocol-child shape and one explicit shutdown information cutoff. The native aggregate53 includes all53 logical retirements, including38 valid weak-candidate rotations and six repeated-audit retirements; it is not53 adverse independent losses. No fingerprint or candidate-metadata pressure refusal occurred.

The two unusable audits each found one independently confirmed successful signature absent from captured evidence. Neither signature is proven here to be an ordinary executed swap or safely irrelevant. One has provider blockTime equal to the target end and a slot inside the conservative bank-context range; this merits bounded adjudication rather than an assertion of an avoidably strict rule. Receipt time, chain blockTime and bank Clock remain distinct. Missing successful activity cannot be waived from this metadata alone.

Conversely, **seven verified windows already tolerated162 independently failed missing packets** under the executed-flow contract. Full failed-notification census is not required for a verified executed-flow decision in those cases. The current contract successfully distinguishes diagnostic failed packets from mandatory executed evidence; there is no basis to reclassify all completeness failures as excessive strictness.

The protocol-child gap for25XY occurred21:16:06.361. It returned to a fresh valid assessment21:21:32.273,325.912s later, and later supplied the303-trade window. This demonstrates recoverability rather than permanent exclusion, but the recovery delay and competing watch backlog remain real lost observation time. It does not establish a missed profitable trade.

## Accounting, reporting and resource result

The same account/inception is preserved. Read-only ledger audit: revision**10014**, actions10014/journal10015, cash/equity9,920,142,850lamports, zero reserved capital, locked deposits, positions, pending actions, realized P&L and execution costs. SQLite integrity, journal continuity, action links and all comparable source fields pass. Database5,410,816B remained unchanged during audit. There was no reseed.

No qualification, order, attempt, fill, position or exit occurred. Trading P&L is**0SOL**. USD+13.689798 was passive SOL valuation, not token-selection profit. Natural held-position pricing/protection and the live entry-to-exit lifecycle remain untested here.

Corrected status now contains non-null experimental portfolio/accounting,771normalized-trade count,38 independent predictive failures and their decision trace. The independent publisher accepted94distinct source snapshots with zero unmatched acknowledgments and accepted the finalSTOPPED state. The parent verifies exact retained source/public payload parity and mobile presentation separately. This does not erase the documented Cloud sampler interruptions. The original observer identity/PID/restart count was unchanged by the supervisor's before/after check.

Source RSS374,575,104B; maximum supervised source-group RSS374,710,272B. Event accounting27,661,844B; actual raw event files25,750,922B. Source reporting max115.47ms with zero projection overruns. These are measured intervals, not whole-runtime CPU attribution. The last256 native handlers had p954.376ms/max7.659ms and sampled queue age max382ms; they are not all-run maxima.

Broad WATCH received1,071,653,034B and reached its existing byte guard before the native source ended;517unverified watch hints were produced. Native WS received7,084,002B and continued. Do not call broad-watch coverage continuous. API fees were zero; existing compute, storage and transfer allocation/cost remains unverified.

New RPC/accounted response demand62,844,999B; cumulative8,542units and979,334,227accounted response bytes. Cumulative uncertain reservations507,248,640B include another48,234,496B for23failed2MiB reservations; none was refunded. The280bounded public USD calls are recorded separately.

## Decision

**Useful bounded data-path/reporting milestone; not reliable autonomous operation.** The historical selected-without-session failure did not recur, optional batch amplification is absent, and real audited observations/reporting improved. The comparison is not matched demand: the earlier6d run had2,530native trades versus771here. More audited windows is not proof of superior busy-market capacity.

Retain the complete deadline-path map and validate the pending coherent contention changes together, including future first windows, financial priority, peer preparation, controls, persistence and actual cancellation settlement. Separately resolve the measured headerless response pattern through bounded transport evidence. Do not claim that one queue-priority patch fixes these current HTTP failures, or advance to six/24-hour acceptance from this result alone. Unknown successful signatures, successful live multipage completion, natural qualification/execution, held protection, persistent operation and independent opportunity recall remain specific evidence gaps.

Reproduce without network or financial writes:

```bash
python3 evidence/continuous-recovery-20261028/paper-forward-02/analysis-c189.py
python3 evidence/deadline-miss-join-c189-20261028/analyze.py
```
