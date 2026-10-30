# Actual 36 quality-gap callbacks: source 640 target prefix

**Result:** all 36 callbacks are six shared six-candidate retirement episodes. Twelve callbacks followed two subscription-control timeouts; 24 followed four local HTTP-RPC cooldown refusals. They are not 36 demonstrated missing transactions, nor evidence that an unnecessarily strict failed-signature audit rule caused this sample. Four episodes show avoidable failure coupling: an HTTP audit timeout/cooldown led the next support/ceiling service attempt to invalidate every candidate and terminate an otherwise connected notification transport.

Evidence is the hash-verified `source640-diagnostic-prefix.json`, SHA256 `d32fbfb11227bff92d67a5a232049b006aff12cc947e70c10c3818aaeda4c38e`, 945 retained diagnostic records through source timestamp **2026-10-28 15:24:48.374 UTC** (`1793201088374`), `targetPrefixComplete:true`. Source run `40714364745`, commit `640143a5924a7ff7d98039967c2db17957f71f24`, executable SHA256 `4c035987338ab4dfa8982b5314c2ce3aebb41b12f23268a6425d8861d3e1909a`. The later diagnostic read's live counters are outside this target population and are not combined with it.

## Six episodes, not 36 independent root failures

Times are UTC. Raw file/line references below are included in the diagnostic prefix with each original line SHA256.

| First callback | Count / already ACK-opened | Direct reason | Recorded precursor and consequence | Raw reference |
| --- | ---: | --- | --- | --- |
| 15:17:18.637 | 6 / 4 | `PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT` | `logsSubscribe` operation 5044 timed out; physical settlement was initially uncertain. Its numeric ACK was processed after cancellation, then connection 1 closed. | `events-001.ndjson`:292-312 |
| 15:18:34.142 | 6 / 6 | `PILOT_RPC_COOLDOWN` | Audit HTTP operation 5076 timed out at 15:18:33.493, establishing cooldown until 15:18:35.514. The next service attempt during that cooldown retired all candidates and closed connection 2. | `events-002.ndjson`:262-288 |
| 15:18:45.457 | 6 / 5 | `PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT` | `logsSubscribe` operation 5085 timed out; a numeric ACK was processed after cancellation. Connection 3 closed. | `events-002.ndjson`:440-460 |
| 15:20:40.042 | 6 / 6 | `PILOT_RPC_COOLDOWN` | Audit operation 5127 timed out at 15:20:39.303; cooldown until 15:20:41.311. A shared audit-ceiling request at 15:20:40.037 was followed by all-six retirement and connection 4 closure. | `events-002.ndjson`:1141-1144,1457-1477 |
| 15:22:20.017 | 6 / 6 | `PILOT_RPC_COOLDOWN` | Audit operation 5148 timed out at 15:22:17.185; cooldown until 15:22:22.193. A shared ceiling request at 15:22:20.012 was followed by all-six retirement and connection 5 closure. | `events-003.ndjson`:3277-3280,3575-3595 |
| 15:24:46.565 | 6 / 6 | `PILOT_RPC_COOLDOWN` | Audit operation 5207 timed out at 15:24:46.347; cooldown until 15:24:51.355. All-six retirement and connection 6 closure followed. | `events-003.ndjson`:5630-5658 |

The callbacks involve **17 distinct mints**, including repeated losses after fresh re-promotion/ACK. Thirty-three callbacks affected already ACK-opened observations; three concerned allocated candidates whose subscriptions had not yet opened. Thus neither 36 unique tokens nor 36 complete windows were lost. All six episodes preserved watch awareness and required rebuilding a fresh window. Each real closure creates an actual observation interruption; it must not be reclassified as complete coverage merely to reduce the counter.

Source mechanism: `pilot-native-flow.ts` service catch at line 205 treats `PILOT_RPC_COOLDOWN` as a general service failure, calls `gap` for every candidate and terminates the shared socket. `native-candidate-runner.ts:62` records each callback and retires that candidate. `gap` suppresses repeated callbacks until a new ACK resets its flag, so the six callbacks within each episode are fan-out, while later episodes remain distinct interruptions. The subsequent disconnect does not add another six callbacks in the same generation.

## Missing information versus strict completeness

* **No missing-signature finding exists in this prefix.** Fifteen audit results comprise six verified and nine unavailable; every unavailable result is `PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT`, one attempted page, no validated page, `historyRangeCovered:false`, and `missingNotifications:[]`. Empty missing lists here mean the audit did not reach comparison, not proof of completeness. There is no `HISTORY_SIGNATURE_NOT_OBSERVED`, audit-unusable result, notification-ledger overflow or parser refusal in the target event counts.
* **Failed-signature overstrictness remains a source-level hypothesis for other samples.** The code does require missing independently failed rows to invalidate a window, although those rows cannot contribute executed ordinary trades. None of these nine unavailable results establishes that such a row caused failure. Changing that rule would not fix these 36 callbacks.
* **The four cooldown cascades unnecessarily turn audit unavailability into transport loss.** The latest completed `getMultipleAccounts` operation preceded each cascade by approximately 2.255, 3.004, 9.088 and 5.779 seconds respectively; no `SUPPORT_EXPIRED` reason was recorded. The source's general catch performs teardown on an admission refusal before a new physical operation starts. Deferring the refresh/audit during cooldown while continuing existing valid capture is a candidate equivalent repair; expired support must still stop admitting affected trades, and expired/unverified audits must still block a predictive decision.
* **The two subscription timeouts are actual control failures under the frozen timing policy.** Callback lateness was about 383 and 222 ms beyond the nominal 1500 ms timeout. Both later processed a numeric ACK, but the readback does not prove when that ACK reached the network buffer or why processing was delayed. The shared connection was closed to settle uncertainty. A future contained control-recovery design must prove subscription identity/settlement; merely accepting a late ACK or ignoring the failure is not justified by these records.

## What can be attributed to provider versus local behavior

All 75 recorded HTTP response headers in the target have status **200**, with no recorded 429/503. Several audit timeouts occurred after HTTP 200 headers with an incomplete response body; other timeouts had no headers yet. The trace demonstrates the local 1500 ms completion limit being exceeded, sometimes with substantial event-loop callback lateness. It does not isolate remote provider delay from response transfer and local processing. Therefore “provider saturation” is not established by this prefix.

The avoidable fan-out after cooldown **is** established by source and correlated event order. The appropriate repair target is failure containment and admission during cooldown, not loosening executed-flow completeness, inventing successful audits, or suppressing honest gap records after a real disconnection. Scheduling/timeout changes require their own bounded tests and versioned forward interval.

No active runtime, source, provider, financial state or counters were changed for this review.
