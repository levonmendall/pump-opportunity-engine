# Continuous capture and resource repair — original PAPER service

The four-slot configuration is already operational in the original service. This is the separate coherent repair for demonstrated recurring capture interruptions. The current one-position limit, strategy, age rules, account, ledger, risk and actual-size pricing remain unchanged. No new service, portfolio or reporting channel.

## Observed failure and changes

The original recorder closed capture around120MiB diagnostic headroom even while host memory/disk/CPU admission were healthy, no evidence record was refused, and mature diagnostics could be retired. Rotation started after the same threshold used for admission, and source recovery waited through backoff after space was free. The four-slot run reproduced this behavior; four slots alone did not resolve it.

Continuous service rotation now retires mature unpinned diagnostics proactively, at most two per single-flight maintenance pass. Mandatory evidence can obtain bounded working capacity from measured disk headroom rather than an arbitrary cumulative128MiB research allowance. The persisted base, namespace, five-minute retention and financial reserves remain unchanged. Qualification/financial proofs and required evidence remain protected. Only local phase metrics and explicitly supplementary raw representatives may omit at capacity; omissions are separately counted and never become invented trading evidence or global flow gaps. Required loss, corruption and I/O failure remain fail closed.

Independent review also reproduced a pre-existing proof-publication race: mandatory failure during awaited proof copying could occur after the first refusal check. The final pre-publication no-yield check now prevents accepting such a proof, including staged manifest I/O; historical proof idempotence remains. Failed artifacts are retained; a crash during incomplete publication can still strand that proof ID fail closed. This race was reproduced offline, not established as a live false qualification.

Recovery resets evidence health BEFORE building replacement sources, so a constructor-time failure remains latched. Persistent accounting chapters no longer clip a genuine caller's timeout at an arbitrary five-minute accounting boundary; physical ownership remains held until transport settlement. Required timeouts and finite research controls remain.

Actual EC2 had4CPUs/~7.59GiBRAM but a0.5-core total quota, weight10/nice19 and192MiB native heap. New coordinated profile removes the CPU quota, uses normal weight/priority and aligns source heap/RSS, publisher and systemd memory budgets with measured capacity while leaving substantial host headroom. CPU and rolling stream bytes become telemetry, not lifetime stops. Actual RSS, host MemAvailable with hysteresis, disk, bounded queues, payload, evidence, freshness, financial and provider controls remain.

Persistent service alone selects the existing explicit90/minute RPC profile, retaining250ms spacing,20starts/10seconds, one physical operation, all accounting and cooldowns. Same-load offline actual-PilotRpc fixtures showed four-slot/held demand exceeding60/minute: healthy120ms model lost7holding checks at60 but none at90, actual peak63/minute. At1.2–1.4s latency both profiles still failed; this change is not a claim to solve serialized provider latency or guarantee capacity. Official published ceilings are not anSLA. Forward pressure/reliability must be measured; bounded research remains60. Policy/configuration provenance explicitly includes the selected service rate.

The existing reporting schema now retains historical protection maxima after the account becomes flat, provided a genuine completed-protection timestamp exists; no unmeasured zero is invented. Financial entries remain atONE position. Existing coherent two-position fixtures are useful readiness evidence but do not prove real timing or justify increasing the limit amid protection failures.

## Offline verification

- Full repository:1737/1737 tests PASS, zero skipped. All324 source/test/builder hashes identical before/after the full interval; raw output retained.
- Combined affected components:242/242 PASS; recorder39/39 independently PASS; protection reporting15/15 and related native/financial49/49 PASS; accounting82/82 PASS.
- Actual supervisor32, forward upgrade40, four-slot helper15 and legacy financial cutover28 tests PASS. Final forward driver pins four/single and requires completed four-slot root transition and latest full financial prefix.
- TypeScript build PASS. Independent caller/recorder/resource/upgrade reviews found no remaining blocker in this delta. All initial fixture failures and the reproduced adverse controls are retained.

Future four-slot/single-position service configuration:44e06adbddd6bab5e9aa5f70e9c24061f47998ccc9a1ebd2864d9b5aa8e2c8ae. No new runtime has been frozen, staged or installed at the time of this source-test record. Exact artifact/commit/install pins will follow after the clean-source build. This document does not claim live repair, provider90 reliability, two-position readiness, sustained profitability or24-hour acceptance.
