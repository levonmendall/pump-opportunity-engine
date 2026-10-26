# Operating runbook — present partial implementation

## Local start and status

Use Node24.19.0 and `npm ci` with lifecycle scripts enabled. `npm run build` checks
types; `npm run compile` emits JavaScript. `npm test` runs isolated regressions.
The native bigint-buffer mitigation is required; see DEPENDENCIES.md.

`npm run integration` is a bounded free read-only probe, not a daemon. Inspect
its timestamped `evidence/integration-proof-*.json` and matching NDJSON. Evidence
is capped at10MB per probe and RPC at100 calls/run, with12-second requests and
2MB streamed response limits. No unbounded history discovery or automatic RPC
retries. A stale/missing/unsupported sample fails rather than creates a fill.

Stop an integration probe with Ctrl-C; it owns no financial positions. A failed
or interrupted evidence file remains diagnostic and does not become a passed gate.

Production PAPER accounting and the supervised **entry-blocked observer** are now
implemented. They are not an accepted trading strategy/execution runtime. The
observer never seeds an account, enables entries, reads the billing credential,
or manufactures trades. It refuses production startup with existing positions
or pending sells until supported position/exit management is connected.

## EC2 access — inventory complete

Use the existing successful inventory
[run 40392851547](https://github.com/levonmendall/meme-machine-admin/actions/runs/40392851547),
job 121818077975, main1b53658bc29936c00901f57a35556faac3a995f4. It verifies
account133857166104/us-west-2/instancei-00044d4ea1471b957, nonroot runner
mm-ec2-runner uid994, about 55 GiB free root disk and6871MiB available memory.
No repeat dispatch or legacy application readiness/source gate is needed.
No cleanup is justified by this capacity. Preserve the runner and owner access.

Reporter retirement is complete. After the owner's root action, run 40397181995
attempt 2/job 121852666626 observed both timers inactive/disabled and both services
static/non-running. One old failed flag is cosmetic. The unchanged workflow still
fails its later sudo test; that does not mean the shutdown needs repeating.
Financial records, protection services and administration access were preserved.

## Install and operate the entry-blocked PAPER runtime

Use the exact reviewed root-owned download, checksum and private reporting-secret
procedure in [EC2_BOOTSTRAP.md](EC2_BOOTSTRAP.md). Run it once through existing
owner/root access on the verified host. Do not execute a runner-writable /tmp
script as root. Installation preflight run 40404058329/job 121857131607 proves the
runner lacks the exact bootstrap permission; no POE user/service is installed.
No new AWS key, inventory dispatch or runner sudo rule is needed or proposed.

Pinned installation release: bce3d22bb434eb429aafacb788a18f39ec189c1b; installer
SHA2563a1b269f2b10f97f45b0fae5d6f9185cc4f6d35abf965df79a2a5941d63c6136.
The reporting viewer remains on its separately verified3af3f9e release; both use
the same snapshot schema. No dashboard redeploy is required for installer fixes.

This is an initial owner bootstrap, not a runner privilege workaround. It verifies
IMDSv2 identity, creates restricted poe-runtime, installs dedicated tested Node,
builds a pinned release as nonroot, freezes code and separates state/backups/evidence.
It refuses an active runtime or unreviewed upgrade; it never cleans legacy data.
Explicit --init obtains current public SOL/USD for VIRTUAL inception once. Restart
never seeds. No wallet funding is involved. Existing dedicated Node paths and
runtime configuration are checked for ownership, symlinks and write permissions
before trusted execution/writes. Installer validation remains local until actual
EC2 execution; a successful preflight diagnostic is not a successful installation.

The separate read-only /var/lib/poe-public/status.json projection exposes only
identity, process/data fact timestamps, bounded free-feed counts and blockers to
the existing runner. It contains no balances, trades, secrets or provider URLs.
Private financial directories and control-socket permissions remain unchanged.
Its generated time is not evidence that market or reconciliation facts are fresh.

Offline account commands (daemon stopped; exclusive writer prevents a second owner):

```sh
npm run account -- init --db /private/poe/ledger.sqlite --account poe-main --input conversion.json
npm run account -- status --db /private/poe/ledger.sqlite --account poe-main
npm run account -- backup --db /private/poe/ledger.sqlite --account poe-main --target /private/backup/ledger.sqlite
npm run account -- restore --db /private/restored/ledger.sqlite --account poe-main --input /private/backup/ledger.sqlite
```

conversion.json contains `{ "price": { "microUsdPerSol": "INTEGER", "at": EPOCH_MS,
"source": "actual observation source" } }`, fresh within10seconds. Parent/file
permissions0700/0600 and exact ownership are required. No fixture identity/state
can be promoted. Resume requires fresh real readiness evidence and cannot clear
sticky daily loss pauses. Unknown/corrupt financial state refuses startup untouched.

Use the daemon's0600Unix control socket while it owns the DB. Run as poe-runtime
(or existing owner/root invoking that identity), with POE_SOCKET_PATH=/run/poe/control.sock:

```sh
/opt/poe/node/bin/node /opt/poe/current/dist/src/runtime.js status
/opt/poe/node/bin/node /opt/poe/current/dist/src/runtime.js pause
/opt/poe/node/bin/node /opt/poe/current/dist/src/runtime.js resume
/opt/poe/node/bin/node /opt/poe/current/dist/src/runtime.js safe-stop
```

Resume intentionally refuses FLOW_NOT_VERIFIED_BILLING_NOT_CONFIRMED in this
observer. Safe-stop cancels entry reservations but never discards exposure; it
refuses graceful exit when positions/unresolved exits require management. A forced
supervisor kill would leave exposure unmonitored. Do not deploy this scaffold with
held positions or claim supported exit protection. Full execution remains work.

Explicit POE_USD_SOURCE=coinbase-spot enables bounded read-only public SOL/USD
refresh within the single process; failed/stale observations become unknown.
Default price-file mode requires an actually fresh timestamped file, not a cached
price relabeled fresh. Reporting runs asynchronously at30seconds and cannot own
financial writes. Durable snapshot sequence/history use the same ledger writer.

## Authoritative financial state

Create one new POE identity and durable directory owned by poe-runtime. Inception
must record the $1,000 USD-to-SOL conversion once using timestamped actual valuation,
integer balances and gas reserve. Never use fixture-* identity, reset on startup,
or import old records. A persistent0600 .owner.lock uses standard Linux flock for
process ownership; never unlink it to take over an active writer. The OS releases
ownership on close/crash; stale timestamps/pid heuristics are not used. SQLite
stays in NORMAL locking mode with short transactions, not a permanent financial
DB lock across network requests. Canonical directory aliases share ownership;
database symlinks/hardlinks are refused. No network call inside transactions.

Until the production runtime is implemented, do not turn entries on. Safe stop with
positions must pause/cancel pending entries, preserve reservations and unresolved
actions, and keep supported RPC exit/valuation management under the supervisor.
A full stop requires explicit disclosure of unmonitored paper exposure; never
delete or silently close it. Future resume requires fresh reconciliation and
candidate-specific warm windows, retaining sticky daily-loss pauses.

## Backup and recovery

DisposableLedger.backup uses SQLite's backup API; restore consistency and actual
crash recovery are tested. Never copy an open database file without its active WAL.
Offline backup/restore commands are implemented and tested. Production retention and EC2 restore proving remain incomplete.
Keep a small bounded consistent local backup; no paid backup service is authorized.
Financial corruption means preserve records and block risk, never reseed.

## Data wallet and costs

Follow [FEED_EXPERIMENT.md](FEED_EXPERIMENT.md). The approved limits cover initial
measurement, not continuous acceptance. The free probe never loads the API key.
After secure attachment, measure sustainable selected-token observation and actual
charges before any 24/72-hour clock. No automatic funding or paid RPC authorization.

## Dashboard — deployed; awaiting authoritative EC2 data

The original URL now runs verified POE release3af3f9ed9abde5178379e18e986e07ab41965d22,
deploymentdep-dbfs7dafngtc73cs4p40. It shows "Awaiting POE data" with newly rotated
viewer/ingestion credentials and rejects all snapshots while the authoritative
account is unconfigured. Deployed HTTP/auth/mobile checks pass. Owner viewing is
HTTPS Basic, user poe-owner; obtain its password privately in authenticated Render
Environment. This is an empty viewer, not fresh financial reporting.
After actual EC2 account inception, set
`POE_ACCOUNT_ID`, `POE_INCEPTION_AT` (UTC millisecond ISO),
`POE_RUNTIME_RELEASE`, `POE_STRATEGY_VERSION`, `POE_VIEWER_USER`,
`POE_VIEWER_PASSWORD` (>=16 chars) and separate `POE_INGEST_SECRET` (>=24 chars).
Use standard secret storage. Never attach provider keys, wallets, RPC keys,
EC2 DB paths or trading permissions to Render. Identifiers must match the actual
future authoritative account; no demo snapshot must reach that source.

```sh
npm run compile
npm run dashboard
```

`GET /healthz` is unauthenticated process health. Owner uses HTTP Basic auth over
HTTPS for `/`, `/status`, `/api/snapshot`, `/api/export`. The machine uses Bearer
auth for `POST /api/snapshot` only, full strict schema in src/reporting.ts,128KB
maximum. Viewer routes have no financial controls. Receiver cache is memory only:
redeploy/restart waits for a valid full snapshot and never seeds $1,000.

The standalone SnapshotPublisher accepts bounded projections supplied by EC2;
its default cadence is30seconds, timeout3seconds, backoff at most5minutes. It
retains one latest snapshot during outages and never reads market/ledger data.
Durable source sequence, bounded projection and honest history gaps are implemented
in the entry-blocked runtime; they are not installed/verified on EC2 yet. No
end-to-end financial agreement is claimed.

Owner amendment authorizes replacing exactly existing service
`srv-daqon53tqb8s73bdceq0` in confirmed workspace `tea-daqk6h8jo6nc73eojtp0`.
Retain free compute and preferably URL `https://meme-machine-dashboard-staging.onrender.com`.
No second continuously running service is authorized. Keep the resource name to
avoid unnecessary URL changes; the displayed application name is Pump Opportunity Engine.
The source/Node/build/start/health/free-plan/auto-deploy edit, reporter retirement,
credential rotation, deployment and empty-viewer verification are COMPLETE.
Do not ask the owner to repeat them. Complete only actual EC2 source identity,
publication/account agreement and recovery checks in RENDER_CUTOVER.md. Never
import legacy financial data. Environment changes were observed to trigger a
rollout even with auto-deploy off; inspect state before triggering another build.
Validate with `render blueprints validate render.yaml` if available; current public
schema validation alone does not prove account allocation. Auto-deploy is off.
Verify deployed SHA/URL, Basic/Bearer separation, source agreement and cache loss.
The YAML is a configuration reference for the existing service, not permission
to create a new Blueprint or duplicate its resource. Do not upgrade compute or
create a paid service to mask quota conflicts or free-service cold starts.
Keep a last known good release and roll back Render independently of EC2.

No alert delivery is established. Dashboard process health is not an unattended
trading alert system. Gates B/C remain incomplete until actual supervised operation,
failure drills and elapsed evidence exist.

## Existing Turnkey identification and manual-funding alternative

The organization ID is already supplied. Operator-only code in operator/turnkey
uses official SDK8.8.0 getWalletAccounts without walletId, includeWalletDetails=true,
and cursor pagination. It refuses stalled/incomplete pagination, keeps ambiguous
accounts separate and reads confirmed mainnet native SOL. Its guarded transport
rejects signing/export/submission paths, including a tested real SDK method call.
It is outside trader dependencies and is never installed/loaded on Render.

Local SDK authentication stamping needs actual API authentication material;
network placeholders cannot stamp requests. The owner subsequently supplied a
complete pair and explicitly authorized protected storage/use. It is now in
/workspace/shared/poe-secrets/turnkey-api.json, owner-only 0600/parent0700, outside
git, selected by TURNKEY_API_KEY_FILE. Local P-256 pair validation passes without
displaying values. No key is installed on Render or the PAPER trader.

Real read-only SDK queries return HTTP 401 PUBLIC_KEY_NOT_FOUND: "no user
credentials found in organization with that public key." The remaining problem
is public-key registration/organization binding, not local private-key delivery.
Register the public API authentication key for the intended existing execution
user/organization with only account-query access, or identify its correct existing
organization binding. Do not repost private material or rebuild Turnkey.

Alternatively let the owner perform the one-time transfer through the existing
Turnkey UI after the full exact proposal is verified and explicitly approved.
For manual funding, only the public sender address is needed for independent SOL/
fee checks. Recovery confirmation and explicit approval of the complete exact
source/destination/0.06 SOL/fee/total-debit proposal still precede signing/broadcast.
This access dependency never blocks unrelated PAPER/EC2/Render implementation.

Private recovery route: import the existing protected billing bundle directly
from private workspace file access into the owner's existing secret vault. Never
paste/display it in chat, GitHub, logs or Render. If private file access is absent,
identify an existing private vault/upload/file-transfer connection by nonsecret
name. No alternative wallet is created. Confirmation remains pending.
