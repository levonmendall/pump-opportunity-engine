# Candidate history timeout isolation

Source90625f5 actual forward evidence is preserved separately under
`evidence/continuous-recovery-20261028/forward-01/` and the verified private
readback for administration run40726448588. This correction is offline; its
forward effectiveness has not been established.

## Demonstrated cause

Twelve candidate audit attempts across four pools reached their1500ms physical
request deadline without receiving HTTP headers or body bytes. All250 HTTP
header observations in that interval were200. Other pools'100-row pages completed
in133.6ms median and746.5ms p95;1000-row pages had1170.5ms median with body transfer
and negligible JSON decode. The failures do not establish global saturation.

A failed history query nevertheless applied at least2000ms backoff to all HTTP
work. In the16:30:40 target batch, query5739 timed out at1793205044496; the
local shared cooldown ran to1793205046497. A ping, successful quiet-pool audit,
and required retirement control followed; four other targets were never
started before1793205049999. Replacement admission was correctly deferred.
There were seven undispatched deadline targets in total, not six:4+2+1.
The sixteen total misses include eight timed-out targets and one ambiguous
slot-boundary target; four other failed audits retired before expiry accounting.

## Narrow correction

Only the native candidate audit explicitly opts into query timeout isolation.
For `getSignaturesForAddress` with a bounded pool identity, a physical timeout
without throttle/overload headers retains2/5/10/20/40/60-second backoff for that
pool's history query. Other candidates and holding/pending-action work may use
an actually settled shared gate. There is still one physical operation, unchanged
pacing/rate/byte accounting, no automatic retry, and no uncertainty refund.

Three distinct scoped queries timing out within10seconds escalate to the
existing global HTTP backoff. This is a conservative local outage heuristic,
not a claim about provider entitlement or proof of query-specific failure.
The bounded diagnostic map holds at most64 query identities. Local query
backoff is a research scheduling control; actual provider cooldown is separate.

Actual429 and502/503/504 remain global. Retry-After applies to503 as well as429.
Headers arriving while an already logically timed-out operation is physically
settling also establish the global restriction and durably update status;
a timeout cannot conceal a subsequently observed throttle.

A completed audit attempt—verified, unavailable or unusable—cannot be repeated
for the same target bucket. An unavailable target stays unavailable, and the
candidate needs the next complete target. Missing successful flow, audit
fences, quote validity, source generations and predictive deadlines are unchanged.

## Verification and limits

`verification-identity.json` pins the tested working-source hashes; final raw
logs and exit codes are retained. Tests cover query isolation, same-query retry
refusal, three-query outage escalation, physical cancellation settlement,
HTTP429/503, late429/502/503/504 headers, bounded scope validation and five
healthy ready audits completing alongside one explicitly unavailable target.
Existing gate/throttle and candidate scheduler regressions are also repeated.

The six-scope scheduler fixture is synthetic and uses the existing real audit
helper. It is not simulated provider performance. Actual historical response
times cannot be assumed unchanged under a new schedule. Retirement controls,
heartbeat/support work, busy multipage audits, and aggregate resource contention
still consume shared capacity. This patch does not claim every historical
undispatched target is recovered or that arbitrary six-pool demand is sustainable.
The four consistently stalled pools remain unavailable until forward evidence
shows their queries can complete; their timeout itself has not been eliminated.

An earlier overlapping verification invocation was stopped and its partial logs
are retained with an explicit interrupted-verification record. Only the final
serial invocation is eligible for a verification claim.
