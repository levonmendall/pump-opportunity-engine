# Isolated experimental PAPER pilot

This launcher is a Cloud research process. It does not replace the EC2 observer, open its account, publish to Render, load wallet credentials, or submit/simulate Solana transactions. The owner explicitly authorized simulated entries only in a distinct `poe-pilot-*` account. There is one ledger writer. Financial history lives outside the repository in `/workspace/poe-pilot`, with private file permissions.

## Wiring and frozen behavior

Free PumpPortal migrations are identity hints. Confirmed executed migration/create-pool evidence establishes actual base/quote roles; the original creation is rechecked at finalized commitment. Unsupported or unknown origins refuse entry. Current SDK pool/mint/vault/config/fee support and current rent are read separately before flow admission. A no-op migration retry never establishes inception or entry age.

One selected candidate receives PumpApi signature hints and confirmed transaction enrichment for every selected signature. Curve SOL amounts, actual trader roles, transfers, fees, and instruction/event identities come from executed evidence. Six closed ten-second bins form the unchanged sixty-second primary window. Enrichment must become validated information within five seconds; later information never moves backward in time. Unsupported events, loss, overdue work, or failed bounded independent history checks invalidate the window.

`persistent-buying-pilot-v1` freezes the current provisional rule: age5min–2h, net buying≥1SOL, at least4positive bins and5buyer wallets, largest buyer≤35%, nonnegative price structure, and order/liquidity≤5%. Different addresses are not independent people. The price screen previously rejected by the owner is absent. Quotes are deferred only when the existing predictive conditions already reject.

The account initializes once with $1,000 virtual capital converted to SOL using a timestamped public Coinbase SOL/USD observation. Maximum initial commitment remains $50 including execution costs and rent; the initial pilot permits only one position, without adds or re-entry. The $150 aggregate and $50 UTC daily-loss rules remain. Actual required account rent is locked capital, not a fabricated fee/refund. Simulated gas is7,000lamports per attempted order; pool fees and impact are already included in integer SDK prices. Entry/exit orders have a1sdelay,5sexpiry and1%slippage constraint. There is one first eligible modeled attempt, with no favorable-quote retry.

After a fill, candidate enrichment stops. Holdings use actual-size coherent Clock/account SDK prices at a2starget; exits remain15%stop,30%profit and15minmaximum hold. Quote age at actual use is≤2s; source age≤30s. The experimental completed-evaluation operating boundary is4s, allowing one bounded nonpreemptible operation plus dispatch/validation around the2starget. A breach is disclosed and closes new risk; this boundary is not approved production risk tolerance or a stop-price guarantee. Failed pricing retains exposure and reports unknown marks. Existing positions and unresolved actions precede discovery.

## Commands

From the repository:

```sh
bash operator/pilot.sh start --directory /workspace/poe-pilot --duration-seconds 1800
bash operator/pilot.sh status --directory /workspace/poe-pilot
bash operator/pilot.sh stop --directory /workspace/poe-pilot
bash operator/pilot.sh resume --directory /workspace/poe-pilot --duration-seconds 1800
```

`start` reopens an existing valid account; `resume` requires one. Neither reseeds. A graceful stop closes admissions and cancels unattempted entries, retains holdings/pending exits, creates a consistent backup, and records monitoring interruption. A stopped process does not protect open exposure. Resume restores held pool identities first, quarantines unresolved exits, refreshes current marks, and warms candidate windows independently. Never remove the ledger to make startup pass.

Each finite run allows≤30min,1,500shared request units,32MiBrelated responses,1GiBPumpApi traffic,5MiBmigration traffic,14MiBevent evidence,384MiBRSS and240CPU seconds. The launcher sets process CPU/file/descriptor limits; the process monitors memory/disk and source changes. One physical gate enforces250msscheduling spacing,60starts/min and an explicitly recorded10or20/10s research burst setting. Those are local safety limits, not provider entitlement. Retry-After and bounded cooldown take precedence. Historical actual/uncertain usage is linked, never reset; every new run has finite allowances. Unsettled physical accounting blocks a later run until reconciled.

No new exposure is admitted without at least910sremaining runtime,490request units and6MiBresponse reserve. The first workload is one candidate **or** one holding; it does not promise the failed simultaneous broad workload. The broad stream is filtered immediately and never archived. API fees are$0; Cloud/infrastructure/transfer allocation remains separately uncertain.

`status.json` is a replaceable local read model; `runs/<run>/events.ndjson` retains selected evidence/decisions and `result.json` the interval outcome. `ledger.sqlite` is the sole pilot financial authority. `backups/` retains two consistent SQLite backups through the existing backup API. These files are never sent to Render.

## Later production handoff — not executed

Before any EC2 release: review the frozen contract and measured pilot failures; verify bounded nonroot EC2 resource compatibility in a separately authorized shadow test; check installed schema/account compatibility; test backup restore; prepare a single-writer account-preserving switch and a position-capable rollback. Reconcile original reservations/positions and preserve original inception. The installed observer cannot be a management rollback once a later trader holds positions. Production installation/entries require separate authorization. A Cloud pilot is not24/72h unattended acceptance, EC2 capacity evidence, or proof of profitability.


## Repaired observation admission

After the recorded fourteen-hint burst, the next research interval uses20combined starts/10s while keeping60/min,250msspacing andonephysical operation. Current official public-RPC documentation lists higher limits but explicitly gives no guarantee of current capacity. Preparation is drained until15short-window and20minute starts are available before opening a candidate feed; this is a capacity warm-up delay, not a predictive screen. A fourteen-event burst still fails the five-second deadline with sufficiently slow responses. Such windows are invalidated, not sampled.

Feed reconnect backoff is respected before spending candidate-preparation requests. Passive bytes remain counted after an internal accounting chapter expires; only a later request rolls a settled chapter. The overall run and byte caps remain binding. Complete bounded503error bodies are accounted exactly; incomplete responses and historical uncertainties remain reserved. The existing provider cooldown and endpoint identity are preserved.
