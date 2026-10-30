# Attribution of the 36 / 9 / 12 snapshot

The measured failures are primarily **operational containment and scheduling failures**, not evidence that executed-flow completeness should be relaxed. This is attribution of source `640143a5924a7ff7d98039967c2db17957f71f24`, run `40714364745`, through **2026-10-28 15:24:48.374 UTC**. Later counters are excluded. No strategy, runtime executable, financial state or historical counter was changed for this analysis.

| Question | Verified answer |
| --- | --- |
| 36 quality gaps: missing information or excessive completeness? | Six shared interruptions each fan out to six candidates, across 17 unique mints. Two subscription-control timeouts produce 12 callbacks; four HTTP cooldown refusals produce 24. The latter unnecessarily close the notification transport. These become real observation gaps because the code disconnects; they are not 36 independently proved missing trades. Three callbacks concern subscriptions not yet opened. |
| Nine unavailable audits: scheduling, data or processing? | All nine first-page requests exceed the configured 1,500 ms physical timeout. Four have HTTP 200 plus partial bodies; five have no headers before timeout. No validated page is available. No missing-signature comparison or page-limit failure caused these nine. Remote execution, transfer and local processing contributions are not fully separable. |
| Twelve deadline misses: failure or classification? | Six targets have their own timed-out audit; six receive no audit dispatch. Seven unique tokens, four target-close timestamps. These are real unserved assessments under the frozen ten-second contract; no incorrect expiry is demonstrated. Normal lower-fence warming is separately excluded in the actual trace. Counters overlap: six unavailable audits also expire. |
| Is everything collected needed for trading? | No. Complete relevant executed flow and valid executable pricing are necessary; an exhaustive packet census and oversized history retrieval are different requirements. See below. |

## Necessary information and avoidable work

The frozen buying assessment needs the complete six closed ten-second buckets, executed ordinary buy/sell amounts and direction, genuine trader roles, stable event identities, commitment, corrections and real information-availability times. Prices cannot replace buying persistence, wallet participation or concentration. Executable entry additionally needs validated actual-size pricing, current pool/mint/vault/fee inputs, costs and financial permission. This run does not establish entry feasibility or financial execution. Holding stop/profit/time rules use actual-size net liquidation value and own financial state, not every other trader's transaction.

Not every diagnostic packet or history row is a predictive input:

- The six verified audits each fetched 1,000 history rows: **6,000 rows for 109 strict-interior rows and 108 captured target signatures**. Four verified targets had zero captured signatures. Some outside-window history establishes the lower boundary, so the entire excess cannot be credited as removable. This nevertheless justifies testing bounded smaller/adaptive pages without removing the complete-range proof or raising request limits.
- Requiring the notification for an independently confirmed **failed** transaction cannot improve executed-buying features. The current auditor does require it. A separate semantic distinction is justified for investigation, preserving failed-status/reversal diagnostics; **it caused none of these 36/9 failures**. Missing successful transactions remain blocking until their executed role and availability are established.
- History may extend beyond the target availability interval. An immutable audit-start notification snapshot can disagree with a later received successful notification. That is not automatically silent loss; neither may the later trade be backdated. No such mismatch occurs in this target prefix.
- Raw representatives and timing diagnostics establish correctness and explain failures; they are not all needed at full depth indefinitely. Discarding fields after delivery does not save incoming stream traffic or completed requests.
- Safe abstention can require less information than a justified entry. An unavailable window can defensibly block entry, but cannot be counted as a verified predictive rejection or successful market coverage.

## Demonstrated repairs to prioritize

1. **Contain HTTP cooldowns.** Defer HTTP refresh/audit work during cooldown while retaining an otherwise valid native subscription. Preserve support-expiry checks, genuine disconnection gaps, physical-settlement accounting and blocked qualification for unavailable audits. A local admission refusal should not itself destroy every candidate's capture.
2. **Service already-ready audits before replacement setup.** After a valid rejection the current runner immediately refills its slot. Unsubscribe, support reads, subscribe and heartbeat compete ahead of remaining warm candidates. The actual 15:24:20 bucket contains two such replacement sequences while three ready targets receive no audit. Delay discretionary replacement setup; do not remove support validation or hide the resulting wait.
3. **Reduce unnecessary history transfer with complete range proof.** Investigate the existing 100-row option and conservative escalation for busier pools. Smaller pages can increase physical starts: the observed 103-interior-row target needs at least two 100-row pages instead of one 1,000-row page. Longer timeouts alone consume more shared-gate occupancy and do not prove six concurrent targets can meet their deadlines.

The target used 174 physical starts, averaging 22.87/minute, with a rolling-minute peak of 42 and rolling-ten-second peak of 20. Thus average demand below the 90/minute research ceiling does not establish feasible short-deadline service. All 75 observed HTTP headers are 200; no 429/503 is recorded in this prefix. Provider saturation is **not established**. Timer callback lateness and partial bodies demonstrate mixed end-to-end effects, not a clean provider-versus-CPU diagnosis.

Six audited **shadow** feature assessments across five unique tokens all failed the frozen buying rule. Zero qualified candidates, financial submissions, positions or financial results are established. The restored watch counter `completeWindows:430` is historical/cumulative and is not 430 verified windows in this run. The native audit counter is six.

## Evidence and operating-state limitation

- [Machine-readable attribution](analysis-summary.json)
- [Quality-gap episodes and source references](actual-quality-gap-review.md)
- [Every audit timeout and expired target](deadline-audit-actual-review.md)
- [Decision-information contract review](information-requirements-review.md)
- [Hash-verified diagnostic prefix](source640-diagnostic-prefix.json), SHA-256 `d32fbfb11227bff92d67a5a232049b006aff12cc947e70c10c3818aaeda4c38e`
- [Readback receipt](diagnostic-readback-receipt.json) from existing nonroot administration workflow `40718943091`, helper/admin commit `5a0bae18845419cf78eafa23eace943165a54427`.

The administration-job cancellation did **not** settle its bounded research children. At **15:44:12.601 UTC**, a direct nonroot read verified current source status `running:true` and four matching research processes; there was no completed full archive. Its existing finite source/resource controls remain in place. The diagnostic prefix is complete through the questioned snapshot, but is not the final run archive. Do not clear the unresolved-run marker or release uncertain accounting from this readback. The original authoritative observer/account was not modified or freshly health-checked by this analysis. No acceptance clock or new market-data measurement started.

**Decision:** the tested scheduling/failure-containment configuration is inadequate for reliable six-slot evaluation under this observed workload. Preserve the real failed intervals. Repair those two demonstrated local defects before loosening data validity or interpreting zero qualifications as evidence that no opportunities existed.
