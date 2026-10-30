# Native candidate-only integration

This is an isolated finite research runner, not a trader or a deployment to the
original observer. It opens no ledger, creates no financial account, requests no
quotes and cannot submit transactions. Predictive thresholds remain unchanged.
Its source contract is explicitly `confirmed-program-events-v2`: executed
program-event amounts/users/fees and true log identities, without claiming full
compiled-instruction or SPL-transfer checks for every notification.

Wiring: existing free migration discovery → bounded origin verification queue
256 → existing WATCH registry174 (150 recent +24 selected older) → up to6
pool-filtered confirmed subscriptions on one WebSocket → six closed10s buckets
→ bounded independent pool-signature audit → feature-only predictive assessment
at its real availability time. Retained strong candidates are assessed at every
new completed10s bucket, not at a60s substitute cadence. Failed/unknown events
invalidate observations.
Actual entry age remains5–120min; earlier/selected older observations confer no
entry eligibility. Weak audited candidates return to WATCH; the existing broad
PumpApi WATCH-hint connection is preserved, without old selected enrichment.

The explicit first research profile is900s (maximum1800s), at most1500 physical
units and256MiB related responses. Gate remains60/min,20/10s,250ms and one physical
operation. PumpApi WATCH receipt is independently capped1GiB. Required selected
compact evidence is retained in8MiB segments under128MiB total; no broad archive.
CPU240s/RSS384MiB and finite storage/queue/payload/source-time controls apply.
These are ceilings, not verified six-pool sustained capacity or provider rights.
The first rolling audit profile uses one complete1,000-row history page per
candidate per10s, a1.5s physical timeout and2s complete-processing envelope. A
truncated history remains capacity-unknown. Six sustained candidates project36
audit requests/min plus6 shared Clock ceilings and6 heartbeats =48/min; only12
starts/min remain for verification/recovery/discovery controls. Slow responses,
1000-row saturation or outages can reduce the supported workload. No held-position
workload is included in this candidate-only envelope.

Build and run as a nonroot owner of a private0700 parent directory:

```sh
npm run build
npm run compile
node dist/src/run-native-candidates.js --run --input /private/public-input.json --directory /private/new-run --duration-seconds 900
cat /private/new-run/status.json
```

Input contains `schemaVersion:1`, linked existing `baselinePaths`, verified prior
settlement/cooldown, reviewed `source:{commit,sha256}`, genuine public
`originConfirmed/originFinalized` transaction proofs, and optional exact
`reportingBinding:{accountId,inceptionAt,sourceStatusSha256}`. No credentials or
financial database is accepted or required. All imported identities are decoded
again and fresh current SDK/Clock support is mandatory. Older selections require
real recorded scheduling activity; they never widen entry age. EC2 packaging must
bind these source hashes to the exact reviewed bundle before dispatch.

Graceful stop: create `stop-request.json` in the run directory or sendSIGTERM to
that process. The runner records logical cutoff, stop and physical settlement;
all transport receipt remains counted. It does not invent liquidation. For a new
segment, preserve all old directories, link final `appendOnlyCounterPaths` and
cooldown into the next input, and supply checkpoint `watch` plus its genuine
`origins`; use a new run directory. Restart invalidates old market context and
warms a new complete window. Never copy or reseed financial state.

Status is atomic every15s, independent of any publisher. Reporting must use this
run's actual source/run/timestamps and separate experimental identity. No
financial balances are fabricated. A publisher heartbeat is not market freshness.

Two-hour operation is not enabled by this profile: embedded cumulative starts
would exceed the current128KiB counterbook bound at the projected request ceiling.
That accounting-format change requires separate review and tests, not a silent
increase. Six scopes with sustained busy traffic and independent audits remain a
forward capacity question; existing one-poolEC2 evidence is not that proof.
