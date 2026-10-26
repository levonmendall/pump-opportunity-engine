# In-place Render cutover

Only service **srv-daqon53tqb8s73bdceq0** in workspace
**tea-daqk6h8jo6nc73eojtp0** is authorized. Keep the existing **free** plan,
resource name and URL. No second service, account, database or paid upgrade.

## Completed source settings — connector verified

The source change is complete. Current connector values:

| Setting | Verified value |
|---|---|
| Repository | https://github.com/levonmendall/pump-opportunity-engine |
| Branch | main |
| Runtime | Node |
| Root directory | empty |
| Build | npm ci --include=dev && npm run compile |
| Start | npm run dashboard |
| Health | /healthz |
| Compute | free |
| Auto-deploy | off |
| Name | meme-machine-dashboard-staging |
| URL | https://meme-machine-dashboard-staging.onrender.com |

**No owner source edit is needed.** Source settings are not proof of a deployed
POE release. At this check the latest live deploy remains
`dep-dbff60e7bikc73dano8g`, legacy SHA
`f88936378af75c3064cd2ba2bf980c1b4682aa6e`.

## Remaining authorized work

1. Retire only the verified old reporting publishers and their30-second timers.
   EC2 inventory is complete and must not be rerun as a readiness gate. Prepared
   admin job: `.github/workflows/poe-dashboard-cutover.yml` in meme-machine-admin.
   It checks actual component roles and existing sudo permission, then targets only:

   ```sh
   sudo systemctl disable --now meme-machine-dashboard-publisher.timer meme-machine-ec2-dashboard-publisher.timer meme-machine-dashboard-publisher.service meme-machine-ec2-dashboard-publisher.service
   ```

   Do not stop the runner, trading/protection services, or shared dependencies.
   Reporter-retirement run40397181995/job121833178389 now verified actual roles
   and failed only its exact sudo permission check, exit3, changed=false. One
   EC2 publisher timer remains active/enabled. The specific manual-only action is
   that exact command through existing owner/root access. Do not rerun inventory,
   request AWS administrator credentials, or invoke a legacy readiness broker.
2. Replace obsolete service-specific environment values with only Node version
   and newly rotated independent viewer/ingestion credentials. Use connector
   replace=true; never retrieve/log old secret values. New credentials are
   prepared in protected storage outside git and unrelated to the data wallet.
   Owner can retrieve viewer credentials privately through their authenticated
   Render Environment console after installation. No wallet, RPC, Turnkey or
   provider secret goes to Render. Leave all four authoritative source identity
   variables absent until actual PAPER inception.
3. Inspect any evidenced restoration path. Former dashboard CI is test-only.
   No external Blueprint/controller was identified. An ordinary deploy hook now
   deploys the current POE source, so possible hook existence is not proof of a
   legacy restoration controller. Connector has no hook/Blueprint inspection;
   request a manual disconnect only if a specific controller is identified.
4. Freeze/test/commit/push the intended POE release. Record local/remote SHA and
   prevent competing pushes during deploy. With auto-deploy off, use the
   connector trigger-deploy operation. Capture deploy ID, monitor to terminal
   state and verify live repository/SHA/runtime/URL. A successful trigger alone
   is not a successful cutover.

No quota failure has been observed. Replacement does not replenish consumed free
hours/build/bandwidth. If Render reports a limit, preserve the exact failure and
continue independent work without upgrading compute.

## Deployed checks

Check `/healthz`200 without auth; `/` and `/status` require owner Basic; only the
new machine Bearer may POST. Wrong credentials fail401; old publisher routes
must not accept data. No old financial records may appear. Until authoritative
identity is configured, show **Awaiting POE data**, reject all authenticated
snapshot ingestion with503source-not-configured and keep the cache empty. Never
seed a dashboard balance or historical P&L line.

After the actual EC2 account exists, configure all four identity fields together,
compare account/sequence/integer projection with the dashboard, and test cache
loss/republication and Render outage without financial duplication. Local fixtures
do not establish deployed EC2 agreement or unattended acceptance.

Keep one tested POE rollback release. Do not restore obsolete legacy credentials,
publishers or financial identity. Dashboard rollout/rollback cannot restart EC2.
