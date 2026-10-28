# Equivalent managed-ACK liveness reuse

A valid current-connection notification establishes inbound activity. It does
**not** establish the client→server→client round trip proved by a nonce-matched
PING/PONG. Postponing the existing round-trip deadline merely because notifications
continue would change failure-detection behavior. This repair does not do that.

A validated matching subscribe/unsubscribe ACK does establish an actual managed
round trip on the same current connection. The repair lets it renew the existing
10-second liveness clock, sharing the same physical gate and accounting as before.
A quiet connection still requires a client PING after ten seconds without such
proof; its existing one-second physical timeout is unchanged. Server PINGs still
require a managed PONG within three seconds. Sending that PONG does not itself
prove a round trip and cannot renew the clock. Unknown/nonmatching/malformed ACKs,
old connections, notifications, raw bytes, HTTP support reads and unsolicited
PONGs cannot renew it.

The proof timestamp uses the conservative transport-receipt bound, with the
physical request-start time as a lower bound because a matching response cannot
precede its request. Delayed handler time never relabels an older ACK as current.
The exact request start, receipt lower bound, proof bound, connection, proof kind
and resulting heartbeat deadline are recorded separately. Market availability,
subscription/window completeness, bank Clock, source age and quote validity are
unmodified. Existing explicit early-heartbeat requests remain explicit operations.

The public usage projection now exposes `nextServiceAction` in addition to the
existing domain/deadline: support-refresh, heartbeat, peer-pong, unsubscribe,
close, upgrade, subscribe, backoff, or null. Selection order and dispatch behavior
are unchanged. This enables the separately reviewed runner correction to prepare
the service that actually limits audit runway, rather than sending an early
PING when an HTTP support deadline is the limiting service. That runner repair
is not part of this flow-only commit.

`forward718-pings.json` independently scans all retained source718 segments:
110 native client PINGs in890.330 seconds,7.413 counted units/minute and16.34% of
673 physical starts. There were59 early-heartbeat requests;58 PINGs had a preceding
early request since the previous PING. Sixty PINGs occurred within ten seconds of
a same-connection managed ACK (17 periodic and43 early-preparation cases).
These overlaps are **not measured savings**. Original ACK timestamps were handler
availability times; later explicit runway needs and rescheduling affect which
operations a revised runtime actually performs. Actual request savings require
new source-pinned forward evidence. No provider entitlement is inferred.

`focused-tests.txt`:92 tests pass, including the existing native transport,
correction, cooldown and physical-settlement tests plus dedicated ACK reuse,
unsubscribe reuse, continuing-notification/no-renewal, peer-PING/no-renewal,
conservative delayed ACK timestamps, and exact service-action regressions.
`build.txt`:repository type check passes. Independent review approved the exact
current-connection, matching-request, conservative-timestamp implementation.
`focused-tests-initial.txt` preserves one failing new fixture whose hand-selected
schedule put heartbeat before support; adjusting that fixture's synthetic times
established the intended support-first state. No production timing was relaxed.

Reproduction, entirely offline:

```bash
node --import tsx --test test/pilot-native-flow.test.ts test/native-settled-recovery.test.ts
npm run build
python3 evidence/native-liveness-coalescing-20261028/analyze-forward718-pings.py /PRIVATE/retained/artifact/run
```

No market requests, financial writer, production deployment or active-run source
changes occurred. This is a tested equivalent resource optimization, not evidence
of reliable high-volume observation, protected holdings or PAPER profitability.
