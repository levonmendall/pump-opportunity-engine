# Reporting cadence and completed preparation recovery

## Observed failure after the source069 installation

The owner installed `06995e21eb6a6975377de8c970be230fc698c957`. The root completion
receipt verified the exact package and preserved account, financial epoch,
financial history, and market-registry history at 2026-11-01 23:57:11.040 UTC.
A real selected subscription was sent at 23:59:06.865 UTC and acknowledged at
23:59:06.956 UTC. PAPER entries were then enabled, with no current entry blocker.

The subsequent read-only acceptance attempt found that both EC2 public status
and the receiver stopped advancing at sequence26602, generated at
2026-11-02 00:01:40.386 UTC. The runtime service remained active. The operating
check correctly failed `SOURCE_OR_RECEIVER_NOT_CURRENT_AT_OBSERVATION`.
Installation success therefore did not establish continuing operation.

The existing supervisor later started a new child process at 00:05:11.568 UTC.
A public observation at 00:13:19 UTC confirmed fresh source reports from that
new process. No agent-issued restart or altered administration guard was used.
That recovery does not remove the defect that caused the reporting interruption.

Exact observations and root-receipt hashes are preserved in the private
administrative repository under
`operator/subscription-readiness/releases/06995e21/activation-verification.json`
and acceptance run41364598247, attempts1 and2.

## Report admission uses a complete measured work interval

The old admission estimate took the larger of the maximum complete scheduled
report and the sum of lifetime per-phase maxima. Startup records phase timing
but does not record a scheduled whole-report duration. Adding phase maxima from
different publications therefore allowed a cold startup observation to determine
every later reporting reservation.

The captured source measured:

| Measurement | Milliseconds |
| --- | ---: |
| Startup candidate-status peak | 7858.267264 |
| Sum of lifetime phase maxima | 8155.935410 |
| Maximum complete scheduled report | 1307.997024 |
| Latest complete scheduled report | 1014.615121 |
| Existing local admission reserve | 250 |

The old estimate required8406ms. A connected stream's10,000ms heartbeat interval
can provide at most8375ms after the existing1500ms native operation and125ms
post-validation reservations. Consequently that report could never be admitted
while the stream remained connected, despite the measured complete operation
fitting the available interval.

The corrected estimate uses phase maxima only until a complete scheduled report
has actually returned. Thereafter it uses the retained maximum duration of the
whole scheduled report, including candidate sampling and publication, plus the
unchanged250ms reserve. The captured example requires1558ms. An explicit
completion marker distinguishes an actual zero-duration measurement from an
unmeasured startup.

Lifetime phase diagnostics and the250ms performance target remain unchanged.
Invalid clocks, malformed measurements, and genuinely oversized complete work
still fail closed. The correction does not clip measured cost to a deadline or
change financial-action, candidate-service, or held-protection admission.

## Completed provider results survive a busy registry writer

The live source also showed completed preparation requests whose outcomes were
lost when market intake held the SQLite writer. A disposable fixture reproduced
this using a real second `BEGIN IMMEDIATE` transaction after the provider response.
The old runner repeated the provider lookup after the writer lock cleared.

The runner now retains at most one completed preparation result in its originating
source instance. It retries the atomic registry commit before optional housekeeping
and suppresses another preparation request while that result is pending. Required
native service remains eligible while the registry is busy. Only contention before
the transaction callback is retryable; callback and storage failures are not
replayed as successful preparation.

Before committing or adopting support, the runner rechecks work admission,
financial ownership, watch membership, mint and pool identity, source-slot floor,
and the original support and bank-Clock freshness. Expired or superseded support
is discarded. A stopped source cannot retain a late response. Outcome counters
advance once after a successful durable commit.

The result retains its actual completion and receipt timestamps. An absent-pool
outcome uses the original refusal time, so newer canonical pool or migration
evidence can still reopen it. No retry creates an acknowledgement, allocates a
slot before validation, rebases evidence time, or grants financial permission.

## Validation and activation boundaries

Regression coverage uses real SQLite contention for ready and absent responses,
and checks heartbeat progress, expiration, a raised slot floor, financial
ownership changes, closed admission, newer canonical hints, callback failure,
and source stop. Reporting regressions replay the observed admission conflict
and retain invalid-timing, pending-action, held-protection, and maximum-work
refusals.

The release must pass the complete application and reporting suites, actual
disposable executable smoke, installer regressions, and package-pinning checks
before inert EC2 staging. The source-pinned root approval remains the owner
activation boundary. New operating acceptance must use fresh reports from the
new source and distinguish installation, audited progress, and actual PAPER
fills. No trade is forced to make a readiness check pass.
