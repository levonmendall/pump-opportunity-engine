# Data billing wallet; existing Turnkey remains the possible funding source

The owner explicitly retained the existing Turnkey integration. POE does not
rebuild it, create a replacement treasury, export its private key, or perform
signing tests. Funding the separate data wallet is a real transfer and requires
explicit approval of the complete source/destination/amount/fee proposal first.
The simulated $1,000 PAPER account is unrelated to these real operating funds.

## Current setup (2026-10-26)

PumpPortal's documented `GET /api/create-wallet` was used once to establish a
separate **unfunded** data-billing wallet and linked API key:

`6BajxF2CSXTCv5F1HdYH9SFNkqJT94AMW9cCfUq8sSTQ`

Read-only mainnet RPC confirmed0lamports at slot461792869. The credential response
was written directly to a protected file outside this public repository:
`/workspace/shared/poe-secrets/pumpportal-billing-wallet.json` (0600, parent0700).
No secret response, API key or private key was printed. This new provider recovery
key is not a Turnkey private key. Treat the bundle as wallet-capable.

Do not fund until the owner has a durable recovery copy in their existing secret
vault. This managed workspace alone is not asserted to be durable owner recovery.
Use private workspace/secret-vault file handling, not chat, GitHub, logs, Render,
or workflow artifacts. No second billing wallet should be generated on retry.

## Proposed funding; NOT approved or submitted

- Source: existing owner Turnkey Solana account — address and available SOL remain
  unresolved; no Turnkey credential is attached to the managed workspace, no
  Turnkey connector is available, and safe repository metadata did not expose it.
  Existing EC2 integration may still be present; absence here does not prove otherwise.
- Destination: the exact public address above.
- Proposed recipient amount: **0.06 SOL** (60,000,000lamports).
- Expected simple-transfer network fee: **0.000005 SOL** (5,000lamports), priority0,
  obtained from a representative unsigned one-signature/two-account transfer message.
  This was not a Turnkey source-specific quote. Refresh the exact unsigned message
  after resolving the source and before seeking approval. Verify sufficient native
  SOL and any existing Turnkey policy without modifying it or signing a test.
- Expected source debit with that fee: **0.060005 SOL**. No automatic top-ups.
- Preserve **0.02 SOL** as balance floor. At most **0.04 SOL** is data spend,
  and at most0.01SOL/UTCday over the approved four-day measurement experiment.
  Also cap at$2.50/day and$10total, whichever binds first. At documented rates
  this is at most40,000events total/10,000perday before safety headroom and USD caps;
  it does not establish enough capacity for continuous acceptance operation.

No transfer approval is requested until source/address/balance, durable recovery
and an exact current fee are established. No funding, signing or broadcast occurred.
Metered feed authentication is pending funding and credential installation.

## Secure credential installation

Only the API key belongs in the trading runtime. Keep the recovery private key
in the owner's secret vault. After verified authenticated host access, copy files
through that private access path; never carry wallet secrets through GitHub Actions
inputs, repository content, job output or artifacts.

An operator can use `scripts/install-provider-credential.mjs SOURCE TARGET` to
extract only the API key into a new0600file outside the repository. It requires
protected owner-held input/directory, refuses replacement and prints no secret.
The regression test uses a disposable fake bundle. Installation is not yet done.

On EC2, prefer root-owned `/etc/poe/secrets/pumpportal-api-key` and standard systemd
`LoadCredential=poe-pumpportal-api-key:/etc/poe/secrets/pumpportal-api-key` for the
restricted poe-runtime service. The future data adapter should read only that
credential, never the full recovery bundle. A managed secret binding named
`POE_PUMPPORTAL_API_KEY` is also supported as a secure attachment route, with its
value supplied in Secrets, never chat. The public address can be configured as
`POE_DATA_WALLET`. No wallet/provider credential goes to Render.

The EC2 inventory has now completed successfully (run40392851547) on the expected
host. Bounded Turnkey presence/path metadata exposed no usable wallet address or
credential binding. It never read secret file contents or environment values;
absence in this bounded check does not prove the integration is absent elsewhere.
No repeat inventory dispatch is needed. Existing Turnkey's public Solana address
and nonsecret integration location/binding selector remain the precise missing inputs.

References: [wallet creation](https://pumpportal.fun/create-wallet/),
[data requirements](https://pumpportal.fun/data-api/real-time/),
[wallet-capable key semantics](https://pumpportal.fun/FAQ/).
