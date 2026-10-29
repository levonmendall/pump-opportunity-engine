# Held-position audit contention — read-only investigation

The operating comparison is source `f96f02eeccd56dda6ce811bdc4405f237224c54f`, configuration `acbe8e435d4f9f3a61cecc6f511469272890766abf63d8d5b891fc4a5e8085cf`, run `native-paper-20261029185051115`. The general-arming repair `a317a8321aa35d3b6d2cd8fb8d7f60177a0e05bd` remains unchanged. No operating service, provider, financial database, account or application source was modified by this investigation.

## Verified public measurements

Between source snapshots 9689 at 19:22:32.355 and 9699 at 19:25:07.285 UTC:

- Independent audit unavailable increased 67→71; predictive deadline misses 81→84.
- HTTP timeouts remained 377; HTTP errors and throttles remained zero. Primary and history cooldown timestamps were already expired.
- Selected capture remained connected; quality gaps remained 1059.
- Predictive assessments increased 1815→1823; deep candidates increased 3→4.
- One real PAPER position remained held. Maximum completed protection gap was 2219 ms with zero breaches and zero unavailable checks.
- Observed request starts were below the configured 90/minute ceiling. CPU and event-loop measurements do not indicate saturation.

Later source snapshot 9706 at 19:26:54.591 also reports audit unusable 132→133 and quality gaps 1059→1060. Therefore the earlier unchanged-gap statement must not be extended across the entire 19:22–19:27 interval. Frozen raw public rows and the derived timeline are retained here. These public counters cannot identify individual audit refusal causes; unavailable and deadline counts can refer to the same target.

## Proven local failure mechanism

The outer operating loop admits source work using `pilotLowerPriorityAdmission` with its default 1200 ms bound (`run-native-paper.ts:226–227,293`). The actual scheduled audit request applies the same guard with `timeoutMs 1500 + 200 = 1700 ms` (`:251`). With a held position and no nearer pending deadline, the guard permits:

`now <= lastCompleted + 4000 - 2*125 - 1200 - operationBound - 25`.

Thus the outer source step allows starts through lastCompleted+1325 ms, while the actual audit request allows only lastCompleted+825 ms. A roughly 500 ms interval, plus local preparation time, can admit the engine but refuse the physical audit request.

The single-page path immediately rejects its logical session on every thrown request error (`native-candidate-runner.ts:216–223`), including a pre-admission refusal with no physical request. The batch path separately recognizes such local refusals and retains its pages (`:249`). Operating batching is deliberately disabled by the measured `publicnode-single-history-pages-v2` policy (`run-native-paper.ts:68–73`), citing prior stalled envelopes. Its absence is intentional; no blind batch activation is proposed.

The isolated reproduction uses the literal frozen operating `requestOptions` closure, real `NativeCandidateRunner`, `FlowWindow`, independent history audit, `PilotRpc` and `ComponentBudget`, with synthetic ownership/clock inputs and an injected local history response. Both tests pass:

- With a current held context, one actual local physical request produces a verified audit and assessment.
- At held-context age 1000 ms, the outer guard admits but the actual wrapper refuses `PILOT_RPC_COMPONENT_ADMISSION_CLOSED`: zero physical starts and zero fetches, yet auditUnavailable increments, its session is removed, and that target is not retried with 7999 ms remaining.

This demonstrates an avoidable software mechanism. It does **not** establish that this mechanism caused any specific live counter increase. It is a controlled reproduction, not a full operating-service replay, provider-capacity test or financial result.

## Entire relevant scheduling path

1. Due financial actions and held protection precede source work (`run-native-paper.ts:286–287`). Financial priority remains required.
2. Source admission also reserves rolling request headroom and checks resource/evidence/source state. The outer lower-priority guard applies the 1200 ms bound above.
3. The runner first classifies target readiness and expires previously ready windows once the next 10-second bucket arrives (`native-candidate-runner.ts:261`). That records a deadline miss even when no request was dispatched. It is an operational non-evaluation, not a strategy rejection.
4. Ready audits prevent discretionary replacement setup and origin verification. Required support/heartbeat/recovery still precedes or shortens history runway (`:264–292`).
5. A current upper bank clock must cover the target end; otherwise confirmed support refresh runs before history. Required native-service deadlines subtract their 1500 ms reserve and require a further 2000+125 ms page/validation runway.
6. Audit targets are ordered by original deadline, last page opportunity and allocation time. Pages remain individually paced and physical concurrency remains one. Multiple pages/candidates must finish inside the original 9999 ms decision span.
7. Actual requests recheck the wrapper, caller deadline, provider/query cooldown, physical occupancy and durable request budget before invocation. No physical allowance may be refunded or settled early.
8. HTTP success alone does not establish an audit: response/body/validation latency, history schema, context fences, pagination and notification comparison can produce unavailable or unusable results without an HTTP timeout counter increment.
9. Single-page local pre-admission refusal currently terminates the target as described above. A later bucket may then also increment deadline misses for that same target.

## Exact live attribution remains unavailable

Reviewed current GitHub interfaces do not provide live original-account audit-event readback. The isolated PAPER results workflow requires a completed, settled research run and another account. The original forensic workflow retrieves an owner-generated fixed-window artifact; the current original-cutover reader exposes public metadata and a separately fixed earlier source/supervisor diagnostic window. None was invoked against the live original account, and no privilege boundary was bypassed.

To attribute the actual failures, obtain a bounded sanitized projection of `native-audit-dispatch-state/summary`, `native-candidate-window-audit[-unavailable]`, `native-predictive-window-expired`, and corresponding physical start/settlement metadata for the original 19:22–19:27 targets. Needed facts are target identity/cutoff, first ready time, last admission reason, requested/actual start, logical error/result reason, page count and original deadline. No raw provider payload, secret or financial database export is required.

## Smallest coherent future repair proposal — not implemented

Use one operation-specific admission contract across outer source work, the runner's required native/page runway and the actual request wrapper. Retain an uninvoked single-page logical request on a proven pre-admission deferral, preserving its original target, generation, complete evidence and absolute deadline. Reconsider it after financial priority/pacing permits; refuse genuine failed or expired/incomplete evidence normally. Avoid a busy retry loop and preserve peer fairness, actual physical settlement, provider cooldowns and position protection. Do not extend deadlines, raise rate limits or re-enable batches to conceal scheduling losses.

Validate the correction with this deterministic adverse/control pair, concurrent candidate pages and held/pending pressure, then require per-target forward dispatch evidence. The separately frozen general-arming source and its existing upgrade are not changed by this proposal.
