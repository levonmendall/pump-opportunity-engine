# Initial PumpPortal measurement core — not a funded run

src/feed-measurement.ts is a small offline measurement/control projection. It
opens no socket, loads no key, creates no wallet or account, writes no ledger,
funds nothing and cannot enable entries. Actual selected-token authentication,
field mapping, subscription behavior, charges, coverage and sustainable capacity
are still unverified. No 24/72-hour acceptance interval starts from this module.

## One bounded experiment

The proposed adapter uses the existing single shared WebSocket. Before a selected
token subscription, inject a fresh public balance for the existing approved
billing address 6BajxF2CSXTCv5F1HdYH9SFNkqJT94AMW9cCfUq8sSTQ and fresh SOL/USD,
plus remaining approved budgets and actual requirement-based paid-monitoring
reserves. Do not multiply a per-token paid reserve by every held position: the
current rule uses RPC liquidation/cost/time exits, with no holding-flow feature.
Only a separately justified initial handoff/future flow-dependent rule can need
paid held-flow allowance. RPC protection capacity remains mandatory. The core
rejects a different wallet address, future/stale valuations, raised caps and a
selected token already held. Verified pool identity must come from the real RPC
integration, not a symbol. The caller must separately establish key/wallet binding;
this module never receives the key or full recovery bundle.
Wall receive times are retained for records, budget days and freshness checks;
durations/rates use performance.now() by default. Offline tests inject a separate
monotonic clock. A wall-clock jump cannot fabricate 60 seconds or dilute cost rates.

The experiment admits one selected token, lasts at most 120 seconds, and requests
upstream unsubscription at 1000 potential billable events. It reserves an additional
100 events for in-flight delivery/unsubscription/billing uncertainty. It does not
pretend local discards prevent provider charges. Frames received after the stop
request continue increasing usage and estimated costs; exhausted headroom is an
explicit critical state, not hidden overflow. The caller must actually unsubscribe
the measurement token upstream without closing discovery or held-position access.

The wallet floor remains0.02 SOL. Approved caps remain0.01 SOL/day,0.04 SOL total,
also $2.50/day / $10 total whichever binds. Existing held-monitoring reserves come
before new observation when such paid capacity is actually required. Settled
holdings need tested RPC capacity rather than an automatic paid trade stream.
If required held capacity is insufficient, new admissions pause
and an authorized RPC protection fallback is required. This measurement component
does not alter held subscriptions or authorize spending beyond a limit merely
because positions exist.

The explicit control projection distinguishes heldTradeFlowRequired=false from
heldFullSizeRpcMonitoringRequired. See OBSERVATION_DESIGN.md for candidate flow,
holding protection, budget-loss cancellation ordering and the matched three-way
comparison; no field or budget verification is implied by these requirement flags.

Admission reserves the full planned experiment plus headroom, using the
documented provisional 1000 lamports/event and current SOL/USD. USD event estimates
round upward per event; future reserves use the same rounding. The full wallet
reserve is deliberately conservative even if some experiment charges have already
settled. This is a reservation, not a second cost. The only reported experiment
cost is the sum of potentially billed events once. Prices must remain fresh
within 10 seconds; wallet observations within 30 seconds. If a price is missing when
a message arrives, that message's USD cost is unknown rather than a later price
silently inserted into its history. A stopped experiment cannot silently resume.

## Caller contract and spending limits not yet proved

MeasurementBudgetProjection supplies remaining authorization **before this
experiment's local estimates**, excluding this experiment from external spent
counters. Do not feed a projection that already deducted the same local estimates.
The caller owns durable daily/total spending, other usage, UTC rollovers, prior
experiments and settlement. The core stops at a UTC day boundary and refuses a
new admission when less than 60 seconds remain. It provides no cross-restart budget
authority. Correct durable wiring and actual billing granularity are prerequisites
before this can support autonomous entries or acceptance operation.

Budget/floor checks are estimates from injected observations, not a guarantee of
provider charges or bounded in-flight traffic. A funded run must verify actual
granularity, stop/unsubscribe behavior and worst observed event rate. Report the
measured minimum viable budget and obtain approval if the existing caps cannot
sustain required observation; do not loosen caps or quietly shrink coverage.

## What the recorder measures

Every raw message supplied to ingest is counted before JSON parsing, duplicate
detection or discard. A JSON array conservatively counts at least its elements
before being flagged unsupported. Malformed and oversized frames still count;
their true provider granularity remains unknown. Counting every shared-socket
frame can overestimate charges by including control/free discovery messages;
that is disclosed rather than labeled actual billing.

Only bounded field names and JSON types are inventoried; no field values, full
payloads, signatures, wallet keys or error text are exported. Duplicate detection
is signature plus exact raw payload equality. Signature repetition by itself is
recorded separately and is **not event identity proof**. No instruction/event
indices are invented; fieldContractVerified and featureWindowReady stay false.

Per-selected-token frames/bytes/trade-like messages, aggregate potential event
rate, gaps/reconnects and longest uninterrupted acknowledged-subscription time
are reported. connected() represents a fact supplied by the real socket adapter;
it is not authentication. acknowledgeSubscription() may be called only after an
actual validated response. The caller must report disconnects, dropped evidence
and failed heartbeat/health checks using gap(). Separate intervals are never added
together to claim a continuous 60-second window. These transport facts do not
prove feed coverage, identity completeness or usable strategy inputs.
observationWindowComplete describes only the current uninterrupted interval;
completedObservationWindow retains whether one earlier interval reached 60 seconds.
Neither flag makes featureWindowReady or fieldContractVerified true.

Rate projections use acknowledged subscription time within the bounded active
experiment, excluding pre-ack/outage/post-stop idle. Raw connected wall time is
reported separately. In-flight events after a stop still increase cost/rate
numerators without allowing an unlimited idle denominator to hide their burden.
They state
whether a full 60 seconds would fit the event ceiling at the observed mean. Failure
pauses new admissions; the current selected observation continues only within
its declared caps. It does not repeatedly disconnect to manufacture completeness.

All costs are **estimated**. The native wallet balance delta is shown separately
and is not attributed to charges because transfers or other usage may explain it.
Actual provider charges remain unknown until billing evidence establishes them.
The PAPER trading account and its $1,000 virtual capital are unrelated to these
real operating funds. No economic P&L is computed by this core.

## Synthetic offline capacity evidence

Reproduce without replacing the recorded result:

```sh
node --import tsx scripts/offline-capacity.ts /tmp/poe-capacity-replay.json
```

`evidence/offline-capacity.json` records a 3.91-second actual harness run on the
Codex workspace. A disposable Recorder file contained 8,712 normalized rows
(8,640 unique synthetic trades, 72 duplicates), 12 candidates and 72 seconds of
invented receive times. Replay preserved those availability times. Each run
completed 96 exact feature-oracle checks, including 36 sufficiently warmed
windows, and all 96 rule decisions refused unverified feed fields.

Paced runs completed about 3,025, 12,079 and 48,289 rows/second; their completion
delay p99 values were 1.34, 1.79 and 2.04 ms. The unpaced finite burst drained in
40.20 ms. Every backlog finished at zero; the thirteenth candidate was refused.
Observed logical state peaked at 700 active/pending trades and 720 identities
per candidate. These usage() counts exclude stale deque prefixes and historical
trades referenced by dedup identities; they are not a physical object-memory
bound. The 72-second input does not exercise 120-second identity pruning. CPU, event-loop samples, sampled memory and the
exact input/source hashes are in the evidence.

These short synthetic results measure normalized parsing and completed feature
work, excluding initial capture/flush/loading, SDK startup, network, actual feed
fields, pool quotes, ledger writes and dashboard reporting. The runs share JIT/GC
state and are not production EC2 measurements or sustained-capacity bounds.
Synthetic time does not establish elapsed unattended operation, provider coverage,
budget sufficiency, trade execution or any acceptance gate.
