# POE operating runbook

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
resources and fact times. Run40415427271 attempt2/job121918984748 at23:47UTC
verified active/running/enabled, zero restarts since22:30:55UTC, reconciliation
age3.465seconds. It does not read private financial files or independently audit
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

One PaperLedger writer uses standard Linux flock and short SQLite NORMAL/WAL
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
development code. Fixtures use separate DISPOSABLE_PAPER accounts. Raw managed-feed
fields remain unverified, rule UNFROZEN, production scheduling/projections incomplete.
See STRATEGY.md, TRADER.md, EXECUTION.md, FEED_MEASUREMENT.md, PRICING.md, COSTS.md.
No signer, transaction submission or AI calls in the trading loop.

## Data wallet and costs

Turnkey registration/authentication and source identification are complete.
TURNKEY_API_KEY_FILE selects the existing protected0600 pair outside Git,
operator-only, never trader/Render. Local SDK stamping requires actual material;
network-secret placeholders cannot sign requests. Do not alter credentials,
rebuild Turnkey, export private keys or sign a test.

FUNDING.md/OWNER_ACTIONS.md retain only actual recovery/funding dependencies.
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
