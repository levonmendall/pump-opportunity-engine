# Independent review — query-timeout failure isolation

**GO for the reviewed source, subject to the lead's integrated regression.** This is offline source/test review; no provider-capacity or live-reliability claim.

Scope is explicit`queryTimeoutScope: independent-history` on independently scheduled`getSignaturesForAddress`. A physical timeout with no headers or HTTP200 may receive a bounded pool-query backoff. Actual429/overload/502/503/504 remains global; three distinct query timeouts within ten seconds escalate to the existing global policy. The one physical operation gate, pacing, consumed/uncertain reservations, original1500ms physical timeout, two-second operation reservation, ten-second decision deadline and fail-closed unavailable audit result remain intact. The next-bucket marker prevents re-requesting the same failed target. The source does not claim to fix every undispatched audit or immediate retirement overhead.

Review found and the implementer corrected two defects before GO:

1. Actual503/502/504 headers arriving after logical timeout could otherwise be missed by the already-completed outer catch. Late actual provider status now establishes global backoff before the unsettled physical operation can release its gate.
2. Immediate503`Retry-After` could otherwise be ignored by the generic two-second backoff. The catch now honors the larger provider-specified retry interval. Late header restrictions are also persisted when the logical operation has already returned.

The reviewed tests include a still-unsettled timed-out operation blocking every other job, same-pool cooldown without a new request, five peer audit opportunities after one failed target, three-distinct-query escalation, invalid scope refusal before any physical work, actual429/503 behavior, and late429/502/503/504 restrictions including persisted cooldowns. The implementer reports79focused tests/buildPASS. A full run had1276/1279passes with three nested TypeScript subprocess timeouts during concurrent suites; those failures remain evidence and need the stated serial retest/integrated full run. This reviewer did not relabel that full run as passing.

The reviewed content was subsequently committed as`d72d4f7` in the isolated worktree; all four hashes below still match.

Exact reviewed content hashes:

- src/pilot-rpc.ts: `d518c1fcdb42fd4c3f96d2eed1c961518e1ad841482231aa6a8af4f8e1267396`
- src/native-candidate-runner.ts: `33066742e76e0fefd60492c702e11f664f51da93f6514957cec3fecdc053c6b9`
- test/pilot-rpc-query-timeout.test.ts: `1b6f200ab77a6848f4c5cceaffd31b3167c1c5db91312f04199e92ed77daf5ba`
- test/native-candidate-runner.test.ts: `864f7a291dd2bc1fe821c1b9db04f3f8480c37364a7dd69560e652af95946a5c`
