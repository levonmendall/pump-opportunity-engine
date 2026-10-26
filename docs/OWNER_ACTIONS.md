# Remaining owner actions

Already completed: EC2 inventory run40392851547/job121818077975; separate repository
and billing-wallet creation; existing Render source/branch/Node/build/start/root/
health/free-plan/auto-deploy settings. No repeat inventory or source edit is needed.

1. **Choose existing Turnkey authentication or manual one-time funding.** Organization
   ID is supplied. No Turnkey secret/outbound binding or connected tool is available
   here. Local SDK request stamping needs actual API authentication key material;
   a network-secret placeholder is insufficient. The prepared consumer supports
   a raw secret-file binding at `/workspace/shared/poe-secrets/turnkey-api.json`
   (owner-only0600file/0700directory), selected by `TURNKEY_API_KEY_FILE`, containing
   `apiPublicKey` and `apiPrivateKey` from the existing API authentication pair.
   Raw runtime-variable bindings are supported only if actual values are delivered,
   not proxy placeholders. API authentication keys are not wallet private keys.
   Current Cloud status declares no secret variable/file bindings; exposed tools
   cannot configure a binding. Use the Cloud configuration's raw secret-file/runtime
   delivery option if available; do not use network-only credential injection for
   this SDK. If that delivery is unavailable, reuse an existing authenticated
   backend/session by its nonsecret connection/binding name, or choose to make
   the one-time transfer yourself from the existing Turnkey setup. No values in chat.
   The supplied organization ID will be used to enumerate all wallet accounts,
   with details and cursor pagination, then read native SOL balances. Do not
   create a replacement Turnkey organization, treasury or integration.
2. **Confirm durable owner recovery of the existing PumpPortal bundle.** It remains
   at `/workspace/shared/poe-secrets/pumpportal-billing-wallet.json`, outside git,
   file0600/parent0700. Through private workspace file access, import the file
   directly into an existing secret vault/password manager, then confirm it is
   preserved. Do not paste/display it in chat or carry it through GitHub, Render
   or workflow artifacts. If private file access is unavailable, identify an
   existing private vault/upload or authenticated file-transfer connection by
   nonsecret name so a private copy route can be established.
3. **Use existing owner/root access for the exact reporter command.** The new
   cutover job was run40397181995/job121833178389 and verified the host and actual
   reporting components. It made no changes because runner sudo policy does not
   permit the exact command below. Do not dispatch inventory or source-edit again:

   ```sh
   sudo systemctl disable --now meme-machine-dashboard-publisher.timer meme-machine-ec2-dashboard-publisher.timer meme-machine-dashboard-publisher.service meme-machine-ec2-dashboard-publisher.service
   ```

   Report completion so resulting states can be verified. This does not alter
   trading/protection services, financial records, runner or shared dependencies.

No funding approval is requested yet. After authenticated account discovery,
native SOL verification, source ambiguity resolution, recovery confirmation and
a current sender-specific fee quote, the owner must explicitly approve the exact
0.06SOL transfer before any transaction signing/broadcast. No automatic top-ups.

Render environment/deploy/verification use available connector operations and
do not require another source-edit or owner deploy click. A manual-only hook or
Blueprint action will be added only if evidence identifies such a controller.
