# Isolated frozen candidate evaluation

Current launcher mode is `candidate-evaluation`, despite historical pilot/PAPER
module names. It requires the existing account with closed financial permission
and no positions/pending actions. It cannot initialize capital or dispatch
financial recovery, contexts, decision quotes, orders, fills or exits. The actor
uses existing verified-window predictive diagnostics without ledger authorization;
intentional permission restrictions are explicitly nonperformance outcomes.
No USD valuation is fetched or financial journal changed by this mode. Financial
fields are labeled historical references. The same full supported-state decoder
still validates each deep admission, with three reads and no rent/entry plan.

Current start/resume (after verifying no existing run):
`bash operator/pilot.sh resume --directory /workspace/poe-pilot --stage three --deep-slots 6 --duration-seconds 900`.
`stage three` is historical contract identity, not permission for three positions;
effective financial position capacity is zero. Source/configuration hashes bind
mode, slot count, duration, strategy and resource/request limits for each run.

The remaining sections describe retained components and earlier authorized PAPER
fixtures/intervals. Their execution assumptions are not activation authority for
current candidate tests. See the checkpoint for the exact active freeze.

This launcher is a Cloud research process. It does not replace the EC2 observer, open its account, publish to Render, load wallet credentials, or submit/simulate Solana transactions. The owner explicitly authorized simulated entries only in a distinct `poe-pilot-*` account. There is one ledger writer. Financial history lives outside the repository in `/workspace/poe-pilot`, with private file permissions.

## Wiring and frozen behavior

Free PumpPortal migrations are identity hints. Confirmed executed migration/create-pool evidence establishes actual base/quote roles; the original creation is rechecked at finalized commitment. Unsupported or unknown origins refuse entry. Current SDK pool/mint/vault/config/fee support and current rent are read separately before flow admission. A no-op migration retry never establishes inception or entry age.

A bounded stage-specific candidate set receives PumpApi signature hints and confirmed transaction enrichment for every selected signature. Curve SOL amounts, actual trader roles, transfers, fees, and instruction/event identities come from executed evidence. Six closed ten-second bins form the unchanged sixty-second primary window. Enrichment must become validated information within five seconds; later information never moves backward in time. Unsupported events, loss, overdue work, or failed bounded independent history checks invalidate the window.

`persistent-buying-pilot-v1` freezes the current provisional rule: age5min–2h, net buying≥1SOL, at least4positive bins and5buyer wallets, largest buyer≤35%, nonnegative price structure, and order/liquidity≤5%. Different addresses are not independent people. The price screen previously rejected by the owner is absent. Quotes are deferred only when the existing predictive conditions already reject.

The account initializes once with $1,000 virtual capital converted to SOL using a timestamped public Coinbase SOL/USD observation. Maximum initial commitment remains $50 including execution costs and rent; the initial pilot permits only one position, without adds or re-entry. The $150 aggregate and $50 UTC daily-loss rules remain. The one-position cap is a first-stage setting, not a permanent architecture limit; explicit `shadow`, `two` and `three` stages permit progressive isolated testing. Actual required account rent is locked capital, not a fabricated fee/refund. Simulated gas is7,000lamports per attempted order; pool fees and impact are already included in integer SDK prices. Entry/exit orders have a1sdelay,5sexpiry and1%slippage constraint. There is one first eligible modeled attempt, with no favorable-quote retry.

After a fill, enrichment for that held token stops. Other candidate scopes and free migration discovery continue in the explicit shadow/concurrent stages when shared capacity is available. Holdings use actual-size coherent Clock/account SDK prices at a2starget; exits remain15%stop,30%profit and15minmaximum hold. Quote age at actual use is≤2s; source age≤30s. The experimental completed-evaluation operating boundary is4s, allowing one bounded nonpreemptible operation plus dispatch/validation around the2starget. A breach is disclosed and closes new risk; this boundary is not approved production risk tolerance or a stop-price guarantee. Failed pricing retains exposure and reports unknown marks. Existing positions and unresolved actions precede discovery.

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

No new exposure is admitted without at least910sremaining runtime,490request units and6MiBresponse reserve. The original `single` workload remains one candidate or one holding. Explicit `shadow` allows two observed candidates alongside one holding; `two` and `three` allow two/three positions with bounded concurrent candidates. These stage ceilings are permissions, not demonstrated provider capacity. A shared method cap of eight getTransaction starts/ten seconds is a conservative response to prior throttling, not a provider entitlement. Required events that cannot meet the five-second deadline invalidate their candidate window. The broad stream is filtered immediately and never archived. API fees are$0; Cloud/infrastructure/transfer allocation remains separately uncertain.

`status.json` is a replaceable local read model; `runs/<run>/events.ndjson` retains selected evidence/decisions and `result.json` the interval outcome. `ledger.sqlite` is the sole pilot financial authority. `backups/` retains two consistent SQLite backups through the existing backup API. The independent reporting-only publisher may send an allowlisted diagnostic projection of status.json to the separate `/api/pilot` channel. Pilot balances, journal and financial results never enter the original Render portfolio channel.

## Later production handoff — not executed

Before any EC2 release: review the frozen contract and measured pilot failures; verify bounded nonroot EC2 resource compatibility in a separately authorized shadow test; check installed schema/account compatibility; test backup restore; prepare a single-writer account-preserving switch and a position-capable rollback. Reconcile original reservations/positions and preserve original inception. The installed observer cannot be a management rollback once a later trader holds positions. Production installation/entries require separate authorization. A Cloud pilot is not24/72h unattended acceptance, EC2 capacity evidence, or proof of profitability.


## Repaired observation admission

After the recorded fourteen-hint burst, the next research interval uses20combined starts/10s while keeping60/min,250msspacing andonephysical operation. Current official public-RPC documentation lists higher limits but explicitly gives no guarantee of current capacity. Preparation is drained until15short-window and20minute starts are available before opening a candidate feed; this is a capacity warm-up delay, not a predictive screen. A fourteen-event burst still fails the five-second deadline with sufficiently slow responses. Such windows are invalidated, not sampled.

Feed reconnect backoff is respected before spending candidate-preparation requests. Passive bytes remain counted after an internal accounting chapter expires; only a later request rolls a settled chapter. The overall run and byte caps remain binding. Complete bounded503error bodies are accounted exactly; incomplete responses and historical uncertainties remain reserved. The existing provider cooldown and endpoint identity are preserved.


## Progressive isolated commands

Use the same existing pilot directory and account. Freeze source for each interval:

```sh
bash operator/pilot.sh resume --directory /workspace/poe-pilot --stage shadow --duration-seconds 1800
bash operator/pilot.sh resume --directory /workspace/poe-pilot --stage two --duration-seconds 1800
bash operator/pilot.sh resume --directory /workspace/poe-pilot --stage three --duration-seconds 1800
```

Stage transitions append a known contract binding to pilot.json; they do not
initialize capital or change predictive thresholds, quote validity, fees or risk
limits. Resume never treats old candidate flow as already warmed. No old entry
executes after restart; unresolved exits and exposure remain financial obligations.

Completed protection timing now comes from actual exit evaluations and owned-exit
observation. Pricing receipt alone and repeated cached evidence do not reset it.
The first evaluation starts from the current run or position inception, whichever
is later. Ongoing gaps are right-censored and visible before recovery completes.
Candidate loss retires that scope; all affected windows restart after protection
failures. Last-socket shutdown is nonblocking for held management, while byte
accounting and unsettled-transport exclusion remain in force.

Observation admission is separate from new-risk admission. A fresh shadow window
needs at least 90 seconds of finite run time and the retained response reserve;
with holdings it must also preserve the unchanged 490-unit management reserve.
A new entry still requires the full 910-second/490-unit reserve. This removes a
research-run coupling without shortening holdings or weakening protection.

Reproduce the bounded offline progression and scheduler failures:

```sh
node --import tsx scripts/progressive-pilot-fixture.ts evidence/progressive-pilot-20261027/fixture-summary.json
node --import tsx --test test/progressive-pilot-fixture.test.ts test/progressive-scheduler.test.ts
```

Synthetic liquidity changes are declared in the fixture evidence; original
retained bytes and the genuine low-liquidity refusal remain intact. No fixture
outcome is a natural trade or a production-capacity measurement.


Observation concurrency can be bounded independently of financial stage. For the
measured quiet-workload direction of up to three coherent holdings and two active
candidates, use `--stage three --candidate-limit 2`. This retains the three-position
financial contract and all baseline risk limits; it does not claim that three
natural positions have been managed. Omitting the optional limit preserves each
stage's default. Limits above a stage's candidate ceiling or outside1..3 refuse
startup. The actual cap is frozen and recorded for each run.

## Dynamic market watch (isolated research)

The persistent watch registry retains up to150 lightweight identities independently
of deep observation. The pending verification queue holds256 seeds. Both are
bounded; overflow and any lost horizon are recorded rather than called complete
market coverage. Migration hints remain provisional until canonical identity/time
are verified. Current support is revalidated before every deep allocation.

Run the same pilot account with three deep slots and the existing three-position
financial ceiling:

```bash
bash operator/pilot.sh resume --directory /workspace/poe-pilot --stage three --deep-slots 3 --duration-seconds 1800
bash operator/pilot.sh status --directory /workspace/poe-pilot
bash operator/pilot.sh stop --directory /workspace/poe-pilot
```

`--deep-slots 6` and `--deep-slots 12` are explicit research configurations, not
verified operating capacity. Advance only after actual completeness, demand and
protection measurements support the next stage. Do not reset capital or alter
position-risk contracts when changing observation capacity. The20slot transport
bound exists for later tests; the launcher deliberately does not enable it yet.

A complete independently audited60second window and the unchanged strategy are
required for a predictive decision. After a predictive rejection, the candidate
returns to watch with a60second cooldown. Fresh activity hints can prioritize a
later promotion, but do not provide trade amounts/buyer identities or bypass
cooldown, support validation, history audit or a new full observation window.
Periodic fair revisits remain possible without an activity hint. This is a new
selection policy and can change opportunity timing; its false-negative/economic
effects remain unproven. A later price rise alone is not a missed executable trade.

Watch activity is received only from an already-open deep stream. The stream is
not kept open solely for watch hints. Broad incoming bytes are still charged
locally before filtering; lightweight filtering does not reduce network traffic.
No extra getTransaction requests are made for watch activity hints. Every required
selected deep trade still needs confirmed enrichment. The aggregate pending-hint
queue remains16; adding slots does not multiply the backlog or completeness claim.

Warm-up audits that cannot authorize an entry are deferred until the first full
closed window. The current-window independent audit remains mandatory. Holdings,
pending actions, source validity,2second quote age and the2second reference
cadence retain priority; the4second research completion boundary is not approved
production risk tolerance. Candidate gaps close the affected entry window.

`watch.json` is replaceable market context with bounded history; it is not a
financial authority. Restart keeps awareness/counters and discards old deep-flow
readiness. Actual ledger positions/pending actions determine owned watch states.
The original EC2 observer/account and Render portfolio remain separate.

Selection policy v3 records feature-only assessments even while financial entries
are paused. It reuses the exact primary predictive predicates on a fresh, complete,
independently audited window. The original primary risk decision is retained. A
feature-only failure can release a deep slot; a pass never authorizes an entry or
substitutes for eligibility, quotes, liquidity or financial limits. These counters
are separate from primary strategy rejections and must not be summed as independent
observations. Capacity-failed scopes retain awareness and use120/300/600second
backoff. Every re-promotion still requires fresh support and a new complete window.
