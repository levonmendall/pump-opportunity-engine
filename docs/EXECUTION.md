# PAPER execution coordinator

`PaperExecutionCoordinator` consumes the runtime's existing `PaperLedger`; it
never opens a database, initializes capital, enables entries or calls a signing,
trading or transaction-submission endpoint. It is not wired into the deployed
entry-blocked observer yet. All execution tests use disposable state. A completed
fixture lifecycle is not a natural trade, deployed gate or profitability result.

Startup calls `recover()` once. This durably closes entries and cancels obsolete
entry reservations. Recovered SELL reservations remain unresolved with their held
positions intact. They are quarantined, receive no later quote, and may only
expire without a fill. After expiry, a separate supported management rule must
make a new decision using fresh actual-size state. Nothing silently closes or
forgets exposure. An interrupted financial commit also quarantines its pending
action, prevents re-quoting it and blocks new entries until resolved/expired.
Terminal-expiry writes that continue failing use a finalization backoff of one second;
they never spin on a past expiry or discard the unresolved action. If an indexed
durable outcome exists despite an interrupted return, that outcome resolves the
uncertainty without another debit or quote.

The strategy supplies an explicit order with decision time, modeled delay,
expiry, size/price constraint, gas and deposit. Ledger rules enforce at least
500 ms delay, expiry within 30 s, $50 initial commitment, three positions/$150 cost,
cash reservations, sticky daily loss pause and fresh readiness. The coordinator
does not weaken or automatically satisfy those checks. The caller must schedule
the returned `nextDueAt()`; delayed polling does not establish low-latency fills.
Future-dated and already-expired decisions are refused before any reservation or
financial clock change; an adapter cannot make future information available early.

`runDue()` handles existing due actions once, prioritizing SELLs. Concurrent calls
share one in-flight drain. It obtains one timestamped USD/actual-size-mark context
and one size-specific quote under a single bounded preparation deadline, capped
by expiry. No SQLite transaction crosses the asynchronous adapter calls. The
quote and context adapters must honor AbortSignal. A timed-out adapter that has
not actually settled blocks additional adapter work and new entries, rather
than creating a growing backlog. While blocked, nextDueAt returns pending expiry
instead of a past execution time, preventing a scheduling busy-loop. The optional
onAdapterSettled callback wakes a coalescing scheduler when that timed-out request
actually settles; otherwise the runtime must use a bounded periodic health poll.
The wake performs no execution or entry enablement. Late favorable results are ignored.

The supported quote layer must provide fees/impact at the actual order size and
retain when its information became available. A BUY quote includes pool fees in
`spendLamports`; a SELL quote returns proceeds after pool fees/impact but before
the separately modeled gas. SELL `pricedBaseUnits` must equal the entire held
quantity. A refundable deposit remains an asset locked in account custody and
is refunded only with explicit supported close/refund evidence. Never deduct a
pool fee twice or treat a reserved amount as another asset.

Gas is an explicit simulated base-plus-priority assumption supplied in each
order, not a live fee quote. Missing/stale first-attempt state and failed price
constraints finalize once under ledger policy; no favorable retries. Missing USD
or closed entry risk cancels BUY before modeled gas; expiry before finalization
never fills or charges an execution attempt. An actual-size SOL exit may proceed
when USD valuation is unavailable; USD equity remains unknown until reconciled.
Stops do not guarantee price or exit availability.

Stable `execution-attempt:<orderId>` action IDs are persisted in the same ledger
transaction as the financial outcome. `recordedOutcome()` uses the existing
actions primary-key index through the small read-only `actionResult()` method;
its result is independent of bounded journal/export windows. Looking up or
mutating a returned copy cannot produce another quote, debit, fill or revision.

Before production integration, verified selected-token fields, budget capacity,
supported pool/actual-size quote adapters, entry/exit rules, restart management,
cost sensitivity and fresh reconciliation must all be connected and tested.
Current live trading remains disabled and no acceptance clock starts here.
