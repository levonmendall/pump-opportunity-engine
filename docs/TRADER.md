# Offline trader integration

`PaperTrader` connects the existing normalized feature/rule core and delayed
execution coordinator to the **same** `PaperLedger` instance. It is not connected
to the production raw-feed adapter or deployed observer, and does not initialize
capital, read credentials, submit transactions, enable entries or start an
acceptance interval. Current production PAPER entries are also refused because
the rule version is explicitly unfrozen. Disposable tests may exercise the full
pipeline with clearly labeled synthetic verification/readiness evidence.

The inputs are a verified migration/pool identity, explicit subscription activation,
normalized receive-time trades, current timestamped USD/actual-size net liquidation,
and a size-specific quote adapter. The field-verification contract defaults false.
Actual managed-feed fields, fee conventions, instruction/event identity, continuity,
coverage and sustainable billing capacity still require measurement; tests do not
establish them. The engine does not infer missing trades or independent buyers.

At most 12 candidates and 50 recent decisions are retained. Normal ingestion updates
the incremental `FlowWindow`; quotes and financial evaluation are scheduled separately.
Recorder failure may close entries as described below. Candidate evaluation is
coalesced to one pass per closed bin of 10 seconds. Its complete 60-second window
may need up to 70 seconds after an unaligned activation.
Explicit supported activation is required; elapsed time without a subscription
cannot warm a candidate. Feed gaps invalidate windows and close entries. A reconnect
needs fresh activation and a complete new window; it does not replay an outage.
The outer runtime still supplies a bounded periodic management/evaluation cadence;
`nextDueAt` adds pending-order deadlines and is not the entire scheduling policy.

Each tick obtains context for held positions, reconciles known equity, handles
existing pending actions, and evaluates held-position exits **before** candidate
quotes. Unknown liquidation closes new risk. Supported actual-size RPC estimates
and delayed exits may still manage positions when flow or USD is unavailable.
A holding-time limit or stop requests a quote/order; missing state cannot close a
position, invent a stop price, or discard an unresolved action. Financially uncertain
reservations remain preserved while entries are paused, even through a feed gap.
After any awaited estimate, newly due actions are serviced before further quote
work. Proposal deadlines are capped by the earliest pending execution deadline,
including other held-position exits. A new entry reservation yields immediately
to the scheduler. Lower-priority candidates cannot consume an earlier order's
execution window. Quote adapters receive frozen copies; returned mint/side/size
are checked against a separate immutable expected request.

Entry sizing reserves at most $50 of current USD equivalent including the explicit
simulated gas and refundable deposit commitment. Deposit remains an asset, not an
extra permanent fee. Pool fees/impact are embedded in the quote, gas is deducted
once by the ledger, and deposit refunds need explicit supported close evidence.
The same actual-size quote adapter is reused for proposal and the first delayed
attempt. Its input/output/mint/side/freshness must match exactly. Position count,
$150 aggregate cost, cash reservations, unknown marks and the sticky UTC loss pause
remain ledger-owned requirements. No rule/risk flag is automatically enabled.
A failed order is not retried. A later closed-bin evaluation may make a distinct
decision for a mint that never filled, with every prior failed-attempt cost kept;
this provisional policy must be frozen with the other rules before forward use.

Successful BUY commits now atomically create a `traded_mint:<mint>` marker in the
existing metadata table. `hasTradedMint()` uses its primary-key index, and BUY
reservation also checks it. Exiting, restarting or restoring a consistent backup
does not erase that history. A failed/unfilled order creates no marker. An invalid
marker blocks the affected risk rather than being treated as a fresh token.
This is new POE history; no legacy or fixture trade is imported to populate it.

The shared bounded recorder retains explicit configuration, normalized input and
receive times, sanitized context/quote observations, decisions, and execution
outcomes. The regression replays recorded normalized inputs through the same
engine and reproduces its disposable reservation/fill. The ledger remains the
durable financial authority. Recorder failure closes entries while preserving
supported management of existing exposure; it cannot be hidden as fresh data.

All market adapters are injected, abortable and deadline-bounded. An uncanceled
request blocks another physical market request rather than accumulating work.
No signer, wallet key, live trading endpoint, automatic strategy rewrite, or
second financial writer exists in this module. Full upstream adapter wiring,
this engine's deployed account agreement, real load/failure proving, frozen rules and genuine
elapsed forward acceptance remain separate work.
