# Ongoing run: audit and decision-deadline counter review

Read-only analysis of frozen source `640143a5924a7ff7d98039967c2db17957f71f24` and the locally retained Render projections in `evidence/forward-recovery-20261028/render-cycles.ndjson`. Target run: `native-candidates-20261028151711944`, GitHub run `40714364745`. No test, source change, provider request, or runtime intervention was performed for this review.

## What the available evidence establishes

The question's snapshot was already present at source time **2026-10-28 15:24:48.374 UTC**: 36 quality gaps, nine unavailable audits, zero unusable audits, twelve predictive deadline misses, and six audited predictive assessments. These are different counters with overlapping populations. They cannot be summed as independent lost opportunities, missing transactions, tokens, or observation minutes.

The public projection supplies aggregate counters and the latest bounded decision list. It does **not** supply each audit's reason, target, request timings, or validation timings. The exact causes of the current nine unavailable audits and twelve misses therefore remain **UNKNOWN / INSUFFICIENT EVIDENCE** until this run's event trace is retrieved. Earlier run diagnoses must not be attributed to this run merely because counters look similar.

| Source snapshot UTC | Quality gaps | Audit unavailable | Audit unusable | Deadline misses | Audited assessments | RPC starts |
|---|---:|---:|---:|---:|---:|---:|
| 15:17:14.559 | 0 | 0 | 0 | 0 | 0 | 5 |
| 15:17:29.585 | 6 | 0 | 0 | 0 | 0 | 31 |
| 15:18:45.461 | 18 | 1 | 0 | 0 | 0 | 52 |
| 15:20:45.723 | 24 | 3 | 0 | 4 | 2 | 94 |
| 15:22:17.220 | 24 | 5 | 0 | 4 | 2 | 115 |
| 15:22:32.232 | 30 | 5 | 0 | 6 | 2 | 115 |
| 15:24:33.356 | 30 | 7 | 0 | 10 | 4 | 160 |
| 15:24:48.374 | 36 | 9 | 0 | 12 | 6 | 174 |

Rows show changed retained projections, not exact event times. Several intervals contain multiple events, and old/repeated source snapshots do not reveal intra-interval order. The repeated six-gap increments are consistent with a shared incident invalidating six candidates; they do not prove six independent missing-trade incidents. In particular, two additional deadlines and six gaps became visible with the RPC-start counter unchanged at 115. This rules out inferring a fresh physical RPC start for every counter increment, but does not identify the cause.

## Exact counter meanings in the frozen source

### Quality gaps

`NativeCandidateRunner.onGap` increments once per callback, then retires affected candidates and requires a fresh window (`src/native-candidate-runner.ts:62`). A connection/control failure can be reported for each affected candidate. A failed independent history comparison can also call this path. The counter measures invalidation notifications, not the number of signatures proved missing. Candidate cancellation/retirement diagnostics are separately recorded and do not necessarily increment audit-unavailable.

### Nine unavailable audits

`finishAudit` increments `auditUnavailable` when a completed/failed session has no usable diagnostic result; `admitAuditResult` also increments it for an explicit helper result with status `unavailable` (`src/native-candidate-runner.ts:107`, `:115`). Those branches are alternatives for one processed session, not automatic double increments. However, successive sessions/windows for the same candidate can each increment the counter.

Possible reasons include request timeout/error or admission closure; insufficient context fences; ambiguous slot boundaries; an independently retrieved history range not covering the target within four pages; and captured target signatures not present in the returned history. Multipage history is already implemented: up to four pages of 1,000 rows, one physical page per scheduling step. An incomplete four-page range remains unavailable; it is not silently accepted.

The helper's **proved independently missing captured notification** case is `NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED`, classified `unusable`, not `unavailable` (`src/native-flow-audit.ts:93`–`:97`). At the question snapshot audit-unusable was zero. Thus nine unavailable audits do not establish nine detected notification-loss incidents. They also do not establish that completeness rules are unnecessarily strict: unavailable can reflect failure to obtain evidence needed to distinguish valid zero/low flow from a capture gap.

Some late/cancelled results increment `predictiveUnavailable` instead of `auditUnavailable`; the displayed audit counter is not an exhaustive incident count. Only the event trace can attribute each unavailable outcome to physical occupancy, provider behavior, scheduling, paging, or validation.

### Twelve deadline misses

Every loop marks a warm feature window as deadline-eligible when its lower audit fence exists, independently of whether an audit job gets dispatched. When the next closed ten-second bucket appears without an assessment for the previous eligible target, it records `native-predictive-window-expired` and increments the miss counter (`src/native-candidate-runner.ts:146`).

`lastExpiredWindowEnd` prevents the same candidate-generation/window target from being counted on every loop. Nevertheless, consecutive targets are overlapping 60-second windows advanced by ten seconds; a single outage/contention episode may cause multiple misses for the same token. No unique-token or nonoverlapping-coverage interpretation is warranted.

The lower-fence warming correction is present in `640143a`: a target lacking an actual post-ACK lower context/notification is recorded as `native-independent-audit-warming` with `deadlineEligible:false`, and is excluded from dispatch/readiness. The previous known classification of ordinary initial lower-fence warming as a deadline miss therefore cannot simply be reused as the explanation of these twelve.

An unavailable audit leaves the target unassessed. That same target can later increment the deadline counter: an unavailable audit and a deadline miss can describe **one underlying failed window**. A scheduler-starved eligible window can miss without a physical request ever starting. A result available to the helper but not validated/admitted until the next bucket can also miss. Under the frozen original-bucket decision contract, late admission is a real usefulness failure even if the underlying bytes eventually arrive; it is not automatically a false classification. Whether the ten-second contract is economically necessary is a separate behavioral review, not established by these counts.

Expiry checking precedes `finishAudit` in each loop. A result spanning the bucket boundary consequently requires examination of helper completion, physical settlement, and final validation timestamps; raw HTTP completion alone cannot prove that a valid decision was actually available before the cutoff. Quote validity and financial permission are unrelated to this candidate-only deadline counter.

## Scheduling and observability limits

The frozen profile permits a maximum 9,999 ms audit span after target close, 1,500 ms physical timeout, and declared 2,000 ms per-page operation bound. Setup/recovery, support refreshes, pacing, physical-gate occupancy, pages from other candidates, and local parsing can all consume this span. Audit jobs are ordered by deadline and then most-recent page service; one physical gate remains shared.

The job's `enqueuedAt` and `eligibleAt` are created at the current dispatch step, not preserved from the first warm/fence-ready moment. Accordingly, scheduler trace queue age alone understates total ready-to-dispatch latency. Feature-view/fence timestamps must be joined to session and physical-request traces. Average request demand or event-loop-lag samples cannot establish provider saturation or exclude transient local stalls.

No protection or financial failure can be inferred from these counters: this is a candidate-only run with no financial writer. They describe whether timely defensible candidate assessment was achieved.

## Required attribution on the retained run

Join by **mint + observation ACK generation + target window end**, retaining multiple sessions and overlapping windows separately. For each of the nine unavailable sessions and twelve expired targets, recover:

1. First warm feature availability and valid lower/upper fence availability.
2. Audit-session creation, pending pages, requested page count and returned history coverage.
3. Dispatch eligibility, pacing/gate wait, selected competing job, physical start, headers/body receipt and actual settlement.
4. Parsing/helper result availability, validation/admission time, and explicit unavailable/error reason.
5. Candidate gap, retirement, reconnect and fresh-window events, including cancellations and whether the same incident affected multiple candidates.

Classify independently as: proven capture loss; incomplete independent evidence; provider/physical failure; local admission/contention; validation/processing lateness; normal warming; or unresolved. Deduplicate causal incidents without deleting per-window lost-coverage records. Report both unique candidates and distinct target windows. Preserve all original counters; any later classification correction must be an explicit derived interpretation.

## Decision

**Not yet attributable from the public counter projection.** The source proves that the counters can overlap and cascade, and that the known lower-fence warming case was intentionally excluded in `640143a`. It does not prove that all nine audits are provider failures, that all twelve misses are scheduler failures, or that the completeness contract is excessive. The smallest next step is read-only retrieval and attribution of this ongoing run's existing raw trace at safe availability; no corrected run or relaxed threshold is justified by counters alone.
