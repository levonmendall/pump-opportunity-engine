# In-place Render cutover — deployed bootstrap viewer

## Owner-requested public viewer mode (2026-10-26)

This section supersedes the earlier authenticated-viewer notes below. The existing
free Render service was switched to public read-only viewing at source
`2bd35bf9053cba64e01db672d4059583ff5cf54c`, deployed live as
`dep-dbftds142hec73dhlkl0`. `POE_PUBLIC_VIEWER=true`; old
`POE_VIEWER_USER` and `POE_VIEWER_PASSWORD` values were cleared.
Anyone with the URL can GET `/`, `/status`, `/api/snapshot` and
`/api/export`, including published portfolio history and decisions.
POST `/api/snapshot` still requires the private `POE_INGEST_SECRET`
Bearer token. Never attach wallet/provider/trading secrets to Render.

Deployment build, process startup and live status passed. Direct unauthenticated
browser GET verification from this environment was unavailable; verify from a
fresh browser session as an additional acceptance check.

Only service **srv-daqon53tqb8s73bdceq0** in confirmed workspace
**tea-daqk6h8jo6nc73eojtp0** was modified. Existing free compute, resource name
and URL retained. No second service/account, database or paid upgrade.

| Setting | Connector-verified value |
|---|---|
| Repository | https://github.com/levonmendall/pump-opportunity-engine |
| Branch / runtime / root | main / Node / empty |
| Build | npm ci --include=dev && npm run compile |
| Start / health | npm run dashboard / /healthz |
| Compute / auto-deploy | free / off |
| Name | meme-machine-dashboard-staging |
| URL | https://meme-machine-dashboard-staging.onrender.com |
| Live deploy | dep-dbfs7dafngtc73cs4p40 |
| Live source | 3af3f9ed9abde5178379e18e986e07ab41965d22 |
| Live finished | 2026-10-26T21:19:31.379Z |

## Completed prerequisites

Source/runtime edits and EC2 inventory are complete; neither needs repetition.
Owner/root shutdown of the four reporting units was verified21:15:13UTC in
run 40397181995 attempt 2/job 121852666626: both timers inactive/disabled; both
services static/non-running, one old failed flag. No enabled restart path remains
for these reporters. The unchanged workflow still asks for sudo and exits3 after
observing the completed state; no repeat shutdown or reset-failed is needed.

Obsolete service-specific environment was replaced with Node24.19.0 and newly
rotated independent viewer/ingestion credentials. No wallet/provider/RPC/Turnkey
secret went to Render. Owner uses HTTPS Basic, user poe-owner; retrieve password
privately through authenticated Render Environment. The reporting-only ingestion
secret will reach EC2 through private owner administration, never GitHub/artifacts.

No legacy restoration controller identified; former dashboard CI was test-only.
An ordinary deploy hook now uses POE source. No evidenced hook/Blueprint action
requires an owner. Environment replacement triggered a successful deployment even
with auto-deploy off; a redundant explicit same-release rollout produced the final
live deploy above. Inspect state after future environment changes before triggering
another build. No further deployment is needed for the empty bootstrap state.

No quota failure observed. Replacement did not replenish shared free hours/build/
bandwidth; remaining quota is unavailable through connector. Keep free compute.

## Deployed verification

See evidence/render-deployed-auth-bootstrap-check.json and
evidence/render-deployed-mobile-check.json.

- /healthz200; unauthorized viewer401; authenticated owner200.
- Empty snapshot/export503; viewer cannot ingest; wrong machine Bearer401.
- New machine Bearer503source-not-configured. All four source identity fields
  absent until actual EC2 inception. No fixture accepted.
- Legacy /api/dashboard/snapshot rejects401. Old credentials/configuration
  replaced; no legacy financial records appear.
- Mobile390px: correct POE name, Awaiting POE data, PAPER/live disabled,
  no fabricated money/chart, no overflow/script errors.

This is a deployed authenticated empty viewer, not fresh EC2 reporting, financial
integration or unattended acceptance. Render cannot read EC2's database, call data
providers, control the runtime or become financial authority.

## Remaining integration after root bootstrap

Read actual EC2 account/inception/release/strategy from its bounded nonfinancial
status file. Set all four source fields together: POE_ACCOUNT_ID, POE_INCEPTION_AT
(UTC ISO milliseconds), POE_RUNTIME_RELEASE, POE_STRATEGY_VERSION. Never use
disposable identity. Connector environment updates affect only reporting, not EC2.

Compare accepted account/sequence/integer projection with EC2, then verify
duplicate/out-of-order/wrong-account rejection, cache loss/full republication and
Render outage without financial duplication. These deployed checks remain pending.

Keep auto-deploy off during acceptance. Dashboard rollback is independent of EC2;
retain this verified POE release, never restore old credentials/publishers/financial
identity. render.yaml describes only the existing service; do not create a duplicate
Blueprint/service. Remaining owner actions are only in OWNER_ACTIONS.md.
