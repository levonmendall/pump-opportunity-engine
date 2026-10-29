Selected native capture recovery repair — 2026-10-29

VERIFIED FORWARD OBSERVATIONS, installed source5648606

Two independently retained episodes have eight consecutive disconnected native
capture snapshots each: first false20:28:16.739 to first connected20:30:16.942,
and first false20:51:52.170 to first connected20:53:52.467 UTC. Broad discovery
and WATCH remain connected. The second episode has two approximately60s
plateaus without physical request/capture progress, but its exact close/error
and retry events are unavailable in public snapshots. Neither CPU/resource nor
recording pressure is shown. Earlier episode precedes the20:46 daily-loss pause,
so that financial gate is not necessary for this coverage failure. Do not treat
these periods as successful native observation or infer the original fault.

The later transport is connected at20:53:52.467, new notifications appear at
20:54:05.335, and an independently audited predictive assessment counter advances
again by20:55:23.645. Connected, receiving, and newly audited evidence are distinct
milestones. No source recovery/restart or ledger operation was requested here.

VERIFIED CODE DEFECT AND CONTROLLED REPRODUCTION

Both installed564 and current lead permanently accumulate a private `failures`
exponent on unexpected WebSocket termination. No successful round trip ever
resets it. After six lifetime failures, later isolated failures inherit a60s
local backoff even following a healthy connection. This is avoidable local
recovery delay; it does not prove that backoff caused either entire live episode.

The retained first regression fails on original code: after a full minute of
actual managed heartbeats plus independent fresh support, the next failure
waits5000ms rather than initial2000ms. The first attempt also contained a faulty
fixture notification after stale support; that unrelated test assumption is
corrected without changing source validity rules. Raw failure output is retained.

IMPLEMENTED, OFFLINE VERIFIED, NOT INSTALLED

A complete60s span of managed matching ACK/PONG proofs, with no proof gap over
the existing10s heartbeat plus1500ms native operation envelope, resets only the
consecutive local retry exponent. HTTP upgrade, incoming traffic, one late proof,
and quick flaps cannot certify a healthy span. The original2/5/10/20/40/60s
escalation remains for consecutive faults. Total transport incidents and healthy
resets are separately retained as telemetry; no history is erased.

Actual provider cooldown/Retry-After, transport settlement, source identity,
fresh support, new subscription ACK, and a complete new qualification window
remain mandatory. The change does not dispatch from timers, add subscriptions,
change slots/risk/strategy/position count, reset financial controls, or operate a
second service/account. Existing required failure and executed-flow records stay.

4 new regressions and106 focused native/heartbeat/service regressions pass;
`npm run build` passes. These use injected transport/clock and no actual provider
or operating financial account. Root still must integrate, independently review,
freeze, install and verify real recovery under forward demand. No installed
coverage-repair claim is made from these tests.

Commands:

    node --import tsx --test test/pilot-native-flow.test.ts test/native-flow-heartbeat.test.ts test/native-flow-service-policy.test.ts test/native-flow-transport-recovery.test.ts
    npm run build
