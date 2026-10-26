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

The authoritative trader's start/status/pause-new-entries/resume/safe-stop commands
are **not yet implemented or installed**. Do not mistake the probe or disposable
ledger methods for operational controls. No supervisor or unrestricted root trader
has been installed.

## Establish EC2 access without legacy readiness

Owner opens [POE host inventory](https://github.com/levonmendall/meme-machine-admin/actions/workflows/poe-host-inventory.yml)
and chooses Run workflow on main. New workflow has no checkout or application
imports. It verifies nonroot runner + IMDSv2 identity, gathers mounts/disk/memory,
and attempts available read-only STS/DescribeInstances calls. Expected account,
region and instance are comparison targets, not verified until the fresh run.

Read the new run's job/logs with the existing connector. Do not rerun old deployment,
service control or smoke workflows to make legacy conditions pass. Preserve the
runner and independent owner access. Only after identity/capacity are known, inspect
explicit paths/services/dependencies and protect secrets/real assets before disabling
restart paths or deleting verified obsolete PAPER data. No cleanup is currently needed
or justified by measured host evidence, because the host has not been measured.

## Authoritative financial state (future deployment)

Create one new POE identity and durable directory owned by poe-runtime. Inception
must record the $1,000 USD-to-SOL conversion once using timestamped actual valuation,
integer balances and gas reserve. Never use fixture-* identity, reset on startup,
or import old records. Keep an exclusive owner; no network call inside transactions.

Until the production runtime is implemented, do not turn entries on. Safe stop with
positions must pause/cancel pending entries, preserve reservations and unresolved
actions, and keep supported RPC exit/valuation management under the supervisor.
A full stop requires explicit disclosure of unmonitored paper exposure; never
delete or silently close it. Future resume requires fresh reconciliation and
candidate-specific warm windows, retaining sticky daily-loss pauses.

## Backup and recovery

DisposableLedger.backup uses SQLite's backup API; restore consistency and actual
crash recovery are tested. Never copy an open database file without its active WAL.
Production backup retention/restore commands remain to be wired and tested on EC2.
Keep a small bounded consistent local backup; no paid backup service is authorized.
Financial corruption means preserve records and block risk, never reseed.

## Data wallet and costs

Follow [FEED_EXPERIMENT.md](FEED_EXPERIMENT.md). The approved limits cover initial
measurement, not continuous acceptance. The free probe never loads the API key.
After secure attachment, measure sustainable selected-token observation and actual
charges before any 24/72-hour clock. No automatic funding or paid RPC authorization.

## Dashboard (local / proposed Render)

Initially deploy with strong viewer/ingestion credentials only to show
"Awaiting POE data" while the authoritative account is unconfigured. Ingestion
must reject all snapshots in this state. After real account inception, set
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
Actual durable source-sequence allocation and bounded authoritative projections
are still to be wired on EC2. No end-to-end financial agreement is claimed yet.

Owner amendment authorizes replacing exactly existing service
`srv-daqon53tqb8s73bdceq0` in confirmed workspace `tea-daqk6h8jo6nc73eojtp0`.
Retain free compute and preferably URL `https://meme-machine-dashboard-staging.onrender.com`.
No second continuously running service is authorized. Keep the resource name to
avoid unnecessary URL changes; the displayed application name is Pump Opportunity Engine.
Push the new remote, inspect quota/legacy deployment paths, and perform
the cutover described in RENDER_CUTOVER.md. Never import legacy financial data.
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
