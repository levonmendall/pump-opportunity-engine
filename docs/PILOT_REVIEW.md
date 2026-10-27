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
