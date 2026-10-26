# Existing Turnkey read-only identification

Operator tool only; not installed/loaded by the trader or Render. It reuses the
existing authentication setup with official SDK8.8.0. It does not create wallets,
export wallet keys, sign transactions or submit blockchain transactions.

Organization ID is already known in the task. It is deliberately not hardcoded
into this public repository. The CLI consumes TURNKEY_ORGANIZATION_ID as nonsecret
configuration and getWalletAccounts omits walletId, sets includeWalletDetails=true,
and continues cursor pages until empty. Stalled/capped scans fail rather than
claim completeness. Solana accounts get confirmed mainnet native balances;
non-ordinary account lamports are not assumed available for a simple transfer.

## Actual key delivery, not a network placeholder

SDK request stamping is local cryptography. Raw API authentication keys must be
readable by the Node process. A proxy's network-secret placeholder cannot do it.
These are API authentication keys, not the Turnkey wallet's private key.

Supported local consumer configuration:

- A raw JSON secret-file binding outside git, e.g.
  `/workspace/shared/poe-secrets/turnkey-api.json`, owner-held0600, parent0700.
  Fields are `apiPublicKey` and `apiPrivateKey`. Select the file using the
  nonsecret runtime variable TURNKEY_API_KEY_FILE. Do not paste fields into chat.
- Alternatively, genuine raw runtime bindings TURNKEY_API_PUBLIC_KEY and
  TURNKEY_API_PRIVATE_KEY. Placeholder/injected-reference strings are rejected.

Current Cloud status has no secret variable/file bindings, and available tools
only inspect status/diagnostics. No raw delivery is currently verified. Configure
raw secret-file/runtime materialization through an available existing private
Cloud configuration route; network-only injection is insufficient. If the Cloud
profile exposes no such option, do not pretend it works: reuse an already
authenticated backend/session or choose manual owner funding instead.

The consumer validates secret permissions, actual key shape and a matching P-256
authentication pair before an API call, without displaying values. Authentication
is established only by a successful read-only API response; shape alone is not proof.

```sh
cd operator/turnkey
npm ci --ignore-scripts
npm test
npm run discover
```

Use your already-supplied organization ID in the nonsecret environment setting.
Only public account data and binding names are returned. Provider/SDK exception
details are suppressed because they may include stamped headers. Multiple
sufficient funding-source candidates require owner selection before a proposal.

No authenticated query has run in the present environment: raw bindings are
absent. The helper and its SDK/transport/pagination tests are not wallet evidence.

## Manual funding is independent

If credential delivery is unavailable, the owner can use the existing Turnkey UI
for the one-time transfer. Only the public sender address is needed for independent
RPC balance/fee verification. Confirm durable recovery of the existing PumpPortal
bundle and approve the complete source/destination/0.06SOL/current-fee/total-debit
proposal before any signing or broadcast. Choosing this route alone is not approval.
