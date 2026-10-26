# In-place Render replacement — authorized, not yet applied

Only service **srv-daqon53tqb8s73bdceq0** in confirmed workspace
**tea-daqk6h8jo6nc73eojtp0** may change. Keep **free** compute. No new service,
account, database, disk, or paid upgrade. Owner's2026-10-26 amendment supersedes
the earlier separate-dashboard restriction.

Verified current source: `levonmendall/The-Meme-Machine`, branch
`release/pump-blocker-repair-20261011`, Python runtime, root directory empty,
`/healthz`, auto-deploy off. Current resource name is
`meme-machine-dashboard-staging`; current public URL is
`https://meme-machine-dashboard-staging.onrender.com`. The new HTML title/name is
Pump Opportunity Engine. Retain the resource name initially to avoid a gratuitous
URL change, then verify actual URL after deployment.

## Exact owner Settings action needed

The connected Render tools can read service/deploy state and update environment
variables, but cannot update repository/runtime, inspect/revoke deploy hooks or
disconnect a Blueprint. No Render API credential is attached locally. Do not
create another account/service as a workaround.

Once the source release is pushed and EC2 legacy publishers can be stopped:

1. Open [this exact service](https://dashboard.render.com/web/srv-daqon53tqb8s73bdceq0).
   Check remaining free hours, bandwidth and build minutes. Replacement does not
   replenish them. If a quota prevents deploy, stop and report the actual limit.
2. Inspect attached Blueprint/build-source management and any deploy hook. Disconnect
   only this obsolete dashboard's controller/hook so it cannot restore the old app.
   Keep auto-deploy **off**. Do not change unrelated resources or the old Git repo.
3. Stop old dashboard publishers on verified EC2 without stopping protection for
   real assets. Host access/inventory is still pending, so this has NOT happened.
4. In Environment, remove obsolete service-specific variables/secret files and
   detach obsolete groups for this service only. Set `NODE_VERSION=24.19.0` and
   independently generated `POE_VIEWER_USER`, `POE_VIEWER_PASSWORD` (>=16 characters)
   and `POE_INGEST_SECRET` (>=24 characters). Rotate rather than reuse old credentials.
   Do not paste secrets into chat or browser JavaScript. Preserve owner access via
   the new Basic credentials. Never attach provider/wallet/RPC credentials.
5. Leave all four source identity variables absent until EC2 creates the actual
   new account: `POE_ACCOUNT_ID`, `POE_INCEPTION_AT`, `POE_RUNTIME_RELEASE`,
   `POE_STRATEGY_VERSION`. In this bootstrap state the viewer must show
   **Awaiting POE data**, all ingestion returns503 and no account/history is seeded.
   Later configure all four together from the real account; do not substitute fixtures.
6. Settings > Build > Source > Edit: choose
   `https://github.com/levonmendall/pump-opportunity-engine`, branch `main`, runtime
   **Node**, root directory empty, build `npm ci --include=dev && npm run compile`,
   start `npm run dashboard`. Keep `/healthz` and **free** plan. Click Deploy.
   Source update starts a deployment; verify the exact intended SHA first.

These are current documented settings, not a completed deployment:
[changing runtimes/source](https://render.com/docs/native-runtimes#changing-a-services-runtime),
[secret configuration](https://render.com/docs/configure-environment-variables).

## Acceptance after switch

Use the connector to read the actual deploy ID/SHA/runtime/repository and final
service URL. Check `/healthz` without auth; viewer/API/status require owner Basic;
only the machine Bearer may POST. Old Bearer credentials must fail401, and old
legacy routes/POST payloads must fail. Wrong account/sequence conflicts must fail.
Source-unconfigured state rejects every snapshot. No $1,000 balance or chart is
visible before actual valid POE data arrives.

After configuring real account identity, compare snapshot integers/sequence and
displayed values with EC2's actual projection. Exercise cache loss and Render
outage while trading/reconciliation continue, then check bounded republish without
financial duplication. Current local fixture tests do not prove this deployed
agreement or independence.

Retain one tested POE release for rollback. Do not roll back into a legacy app
with obsolete credentials/publishers. A failed reporting deploy must leave EC2's
financial history and position management unaffected.
