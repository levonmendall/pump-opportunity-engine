# POE operating runbook

## Latest single forward diagnostic — completed, no retry

Owner's de102ee grant was executed once with capture code349e67b. Read the final
actual-result section of ADAPTIVE_MONITORING_EVALUATION.md and
`evidence/scheduler-forward-20261027/decision.json`. The exclusive output directory
is a durable consumed-attempt marker. Do not delete it or run the CLI again.

Latest accounting chain: the original old/component and14overnight books, then
`01-preflight`, `02-combined`, `03-audit` rpc-budget.json files under that directory.
221units/4,411,710accounted bytes include the old2MiB uncertainty. New linked
pumpapi-budget.json preserves old256MiB/230s plus140MiB/90s:396MiB/320s. Never
ignore these3new phases or refund the reservation because actual receipt was lower.
No remaining unused allowance is an active capture grant.

The trial produced5validated market swaps and one scoped closed window, not a
PAPER trade.40holding checks had max2056ms gap; no natural exit crossing. The
recorded75002ms observation exceeds75s by2ms; this is not exact-duration compliance.
Next offline work must separate fixed admission cutoff from actual shutdown and
address known high-jitter/burst/pending failures. Real held-position management
must continue during feed failure; the diagnostic's whole-process stop is not a
production recovery policy. No production service or account was changed.

## Latest offline scheduler correction

Read the final shared-scheduling section of ADAPTIVE_MONITORING_EVALUATION.md and
`evidence/scheduler-correction-20261027/forward-proposal.json`. The corrected
research runner selects bounded-deadline-v1; legacy/strict cases are comparisons.
No provider requests ran. Old64MiB capture limits and old reservations still block
another capture. The proposal is not an active grant or permission to run a CLI.

Offline verification:

```sh
node --import tsx --test test/research-dispatch.test.ts test/shared-scheduler-trace.test.ts test/active-pipeline-availability.test.ts test/scheduler-proposal.test.ts
node --import tsx scripts/replay-overnight-correction.ts --verify-existing
```

Normalized information is usable after validation, not at earlier RPC body
receipt. Original executed evidence remains unchanged. Early coherent checks
change monitoring phase and consume requests; never call them identical fixed
observations or an approved completion-gap tolerance. Actual cancellation must
settle before another physical request; failures preserve reservations and gaps.
Do not use test restart/disposable-account controls on the authoritative account.

## Current review candidate — isolated research, not installed

Branch `poe-free-data-evaluation-20261027`; read
[OVERNIGHT_HANDOFF.md](OVERNIGHT_HANDOFF.md). Current Clock/account/SDK parity,
three-pool batching, matched trade fields and one notification recovery now have
live evidence. The combined forward run failed mapping/complete-window quality
and exceeded its nominal evaluation interval. Offline fixes/replay do not pass
forward acceptance. No deployable autonomous PAPER trader is claimed.

All captures are closed. Old429 and completed grant/counterbook files remain
unchanged; new linked counters163units and3,587,908accounted related bytes include
the retained2MiB uncertainty. PumpApi256MiB reservations are fully committed;
no automatic network retry, refund or capture. Do not run historical live probe
commands below merely because they remain documented. Alchemy/Helius, paid
services, wallet operations and production changes remain excluded.

Reproduce offline checks without credentials or provider traffic:

```sh
npm run build
npm run compile
npm test
node --import tsx scripts/replay-overnight-correction.ts --verify-existing
```

The replay verifier recomputes the corrected counterfactual from original receive,
request and confirmed-availability times. It verifies stored original hashes and
exact semantic equality, reports historical/current source differences, and
never rewrites the original failed run. Focused lifecycle/retained-exposure/
same-account restart checks are in `test/research-held-market.test.ts`,
`test/trader.test.ts` and execution/backup regressions. They use temporary
DISPOSABLE_PAPER ledgers, not the installed authority or forward performance.

The research Clock quoteMany helper validates1–3holdings in one full confirmed
union. Clock bank time is labeled separately from independent block time. The
isolated ResearchHeldMarket adapter reuses only exact-size compatible fresh
post-delay exit state, checks actual pending ownership/inventory/floors, charges
gas once and refuses gaps/stale state. Separate pending actions still prepare
separate contexts. No production runtime imports this adapter. Optional candidate
quote deferral defaults off; it changes quote/refusal timing while preserving the
existing predictive predicate. No price screen, slower exit policy or primary
strategy change was installed. Strict future-start reservation also defaults off:
its offline starvation counterexample is a failed experiment, not a scheduler fix.

## Account-preserving release and rollback prerequisites — not executed

The review work retains ledger schema1 and the installed snapshot identity
contract. There is no migration, account initializer or requirement to modify
Render credentials/account/inception. The installed observer is still release
bce3d22bb434eb429aafacb788a18f39ec189c1b. Current Cloud checks use Node24.19.0,
better-sqlite3 13.0.3 with the actually loaded SQLite3.53.4. Installed library/OS
compatibility must be checked before a separately authorized installation.

Before any future deployment: complete corrected forward field/coverage and
scheduling tests; freeze the amount/fee/rule contract; connect production entry,
position and recovery paths; prove actual host capacity, backups and alerts.
Prepare an exact commit, installation directory and previous release for review.
Keep entries disabled. With separately authorized service control, make a
consistent SQLite backup through the existing API; verify restore to a disposable
path has the exact original account, inception, capital history and reservations.
Do not copy an active main database without its WAL or replace it with test data.

Only one supervisor/financial writer may own `/var/lib/poe/state/ledger.sqlite`.
A future code switch at `/opt/poe/current` must reopen that same account; verify
its before/after identity, positions, pending actions and reconciliation before
resuming observation. Never run bootstrap/account init on upgrade. Rendering
keeps its original source identity, public viewer and authenticated ingestion;
dashboard availability must remain outside ledger/protection work.

Rollback means returning to a reviewed compatible release with the same financial
history; never restore old balances over newer actions. If a future release opens
positions, the current observer is **not** a safe rollback target because it lacks
held-position management. Preserve/quarantine uncertain actions, block new risk
and use a tested management-capable release. No rollback, stop, root installation,
release switch or account restore was performed under overnight authorization.

## Prior unmetered development checkpoint — 2026-10-27

The installed C2 observer/account/inception remain unchanged. Development RPC
market integration, requirement-based observation planning and offline recovery/
load checks passed before this assignment; final combined build/compile and275root
tests pass. Earlier unsigned-funding checks remain separate and out of scope. They are not installed
trading evidence. New commands, isolated from production financial state:

```sh
node --import tsx scripts/recovery-load.ts /tmp/poe-recovery-check.json
node --use-env-proxy --import tsx scripts/rpc-observation-probe.ts
```

The second command is a bounded public-RPC research capture, not a daemon or
provider replacement; it replaces its named research artifacts. Read
RPC_OBSERVATION.md before repeating. Tested slow schedules did not validate
protection replacement, trade flow or cost savings. The2s quote-age rule applies
at use; holding-check cadence/maximum response still require explicit freezing.

Historical provider-binding work (outside the current PumpApi/public-RPC scope): Existing repository
secret MM_SOLANA_READ_RPC_URL in levonmendall/The-Meme-Machine is confirmed and its
public Alchemy Solana host validated in protected job memory, without provider
requests or secret export. Isolated metadata branches never change old main or
deployment history; deployment:false is explicit. Existing direct GitHub secret
binding is usable for a bounded operator process, not an instruction to export
credentials through outputs/artifacts. Quota/overage proof is still required;
an app key cannot read billing. No new key or Admin credential is requested.
See PROVIDER_BINDINGS.md, ALCHEMY_ASSESSMENT.md, TARGETED_TRANSACTION_FLOW.md and
OBSERVATION_DESIGN.md. No continuous paid subscription or paid Helius plan.

## Verified installation

The existing instance i-00044d4ea1471b957 in account133857166104/us-west-2 runs
poe-runtime.service as restricted poe-runtime uid988. Bootstrap and launch fix are
complete. **Do not rerun bootstrap or initialize the installed account.** Inventory,
old publisher retirement and Render source changes are also complete. No cleanup
is needed; preserve the administration runner and financial/access records.

Installed runtime: bce3d22bb434eb429aafacb788a18f39ec189c1b.
Account: poe-3123e352-4581-455b-85db-acd7e825e99e.
Inception:2026-10-26T22:07:36.212Z, one VIRTUAL $1,000 USD-to-SOL conversion.
Never reseed on restart, restore or deployment.

The supervised process is an **entry-blocked observer**, not an autonomous PAPER
trader. It receives free migrations/public SOL/USD, reconciles cash and publishes
snapshots. It has no selected-token flow or active entry/exit path. Startup refuses
held positions/pending sells until supported management is connected.

## Status and controls

Use the existing read-only administration workflow in meme-machine-admin,
poe-install-preflight.yml ("POE read-only installation status"). The filename is
historical; current contents only inspect identity, units, bounded public status,
resources and fact times. Run40415427271/job121958414861 at01:41:36UTC
verified active/running/enabled, zero restarts since22:30:55UTC, reconciliation
age0.425seconds. It does not read private financial files or independently audit
DB balances. The runner's root start permission is denied; never bypass it.

Private controls use /run/poe/control.sock,0600. Execute as poe-runtime through
existing authorized administration, with POE_SOCKET_PATH selecting that socket:

```sh
/opt/poe/node/bin/node --preserve-symlinks-main /opt/poe/current/dist/src/runtime.js status
/opt/poe/node/bin/node --preserve-symlinks-main /opt/poe/current/dist/src/runtime.js pause
/opt/poe/node/bin/node --preserve-symlinks-main /opt/poe/current/dist/src/runtime.js resume
/opt/poe/node/bin/node --preserve-symlinks-main /opt/poe/current/dist/src/runtime.js safe-stop
```

Installed C2 needs that standard Node flag through the current symlink; the owner
already installed equivalent start/stop overrides. EC2_ENTRYPOINT_RECOVERY.md is a
completed action, not another request. Later code canonicalizes main paths; do
not deploy merely to remove a working flag.

Pause closes entries. Resume intentionally returns disabled:
FLOW_NOT_VERIFIED_BILLING_NOT_CONFIRMED. Safe-stop cancels entry reservations and
refuses graceful exit with unresolved/held exposure. Never force-stop and silently
abandon exposure. The present account has none. Systemd is enabled, restart on
failure10seconds, three starts per300seconds. No new runner privileges.

The public /var/lib/poe-public/status.json exposes a bounded nonfinancial allowlist.
Its heartbeat does not refresh underlying reconciliation/USD/migration facts.
NTP is synchronized. Socket connectivity alone does not prove discovery coverage.

## Financial state and recovery

One PaperLedger writer uses standard Linux flock and short SQLite FULL/WAL
transactions. Never unlink an active ownership lock. OS crash releases it.
Database symlinks/hardlinks are refused; no network call inside a transaction.
Loaded fixed dependency: better-sqlite3 13.0.3 / SQLite3.53.4; retain lockfile.

Private DB: /var/lib/poe/state/ledger.sqlite. Offline commands require a safely
stopped daemon and understood exposure. These are command forms, not reset steps:

```sh
npm run account -- status --db PRIVATE_DB --account EXISTING_ACCOUNT
npm run account -- backup --db PRIVATE_DB --account EXISTING_ACCOUNT --target NEW_PRIVATE_BACKUP
npm run account -- restore --db NEW_PRIVATE_DB --account EXISTING_ACCOUNT --input VERIFIED_BACKUP
```

Restore writes a NEW target, validates exact account/mode/inception and integrity,
and pauses entries pending fresh reconciliation/readiness. Never start a second
authority. Preserve damaged originals; never reset capital to pass startup.
Never copy an open main SQLite file without WAL; use SQLite backup API.

Development FinancialBackupStore schedules async maintenance/copy after useful
work, startup then six-hour monotonic intervals, one in-flight operation, two
completed copies and one pending artifact. Heavy validation runs on a bounded
worker. See BACKUPS.md for selection/restore/size limits. **Not installed on EC2.**
Actual production backup/restore, disk-pressure and alert proving remain pending.
No paid backup service is authorized.

## Development

Use Node24.19.0 and secret-free .env.example:

```sh
npm ci
npm run build
npm run compile
npm test
npm run integration
```

Integration is a bounded free migration/RPC probe: five-minute socket maximum,
three selected events,100RPC calls/run,12-second requests,2MB responses,10MB
evidence. It verifies real migration/canonical pool/token behavior/fees/effective
reserves and size-specific buy/matching sell. A quote is not a fill; Ctrl-C stops
this position-free probe. Failed/interrupted evidence never becomes a passed gate.

The normalized flow/rule, delayed single-attempt execution, connected disposable
trader, actual-size exits, operating-cost journal and backup scheduler remain
development code. Fixtures use separate DISPOSABLE_PAPER accounts. Managed-feed fields have only the named partial proofs above; complete-window
coverage and corrected forward decoding remain unverified, rule UNFROZEN and
production scheduling/projections incomplete.
See STRATEGY.md, TRADER.md, EXECUTION.md, FEED_MEASUREMENT.md, PRICING.md, COSTS.md.
No signer, transaction submission or AI calls in the trading loop.

## Data wallet and costs

Turnkey registration/authentication and source identification are complete.
TURNKEY_API_KEY_FILE selects the existing protected0600 pair outside Git,
operator-only, never trader/Render. Local SDK stamping requires actual material;
network-secret placeholders cannot sign requests. Do not alter credentials,
rebuild Turnkey, export private keys or sign a test.

FUNDING.md retains historical deferred recovery/funding dependencies;
OWNER_ACTIONS.md lists only the current free-data assignment input.
The earlier private-route reply is still a placeholder; no callable vault/transfer
route is identified. Never send the protected billing bundle through chat,
GitHub, Actions, logs, Render or public artifacts. Keep the existing wallet.
Source balance cannot fund0.06SOL plus fee; no transfer is approved. After recovery
and sufficient amount/balance checks, refresh exact unsigned fee and request
explicit approval before signing/broadcast.

Only the API key later reaches EC2 via private root0600 file/systemd LoadCredential;
the recovery bundle does not. scripts/install-provider-credential.mjs extracts a
NEW API-only file without printing values. Installation/auth measurement pending.
Caps:0.01SOL/day,0.04SOL/four-day total,$2.50/day/$10total whichever binds,
0.02SOL floor, no automatic funding. These authorize measurement, not continuous
acceptance. Missing actual operating allocations keep economic P&L unavailable.

## Public dashboard

Original URL: https://meme-machine-dashboard-staging.onrender.com .
Only srv-daqon53tqb8s73bdceq0 in tea-daqk6h8jo6nc73eojtp0; existing free compute,
one instance, no database, auto-deploy off. Owner explicitly chose PUBLIC
read-only viewing; published PAPER financial snapshots/exports require no login.

GET /healthz is process health; /status reports source freshness. Public GET:
 /, /status, /api/snapshot, /api/export. Machine POST /api/snapshot alone requires
the dedicated strong Bearer secret. No browser financial controls. No wallet,
provider or Turnkey secrets, market requests or EC2 DB access on Render.

EC2 publishes asynchronously every30seconds, bounded timeout/retries/backoff
(maxfive minutes), one replaceable latest slot, no financial lock. Cache loss
waits for full real data/history; never seed $1,000 or restart EC2 to refresh
Render. Receiver time cannot refresh market/reconciliation facts. Retain genuine
chart gaps. With zero trades, current movement is SOL price effect, not edge.

Four source fields must match installed account/inception/runtime/strategy in
RENDER_CUTOVER.md. Never import demo/legacy records. Dashboard source advances
independently of EC2: latest verified web code b3df32ce098d5de0c38c706bf9cf8e6066eccec1,
deploy dep-dbfuh559el5s73bbf3pg at23:57:11UTC; EC2 remains C2.
Final22/22 deployed checks verify source facts, natural cache recovery and mobile
visibility of actual release/strategy; see evidence/render-current-live.json.
Preserve public policy and protected ingress. Rollback only web code, never source
financial identity. Env updates can trigger builds despite auto-deploy off;
inspect state before triggering another. No second service/paid upgrade or
assumption of renewed shared quotas.

## Acceptance

No24/72-hour acceptance clock started; GatesA–D incomplete, edge UNPROVEN,
LIVE DISABLED. Finish real-flow/budget proof, production management/projections,
frozen rules/assumptions, account-preserving deployment, actual backup/restart/
outage/load proving and alert delivery first. No authorized critical-alert
channel is verified; a process/dashboard alone is not alert delivery.


## Standing read-only research (2026-10-27; no production install)

Use the existing review branch. Preserve all old evidence/counterbooks; never rerun an output directory or clear a refusal. Old240-unit lifetime restriction is historical, not current authority. Every new experiment keeps explicit physical request/byte/time/resource limits and an ordered baseline chain. Verified unused stream bytes may be released only by an append-only settlement receipt. Provider429/Retry-After still governs; no endpoint/IP rotation or automatic retry.

The opt-in `protected-deadline-proposed` scheduler retains a2s target,2s quote age and5s enrichment deadline. Its4s completed-evaluation proposal is NOT an approved production risk setting. Pending/recovery/protection failures invalidate candidate windows; fresh60s observation is required after recovery. In-flight cancellation must settle physically. A quote/state gap preserves financial exposure and closes new-risk admission.

A specifically prepared Cloud experiment requires nonroot UID1000 and external resource controls. Example (use a NEW reviewed output name and every previously completed standing book in chronological `--previous` order):

```sh
timeout --signal=TERM --kill-after=5s 115s prlimit --cpu=20:21 --fsize=16777216:16777216 --nofile=64:64 -- node --max-old-space-size=128 --use-env-proxy --import tsx scripts/standing-research.ts run --out evidence/standing-research-20261027/new-reviewed-run --observation-ms 75000 --previous evidence/standing-research-20261027/01-paced-combined --previous evidence/standing-research-20261027/02-failed-buy-audit
```

This is a research command, never an EC2 installation/restart. Inspect actual limits, candidate support/activity, current source and remaining disk/evidence headroom first. There is no automatic second capture. The driver enforces100 new units/120s,250ms spacing/60starts per minute/10per10s/one in flight,32MiB related responses,140MiB stream reservation,75s logical observation and6MiB new evidence within32MiB retained. It preserves full pre/post-cutoff byte accounting. PublicRPC availability is nonguaranteed; limits do not confer production entitlement.

Reproduce the disposable integration without network or an authoritative account:

```sh
node --import tsx --test test/research-end-to-end.test.ts test/observation-cutoff.test.ts test/shared-scheduler-trace.test.ts test/pumpapi-short-exact-buy.test.ts test/instruction-layout-callers.test.ts
```

The test lifecycle uses disposable state and fixture decisions; it must never be published to Render or relabeled natural PAPER performance. Existing production install/backup/rollback commands are unchanged. Any future upgrade must preserve the actual account ID/inception, stop after exclusive writer release, validate a consistent backup, use the compatible schema and retain the prior release; this research does not authorize executing that upgrade.


## Isolated live-market PAPER pilot

Use [PILOT.md](PILOT.md) for the separate Cloud pilot. `bash operator/pilot.sh start --directory /workspace/poe-pilot --duration-seconds 1800` starts/reopens only the distinct experimental ledger. `status`, `stop` and `resume` use the same directory. A graceful stop preserves open exposure and records an interruption; it never fabricates an exit. Do not point these commands at production data or publish their snapshots to the original Render identity.

The one-candidate/one-position first stage is temporary. Additional shadow candidates and concurrent simulated positions require measured scheduling/data support, not another owner grant. Existing jitter/burst/processing/pending failures remain relevant. No production release, service restart or authoritative entry enablement is authorized.
