# Reporting-only pilot channel — verified 2026-10-27

The existing service and URL now serve reviewed reporting commit
`8d9f43cf242690df3fe6cdae464262659cf5c80b`, deployment
`dep-dbgfhdcot0ks73cooaq0`, live at 19:18:36.068Z. Main contains only the
reporting repair; the research trader branch was not merged. Free plan,
public read-only viewing and auto-deploy off are preserved.

The separately authenticated `/api/pilot` channel is pinned to the actual local
pilot account/inception. It forwards bounded diagnostics without financial
balances. Two real cycles matched source counters/timestamps, and a real mobile
browser passed. A stopped/stale pilot remains stopped/stale despite publisher
heartbeats. Original `/api/snapshot` account/inception and reporting remain intact.
See [PILOT_REPORTING.md](PILOT_REPORTING.md) and
`evidence/dashboard-reporting-20261027/` for the final deployment checks.

Environment updates triggered a deployment of the then-current old source even
with auto-deploy off; the subsequent explicit queued deployment used and was
verified against the reviewed new SHA. Do not treat the intermediate old build
as the final reporting release.

## Historical cutover record

# Existing Render dashboard — public read-only operation

Only service srv-daqon53tqb8s73bdceq0 in confirmed workspace
tea-daqk6h8jo6nc73eojtp0 is used. Free compute, one service, no database,
auto-deploy off. Original URL:
https://meme-machine-dashboard-staging.onrender.com .

Source: levonmendall/pump-opportunity-engine, main, Node, empty root.
Build: npm ci --include=dev && npm run compile.
Start: npm run dashboard. Health:/healthz.
Verified live deploy:dep-dbfuh559el5s73bbf3pg,
dashboard sourceb3df32ce098d5de0c38c706bf9cf8e6066eccec1.

## Confirmed visibility and source identity

The owner explicitly authorized PUBLIC read-only viewing, matching concurrent
commits2bd35bf–ae93ab4. Root fetched and preserved those changes. POE_PUBLIC_VIEWER
is true. Viewer GET routes need no password; POST snapshot ingestion still needs
the dedicated Bearer secret. No buy/sell/start/reset controls. No wallet/provider/
Turnkey secrets or EC2 database access on Render.

Actual source values, read from the installed EC2 runtime:

| Variable | Value |
|---|---|
| POE_ACCOUNT_ID | poe-3123e352-4581-455b-85db-acd7e825e99e |
| POE_INCEPTION_AT | 2026-10-26T22:07:36.212Z |
| POE_RUNTIME_RELEASE | bce3d22bb434eb429aafacb788a18f39ec189c1b |
| POE_STRATEGY_VERSION | UNIMPLEMENTED_FLOW_BLOCKED |

Source identity differs from web code version intentionally: EC2 was not upgraded
or restarted by dashboard changes. It remains financial authority. No account
was reseeded and no legacy record/fixture was imported.

## Deployed verification and recovery

UI6036 changed through another owner path at23:07:24UTC; it was fetched and
preserved. GET-only current verification passed20checks but found missing visible
runtime/strategy metadata. The minimal b3df32c text-display fix is live at23:57:11UTC.
Final22/22 checks at23:57:48UTC verify both versions visible, actual source identity/
arithmetic/history,12cards, mobile390px, no controls/overflow/script errors or
external requests. Snapshot159 facts aged34.7–35.7seconds; one waiting503 resolved
by natural full republication without restarting EC2. See render-current-live.json
in evidence. Prior41-check protocol receipt below remains historical evidence.

evidence/render-public-live-e2e.json records41 passing checks at23:00:23UTC.
Two real EC2 snapshots advanced52→53 over at least36seconds; source/market/
reconciliation ages34.4–40.5seconds. Actual account/inception/runtime/strategy
match; flat-account arithmetic and passive SOL benchmark agree; history retains
inception and a genuine gap. No independent DB financial audit is implied by the
public nonfinancial EC2 status projection.

Anonymous viewer200 and legacy POST405 are intended public-mode behavior.
Private ingress rejects absent/wrong/Bearer-malformed/old-viewer credentials401;
exact real duplicate200 without receiver refresh; old real sequence409;
wrong account400; oversized payload413. Anonymous mobile390px has correct
identity, twelve cards, P&L chart/zero/UTC, no controls, overflow or script errors.
Full snapshots/screenshots stay private outside git; public evidence is sanitized.

The brief empty-cache state during policy clarification/redeploy recovered by
normal full EC2 republication with bounded history. Publishing backoff can reach
five minutes after repeated503s; do not restart EC2 to refresh Render. The
observer retained the same22:30:55 startup and zero restarts through these rollouts.

Environment updates were observed to trigger builds even with auto-deploy off.
Inspect deploy state before an explicit trigger; do not create duplicate rollouts.
Cache loss must wait for full source data, never seed $1,000. Keep one active web
release and usable rollback; no rollback may change financial identity, machine
credential boundaries or EC2. Shared free quota is not replenished by replacement;
no quota failure or paid upgrade occurred, remaining shared usage is unavailable.

Completed inventory, source edits and reporter retirement are not prerequisites
to repeat. Full trading/throughput/backup/forward acceptance remains incomplete;
a fresh public dashboard does not establish strategy readiness or edge.
