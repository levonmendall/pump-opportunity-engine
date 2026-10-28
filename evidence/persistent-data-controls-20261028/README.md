# Persistent data controls — isolated implementation

`3755b13728e3443a8f5070f782e32073aef4eee7` adds explicit `persistent:true` to the existing public read-only adapters. No account/ledger, wallet, credential, network or deployment operation was performed by this implementation.

Service data capture no longer ends because a finite research duration, total request/byte allowance, 64-chapter limit, cumulative native CPU counter, evidence byte count, or nine-reconnect count is reached. The finite research modes keep their existing behavior. This is an operating-mode implementation, not a claim of unattended EC2 acceptance or provider entitlement.

## Retained hard contracts

- One physical operation gate, actual cancellation settlement, durable reservations and all inherited uncertainty remain authoritative.
- Existing rolling request pacing and method limits, per-request timeouts, per-response/payload bounds and provider Retry-After remain in effect. History-only PublicNode routing and separate cooldown domains are unchanged.
- Quote/source/market clocks, complete fresh observation windows, event identities, amount/trader rules, correction handling and independent audits are not weakened.
- Native memory pressure invalidates affected candidate windows and pauses native recovery. It does not terminate the financial manager. Recovery requires actual transport settlement, fresh support/ACK and a new complete window.
- These modules remain account-agnostic and cannot initialize or execute financial actions. The lead integration owns the one authoritative financial writer and identity binding.

## Accounting epochs

The existing ComponentBudget still bounds physical work and records every actual receipt. In service mode only, `continuousAccounting:true` makes chapter byte values accounting rollover targets rather than a cause to abort an otherwise healthy HTTP request while passive WebSocket bytes arrive. The current physical owner remains held; a simultaneous request is refused. The two-MiB per-response limit remains hard. Once the physical operation settles, the wrapper can close the chapter and open the next, carrying all actual/uncertain usage and rolling starts.

The wrapper compacts its hot anchor chain after32 closed inputs with the existing checkpoint implementation. New schema2 explicitly records `physicalTransportsSettled:false` and `passiveStreamsMayRemainOpen:true`: it is a synchronous, quiescent **budget accounting** boundary, not a fabricated claim that healthy notification sockets closed. All old raw books, summaries, hashes and uncertainty are retained. The hot chain is bounded; cold accounting history remains durable and subject to the service's real disk policy. No usage is refunded.

Integration must persist `recoveryBaselinePaths` (closed anchors only) and `recoveryBaselineCheckpointSha256`. `activeChapterPath` is separate and may be linked only after a crashed/stopped owner is known physically settled. New checkpoints are `operating-checkpoint-000001.json` under the existing run RPC directory; chapter numbers may grow beyond three digits. The service must not union a stale pre-checkpoint prefix back into a later compacted chain.

## Rolling transport pressure

A bounded one-second-bucket window retains at most61 buckets for60s. Local receipt controls are64MiB/min for selected native data,128MiB/min for the broad watch stream and2MiB/min for migration discovery. They are conservative resource guards, **not advertised provider quotas**. The preceding EC2 interval measured approximately1MiB/min selected native data and60MiB/min broad watch data; normal observed traffic is below these controls.

Every received byte is charged before filtering. A real rolling excess pauses only the affected transport until conservative bucket expiry; it records the interruption and invalidates affected selected evidence. Discovery and selected native data are separate failure domains. Backoff remains bounded and paced, with actual provider cooldown taking precedence. A lifetime byte total does not close a healthy service stream. Recorder ownership/rotation and process-level rolling CPU/disk controls belong to the integrated service.

## Offline verification and limits

The expanded component/RPC/native/feed/checkpoint/window regression completed212 tests. A final RPC-only run completed50 tests after adding the assertion that an accounting-boundary crossing cannot create a parallel physical gate. TypeScript build passes. The retained initial negative fixtures include an intentionally planned disconnect (which must remain visible) and a real stale-program-clock rejection after a synthetic time jump. The corrected test does not admit stale historical trades: it checks live receipt/volume handling at the original valid time and later verifies that a new candidate receives a new support read after the research lifetime.

No forward provider, actual EC2 long-run, PAPER fill/exit, financial recovery or persistent host-start claim follows from these offline results. The combined lead source still needs full regression, original-account-preserving integration, persistent host supervision and real sustained validation.
