# Forward repairs and actual limits — 2026-10-27

The two-scope forward sourcef8d7cd8 completed246.829seconds and verified the
recording repair beyond the original100-row boundary. It produced22audited
windows, but only3were in entry-age eligibility;3genuine predictive rejections,
zeroqualified/unfilled orders and no natural entries/exits.61.160seconds of
literal entry-control permission is separate from154.135candidate-seconds of
age-eligible collection (134.160distinctwall-seconds). Eleven swaps (7Buy/4Sell)
were validated;4pendinghints caused an explicit busy-scope capacity refusal.
That active window is unusable, even though the quiet windows succeeded. No
mapper failure or provider429 occurred. The configuration is inadequate for that
observed busy flow; unused average request capacity is not a deadline guarantee.

The next separately labeled source corrects observed selection timing: reject
fresh-window impossibility under the unchanged2h age limit, recheck actual socket
activation, retire expired entry scopes without discarding financial obligations,
and alternate ready new discoveries with recent eligible cached identities.
Transient backoff defers preparation rather than permanently excluding a valid
candidate. These are selection/recovery changes; primary entry/exit thresholds,
fees, actual-size pricing, source/quote validity and risk limits stay fixed.

The failed recorder source8c2a639 remains an incomplete adverse interval, with
its rawrecording,40newRPCunits and last-known stream lowerbound preserved. Its
failed final status projection is not replaced with fabricated performance.
All substantive results and full uncertainty are in the bounded evidence folder.

# Progressive validation — 2026-10-27

The temporary single-position contract remains immutable. Explicit stages now
permit shadow observation and two/three simultaneous isolated PAPER positions,
without changing the predictive strategy, order size, fees, quote validity,
exposure or daily-loss rules. Source changes are reviewed on the research branch;
no production installation or original-account entry enablement is included.

Offline composition passed one same-account lifecycle, backup, restart,
quarantined-exit expiry/recovery, two shadow candidates while holding, three
positions and three overlapping exits. Four fixture entries/exits reconcile with
56,000 modeled gas lamports and preserved locked rent. The synthetic adverse move
produces a loss and persistent daily-loss pause. Original retained low-liquidity
refusal is preserved; later concurrency mechanics explicitly change in-memory
liquidity/Clock/flow/USD. This is not natural forward trading or an economic edge.

The shared-policy replay retained these failures and limits:

| Synthetic workload | Measured simulated result |
|---|---|
| 3 holdings, 2 quiet candidates, 100-ms jitter | Peak47 starts/min; maximum2,100-ms evaluation gap; 8/8 selected transactions enriched; 12 usable overlapping windows |
| 3 holdings, 3 quiet candidates | One scope lacks independent audit coverage despite complete selected trade enrichment |
| Three-event bursts across two candidates | 18/72 enriched; 54 explicitly lost; zero usable windows; holdings continue at maximum2,100-ms gap |
| 4.5-second nonpreemptible operation | Protection fails:6,610-ms gap |
| Three-second processing overrun | Protection fails:5,200-ms gap; stale quote refused |
| Three fast pending actions | Complete actions; lose candidate coverage |
| Slow simultaneous actions | Two remain explicitly unresolved; no fabricated fills |
| Reconnect | Invalidate old windows; fresh warming can produce later usable windows |

These are rescheduling/stress simulations using the actual dispatch/admission
policies, not observations of endpoint entitlement or a full pilot-loop test.
Both target misses above2seconds and failures above the unapproved4-second
research boundary remain reported. Missing audit coverage blocks entry. Actual
source-time/quote-age validation is unchanged. No blanket five-second polling,
extra price screen, or strategy relaxation is introduced.

The narrow next forward workload is at most two active candidates under the
explicit two-position stage. Three-position accounting mechanics pass; live
three-position management and bursty multi-candidate capacity remain unproven.
Detailed bounded fixtures/replay are in `evidence/progressive-pilot-20261027/`.
The actual forward scorecard must be appended after the frozen run, including
entry-eligible time, all predictive rejections, qualified-but-unfilled orders,
coverage loss, actual physical usage and retained adverse outcomes.

## Historical review (retained)

# Isolated PAPER pilot review

Reviewed release: `f8bdf1e3945703756d35daf57f115d160ca80f52` (2026-10-27).
This was a static, read-only orchestration review plus offline fake-transport
tests. It did not inspect the production database, operate a wallet, deploy,
restart a service, or make provider requests. It is not operational acceptance.

The lead reports that the resumed pilot at this release began at 17:57:10 UTC
and that no feed HTTP 429 occurred in the prior or current interval. These live
facts were supplied by the lead; this review did not independently remeasure
them. Keep the running source frozen. The future-resume issue below does not
require interrupting this interval.

## Reviewed safeguards

- The pilot uses a private, nonroot Cloud directory and an explicitly isolated
  `poe-pilot-` account with its own inception. It has no Render publisher or EC2
  deployment path. Its RPC allowlist excludes simulation, signing and submission.
  The original observer, account and dashboard are outside this entrypoint.
- One physical request gate serves public RPC and free feed-control operations.
  Finite run and chapter limits retain cumulative calls, measured bytes and
  uncertain-response reservations. A caller timeout cannot release an unsettled
  physical operation. Requests are never automatically retried by `PilotRpc`.
- A durable in-progress marker is written before RPC/feed use. Crash recovery
  requires the global and financial leases, verifies that the previous PID is
  absent, links its counterbooks and preserves uncertainty before clearing the
  marker. Manifest replacement fsyncs both the file and parent directory.
- Normal completion clears the marker only after RPC and feed transports have
  settled. Unclosed feeds retain the recovery marker even when HTTP accounting
  closes successfully. Completed runs avoid a second financial stop action
  after their final backup/report.
- Independent history validation rejects omitted known trades, inconsistent
  slots/times/success, duplicates, malformed commitment and unavailable chain
  times. A missing event cannot be silently repaired into the original flow
  window. This remains a bounded confirmed pool-history check; it does not prove
  global coverage, receive-time completeness or universal finality.
- Held positions and due financial actions precede candidate investigation.
  Selected-flow gaps close entry risk while preserving holdings and pending
  exits. Marks require actual-size pricing and unchanged freshness checks.
  Finite stopping preserves open exposure explicitly; it does not invent an exit.
- Feed protocol/HTTP 429 failures are separated from public-RPC provider health.
  Feed-specific cooldowns do not disable unrelated holding quotes. Storage,
  accounting, clock and response-budget failures remain shared blockers.

Twelve focused `test/pilot-rpc.test.ts` fake-transport tests and scoped strict
typechecking passed before the run. Twenty existing scheduler tests also passed
after the final deadline guard. These checks establish software behavior within
their fixtures, not live provider capacity, economic performance or production
protection. The four-second completion-gap boundary remains experimental; quote
age at use remains two seconds and source age remains thirty seconds.

## Required correction before a later resume

`PilotRpc` records `controlCooldownUntil` in its status and chapter summaries.
`PilotFeeds` respects each leg's HTTP `Retry-After` plus the five-second reserve
within a running process. The pilot manifest currently preserves only the
public-RPC `cooldownUntil`; new feed legs initialize `notBefore` to zero.
Consequently, an immediate later resume after a feed throttle could forget an
unexpired Portal/PumpApi cooldown even though its counterbook is retained.

After the current run and all transports settle, preserve and restore either
each feed's deadline or a conservative aggregate control deadline across both
graceful completion and crash reconciliation. Keep it separate from public-RPC
cooldown so held-position pricing remains available. Add focused stop/resume and
crash/resume tests proving that controls wait through the retained deadline while
HTTP pricing continues, with no counter or uncertainty reset. No source change
or additional network attempt was made for this documentation update.

Reviewed source SHA-256:

| File | SHA-256 |
| --- | --- |
| `src/pilot.ts` | `d271288c55a15c0b6ffd723d9fbe0a794be7b132f15c794ced6bcd6a3c4a1cd6` |
| `src/pilot-rpc.ts` | `f7cb4b4639c7fd3568f1b25f6b447a7b9891919f8621862052de4360666c4d52` |
| `src/pilot-feeds.ts` | `d71a48179961c06e71c67ae52d9fdebab11947256e4f3585adbdf391e0bd398e` |
