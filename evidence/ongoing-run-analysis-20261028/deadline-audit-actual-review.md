# Actual source640 audit and deadline attribution

## Scope and evidence

This is a read-only attribution of the questioned **36 quality gaps / nine unavailable audits / twelve deadline misses** through **2026-10-28 15:24:48.374 UTC**. It supersedes the uncertainty about those specific audit/deadline causes in `deadline-counter-review.md` without altering any historical counters.

Source run: `native-candidates-20261028151711944`, GitHub run `40714364745`; commit `640143a5924a7ff7d98039967c2db17957f71f24`; executable SHA-256 `4c035987338ab4dfa8982b5314c2ce3aebb41b12f23268a6425d8861d3e1909a`; configuration SHA-256 `29d9de0d148c52a10ebad22eb66875636fa06beacbe66004862cd8f0505597bf`.

Evidence: `source640-diagnostic-prefix.json`. Its `targetPrefixComplete` is true, with 945 retained diagnostic records, hashes and line references to source evidence files, and counts of every event kind through the target. The probe read 23,428,391 source-event bytes but retained only the bounded selected projection. This is **a target prefix, not a complete run archive**. The probe's later current-status section reports the source still running; cancellation of its GitHub workflow does not establish source-process or transport settlement.

The prefix contains 15 audit sessions/results: **six verified and nine unavailable**; zero audit-unusable results. It contains twelve `native-predictive-window-expired` records and twelve physical timeouts overall. The nine audit timeouts below are a subset of those twelve physical timeouts.

## Result

The nine unavailable audits are **actual first-page request timeouts**, not missing-signature refusals, single-page-history saturation, or merely mislabelled warming. The twelve expired predictive targets split exactly into:

- **Six targets whose own audit was dispatched and timed out.**
- **Six targets for which no audit session or history request was dispatched before the next bucket.**

These are real failures to obtain a timely independently verified predictive assessment under the frozen ten-second decision-bucket contract. They are not twelve independent missing-data incidents, not twelve distinct tokens, and not evidence that the strategy rejected those targets. They cover seven unique tokens and four distinct target-close timestamps. No preserved record establishes a completed valid assessment before the deadline that the counter incorrectly classified as missed.

The nine unavailable audits involve six unique tokens. Six of those audit results subsequently also appear in the twelve deadline misses. The remaining three failed audit targets were retired by a candidate-wide cooldown failure before their expiry could be counted. Consequently the audit and deadline counters overlap and neither alone measures all lost useful coverage.

## Nine unavailable audits: exact physical evidence

Every row has `PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT`, `requestAttempts:1`, no validated history pages, zero validated history rows, and `historyRangeCovered:false`. Every request's configured timeout was 1,500 ms. A body fragment was never parsed/admitted as a complete page.

Times below are UTC on October 28. Token prefixes abbreviate exact public mint identities; the JSON retains full identities. “Body bytes” are bytes already charged by the physical operation at timeout, derived from its 2 MiB reservation minus the remaining reservation in the matching unavailable record. The gate allows one physical operation, making this reservation attribution unambiguous.

| Target close | Mint prefix | Operation | Physical start | Physical settlement | HTTP evidence | Body bytes by timeout | Timeout callback lateness |
|---|---|---:|---|---|---|---:|---:|
| 15:18:30 | `mWTK7nLF` | 5076 | 15:18:31.989 | 15:18:33.558 | 200 headers at 15:18:32.142; incomplete body | 219,196 | 4.496 ms |
| 15:20:30 | `Ag9iUb3W` | 5120 | 15:20:31.864 | 15:20:33.395 | No headers before timeout | 0 | 0.414 ms |
| 15:20:30 | `9ojYt5Li` | 5127 | 15:20:37.799 | 15:20:39.331 | 200 headers at 15:20:37.938; incomplete body | 163,840 | 4.301 ms |
| 15:22:10 | `nyHJiwvX` | 5147 | 15:22:11.361 | 15:22:13.107 | 200 headers at 15:22:12.073; incomplete body | 167,372 | 218.953 ms |
| 15:22:10 | `D9NXzZxi` | 5148 | 15:22:15.459 | 15:22:17.214 | 200 headers at 15:22:16.097; incomplete body | 157,853 | 226.685 ms |
| 15:24:20 | `FfR4XdDP` | 5179 | 15:24:21.855 | 15:24:23.384 | No headers before timeout | 0 | 0 ms |
| 15:24:30 | `Ag9iUb3W` | 5193 | 15:24:31.825 | 15:24:33.352 | No headers before timeout | 0 | 0 ms |
| 15:24:40 | `FfR4XdDP` | 5206 | 15:24:40.979 | 15:24:42.677 | No headers before timeout | 0 | 168.672 ms |
| 15:24:40 | `Ag9iUb3W` | 5207 | 15:24:44.810 | 15:24:46.376 | No headers before timeout | 0 | 37.432 ms |

All **75 recorded HTTP header events in this prefix have status 200**. There is no observed 429 or 503 in this prefix. Missing headers are not evidence of a particular unseen HTTP status. These facts demonstrate end-to-end request incompletion under the local 1.5-second timeout; they do not isolate provider execution time from network transfer and local runtime activity, nor establish provider saturation/entitlement.

Four failed requests had partial successful HTTP bodies; five never exposed headers. Timer lateness reached 226.685 ms, demonstrating some local event-loop delay. However several requests failed with approximately zero callback lateness, so attributing all failures to CPU delay is unsupported. Conversely attributing all timeout duration to the provider is also unsupported.

The failed targets include completely quiet captured windows and a high-activity window: `D9NXzZxi` had 2,200 required captured signatures, whereas five unavailable results had zero. Since each failed before its first validated history page, this sample does **not** test whether four-page auditing succeeds on the 2,200-signature window. It also does not support abandoning audit completeness for quiet windows: without independent evidence, a captured zero can still mean either true inactivity or a capture failure.

## Twelve deadline misses: exact target classification

| Target close | Expiry observed | Mint prefix | Own audit before deadline | Classification |
|---|---|---|---|---|
| 15:20:30 | 15:20:40.033 | `Ag9iUb3W` | Operation 5120 timed out | Direct audit-availability failure |
| 15:20:30 | 15:20:40.033 | `9ojYt5Li` | Operation 5127 timed out | Direct audit-availability failure |
| 15:20:30 | 15:20:40.033 | `Tp7EZyRa` | None | Eligible audit not dispatched in bucket |
| 15:20:30 | 15:20:40.033 | `4biV2urU` | None | Eligible audit not dispatched in bucket |
| 15:22:10 | 15:22:20.002 | `nyHJiwvX` | Operation 5147 timed out | Direct audit-availability failure |
| 15:22:10 | 15:22:20.002 | `D9NXzZxi` | Operation 5148 timed out | Direct audit-availability failure |
| 15:24:20 | 15:24:30.200 | `FfR4XdDP` | Operation 5179 timed out | Direct audit-availability failure |
| 15:24:20 | 15:24:30.200 | `Ag9iUb3W` | None | Eligible audit not dispatched in bucket |
| 15:24:20 | 15:24:30.200 | `9ojYt5Li` | None | Eligible audit not dispatched in bucket |
| 15:24:20 | 15:24:30.200 | `Tp7EZyRa` | None | Eligible audit not dispatched in bucket |
| 15:24:30 | 15:24:40.423 | `FfR4XdDP` | None | Eligible audit not dispatched in bucket |
| 15:24:30 | 15:24:40.423 | `Ag9iUb3W` | Operation 5193 timed out | Direct audit-availability failure |

The 2–423 ms delays in emitting the expiry record after the bucket boundary are classification-observation delays, not a measured valid decision latency. The actual failure is that no validated assessment had been admitted by that boundary. `640143a` separately records normal lower-fence warming with `deadlineEligible:false`; 24 such warming records appear in the prefix and are not these twelve expired targets.

The `Tp7EZyRa` and `4biV2urU` target windows ending 15:20:10 and 15:20:20 were explicitly classified as lower-fence warming. Their later target ending 15:20:30 became ready and then expired without dispatch. This confirms the distinction in actual traces, rather than merely assuming the warming fix exists in source.

## Demonstrated scheduling contribution

Timeouts start a shared RPC cooldown, consuming remaining decision-bucket opportunity. In addition, the runner immediately fills vacancies after a completed predictive rejection. Existing native service handles unsubscribe/new-candidate support/setup work before remaining ready audits. This is **demonstrated local competition**, not inferred from average demand:

- **15:20:30–40:** two shared support refreshes; audit 5120 times out; cooldown through 15:20:35.374; the `EzDyLqyh` audit verifies at 15:20:36.303 and the candidate retires. The runner then performs unsubscribe, two account reads, subscribe and ping before audit 5127 starts at 15:20:37.799 and times out. Two other ready targets receive no audit.
- **15:24:20–30:** two shared support refreshes; audit 5179 times out; cooldown through 15:24:25.364. The `c5mcBcoB` audit verifies at 15:24:26.312. Its vacancy triggers unsubscribe, two account reads and subscribe. The `EzDyLqyh` audit then verifies at 15:24:28.239; another replacement setup and ping consume the rest of the bucket. Three other ready targets receive no audit.
- **15:24:30–40:** another timeout/cooldown, followed by two verified audits and replacement setup after each rejection. The remaining `FfR4XdDP` target receives no audit, then starts a new target's audit at 15:24:40.971.

These operations are real and counted, and subscription/support validation must not simply be removed. The avoidable priority issue is **admitting replacement candidate setup into a bucket with already-warm, unserved predictive targets**. Deferring replacement admission/setup until the existing audit batch has a feasible service opportunity is the smallest operational repair supported by this evidence. Its effect still requires isolated verification; this report does not claim a counterfactual schedule would have received identical provider responses or that a priority change alone can make six concurrent audits succeed during repeated timeouts.

Repeated ceiling reads also consume approximately the first 1.8 seconds of some buckets because the first freshly fetched bank Clock still trails the target boundary. They are not proved redundant: the recorded freshness contract requires an upper fence covering the target. The second read must not be removed without establishing an equally valid fence. Likewise a larger local timeout cannot simply be substituted while keeping the same six-candidate/ten-second service guarantee; request occupancy and nonpreemptibility must be budgeted.

## What is and is not proved

**VERIFIED COMPLETE:** exact attribution of all nine unavailable audit outcomes and all twelve expired targets in the questioned prefix; real timeout/header/body evidence; six dispatched versus six undispatched expired targets; normal warming excluded; actual priority competition from replacement setup.

**NOT PROVED:** that the captured flow was actually missing transactions in these nine unavailable windows; that all 2,200 signatures could be audited within the available ten-second batch; that every collected field is economically indispensable; that ten-second predictive expiry is economically optimal; or that any missed target would qualify or make money. Those questions require appropriate evidence and should not be answered by changing counter names or treating unverified windows as valid.

The immediate evidence-backed repair is to preserve financial and candidate data validity while separating current ready-audit service from discretionary replacement setup and containing RPC cooldown failures. Keep the original counters and negative evidence. A later forward interval should measure whether more unique candidates receive timely independently audited assessments, not merely whether the counter decreases.
