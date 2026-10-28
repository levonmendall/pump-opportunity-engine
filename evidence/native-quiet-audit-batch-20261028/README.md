# Quiet first-page audit batching and bounded busy continuations

**Implemented and verified offline; not yet forward throughput or PAPER acceptance.**
This builds on the existing public-RPC batch transport, not a new data provider,
queue or accounting authority. The prior actual component returned six100-row
queries in one136,111-byte/140ms HTTP response. That sample proves acceptance
of that request only; the timing fixtures here do not predict future latency.

## Change

The native runner may combine2–6 independently ready100-row first pages for the
same closed target into one HTTP envelope. It selects the oldest ready work
first; a busy continuation is never skipped merely to form a quiet batch. Each
existing session retains its own immutable notification snapshot, generation,
slot fences, independent history comparison, original availability and deadline.
Busy1000-row pages and all continuations remain separately scheduled. A full
small page still escalates only through the existing fresh pagination logic.
No confirmed or finalized cached prefix is substituted for fresh evidence.

The PilotRpc wrapper uses the same physical gate, request/byte caps, pacing,
provider backoff and uncertain-operation accounting. It records **N logical
queries separately from one physical HTTP start**, including while the response
is pending. Query cooldowns use both clocks; a cooling peer is excluded without
deleting its own pending target. Ordinary item errors or malformed history rows
fail only their own session. An unscopable envelope, shared HTTP failure or actual
provider overload cannot be relabeled a successful sibling census. A candidate
retired during an already-started batch does not abort the other sessions.

The aggregate decoded response cap is512KiB. Every received chunk is charged
before crossing-cap refusal; unfinished physical work and its2MiB uncertainty
remain owned until actual settlement. The global2MiB and accounting/storage/
diagnostic safety failures remain fatal. A fault specific to the smaller batch
optimization disables batching for the rest of the run and invokes bounded
shared RPC recovery; ordinary individual pricing/history work can then recover.
There is no automatic retry of the failed batch/target. This avoids making an
optional candidate optimization a permanent failure of open-exposure pricing.

PAPER's scheduled wrapper forwards batching through the same requestOptions/
lowerView financial-deadline and resource admission checks as individual calls.
This is wired runtime code, not a fixture-only path. No pilot account was opened
or enabled by this implementation; existing disposable financial tests were reused.

## Six-page ceiling and limitations

The native audit profile now permits at most six pages. The standalone reader
and session still default to four unless explicitly configured. Every physical
page retains its1.5s timeout,2s declared completion envelope and actual-start
admission; the whole audit must still finish inside the original9.999s decision
bucket with full strict fences. Six2s bounds do not fit9.999s: the ceiling is
opportunistic, never a promise that all six pages can be served. A late or
unservable continuation stays incomplete/unavailable. No rate, unit, response
allowance, decision deadline, strategy threshold or quote-validity rule increased.
Initial100 plus five1000 pages covers at most5,100 rows; this does not certify
an arbitrary5,144-signature range. Initial1000 plus five1000 can cover6,000 rows,
subject to lower fences and actual time/capacity. Six simultaneously busy pools
are not shown supportable.

The explicit synthetic fast-response fixture completes one >5,144-signature
busy target and five quiet peers using six individual busy requests and one
five-query quiet batch. The slow1,500ms case completes quiet peers but misses
the busy target's deadline; it remains a measured failure of that synthetic
workload. Neither result is provider performance or natural market coverage.
Actual control/financial contention and sustained resource use still require a
source-pinned combined forward interval. Batching saves physical starts/pacing,
not logical queries or guaranteed API/bandwidth cost. Full-denominator byte
volume remains necessary under the current data contract.

## Verification

**216 focused tests, TypeScript build and compile passed.** Raw output, command
arguments and exact source hashes are retained in verification.json. Coverage
includes six-way per-item outcomes, cancellation/retirement, query cooldowns,
pre-admission retention, fair busy continuation, slow deadlines, disabled-batch
fallback, actual shared-gate physical timeout/late429/503, body overflow, strict
identity binding, fatal hard/storage/diagnostic failures, existing chapter/rate
controls, and disposable PAPER execution/recovery/management reserves.
Independent review GO followed two corrected findings: declared sizes above2MiB
must retain the hard-limit failure, and failure to persist/record the disabled
state must remain fatal.

An initial test fixture repeated scheduler turns without advancing its fake
clock after a batch; the existing250ms shared spacing correctly prevented the
next individual request. The fixture now advances that clock explicitly. A
short-lived six-page fixture-edit syntax error was fixed before verification.
No production limit or safety check was changed to make those fixtures pass.

No new network request, source change during an active forward interval,
financial-ledger access, production deployment, signing or transaction operation
was performed here. Root must integrate the separately reviewed wrong-domain
runway/flow-action fix and run the full suite before freezing the next executable.
