# Bounded audit-dispatch attribution

This is offline diagnostic implementation, not a repaired forward deadline result.
The retained7189610 interval contains four fence-ready targets with no audit
session. Two successful ceiling reads and available physical/rate headroom do
not identify the local wait predicate; that historical cause remains unknown.

The existing runner now records each actual first-ready observation, immutable
closed target/deadline, chosen work, admission/physical-gate waits, ceiling
preparation, service slack, page exposure, request return/refusal and next action.
RPC/control readiness, actual in-flight occupancy, local rolling counts/limits,
and provider cooldown remain separately represented. A planned recovery-blocked
gate is not labeled a physically unsettled request. Only the chosen mint receives
`audit-selected`; ready peers retain their actual order and `peer-selected` state.

There is one current diagnostic object per live candidate, a fixed reason-code
set, at most16 changed-state records per target and one final summary. Identical
50ms waits coalesce into counts. After the transition cap, the bounded last state
and exact reason counts still appear at result, expiry, retirement or source
stop. An expired between-page session cannot relabel the next target or erase
when that next target was first observed ready. Physical-start/settlement claims
remain with the existing RPC records; diagnostic admission never claims them.

No dispatch predicate, audit page limit, timeout, observation/decision window,
strategy threshold, data-validity rule, provider budget or financial permission
changed. Six new regression tests verify coalescing, transition pressure/expiry,
page admission vs validation, one selected target among six ready scopes,
settled-but-unrecoverable chapter guards, and old-session/new-target rollover.
The final58 focused tests and TypeScript build passed. Independent review GO
followed corrections to diagnostic attribution; raw output and exact source
hashes are retained in verification.json.

## Page-size assessment — no page-size change adopted

The retained forward sample measured48 completed100-row pages with median187ms,
p95523ms; ten completed1000-row pages with median948ms, maximum1385ms and median
787ms after headers. Seventeen unavailable audit targets included12 no-header
stalls and five HTTP200 partial bodies of185–241KB against the1.5s physical
limit. JSON decoding was at most0.972ms for completed large pages. These
observations support a transfer-size question, not invented500/750-row latency.
Connection reuse was not instrumented; inherited fetch dispatcher was retained.

Eight500-row pages cannot cover4538 or5144 required signatures: maximum4000
rows, or3600 when an initial100-row page consumes one of eight requests. Smaller
pages cannot resolve the twelve no-header stalls and can increase query demand.
For5144 signatures, even ideal ordering needs at least11x500 or7x750 requests;
actual history must also reach strict fences and can require more.

With five quiet peers, six10s assessment buckets/minute and a minimal six
coherent ceiling refreshes plus six heartbeats/minute, one5144-signature pool
implies at least108 physical operations/minute with500-row pages,84/minute
with750-row pages, or78/minute with1000-row pages and an expanded page cap.
These are arithmetic lower bounds, not measured provider capacity. They exclude
migration verification, replacement/retirement, retries, held-position pricing
and safety headroom. At the research90/minute ceiling,750 would leave at most6
operations/minute for all those obligations; it already exceeds60/minute.
Multiple simultaneously busy pools increase this shortfall. The existing
four-page1000-row audit also cannot certify arbitrary5144-signature targets.

No500/750-page experiment, timeout extension or extra request was performed.
The next forward interval should first use the bounded attribution trace to
identify real wait reasons. A future transfer-size component measurement must
measure actual response latency/bytes and complete-query demand; neither a
smaller page nor HTTP batching grants entitlement or removes logical queries.
All successful-transaction completeness requirements remain intact.
