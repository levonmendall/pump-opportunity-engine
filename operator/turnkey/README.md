# Existing Turnkey read-only identification

Operator tool only; not installed/loaded by the trader or Render. It reuses the
existing authentication setup with official SDK8.8.0. It does not create wallets,
export wallet keys, sign transactions or submit blockchain transactions.

Organization ID is already known in the task. It is deliberately not hardcoded
into this public repository. The CLI consumes TURNKEY_ORGANIZATION_ID as nonsecret
configuration and getWalletAccounts omits walletId, sets includeWalletDetails=true,
and continues cursor pages until empty. Stalled/capped scans fail rather than
claim completeness. Only when this complete scan finds no Solana wallet accounts,
the tool calls SDK `getPrivateKeys({organizationId})` once. Despite its name,
`/public/v1/query/list_private_keys` returns public metadata, including derived
addresses; it does not return wallet private bytes. This fallback selects only
ED25519 metadata with Solana-format public addresses. Its output contains the
public address, organization ID, private-key identifier and explicit
`sourceKind: standalone-key-public-metadata`, plus curve/format needed for checks.
It does not export key names, public-key components, tags or other metadata.
Wallet-derived accounts retain `sourceKind: wallet-account`.

Solana candidates use the same confirmed mainnet native-balance checks;
non-ordinary account lamports are not assumed available for a simple transfer.
An account record is a candidate, not owner selection or transfer approval.
Different binding records remain separate even if their public addresses match.

The transport allows exactly these two read-only endpoints with per-endpoint
body validation. Metadata requests contain only the organization ID. Signing,
export, secret, individual-key and transaction-submission endpoints are denied.
Responses are streamed with a 200,000-byte cap. Primary enumeration is bounded
to 100 pages, 100 records/page and 1,000 total wallet accounts; the unpaginated
metadata response allows at most 1,000 keys and 64 addresses/key. At most 100
Solana candidates reach balance checks. Exceeding a cap fails the scan without
claiming complete discovery. These are operator safeguards, not a general wallet
inventory service.

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
Only public account data and binding names are returned to the owner's private
terminal. Do not run discovery in GitHub Actions or publish its account/balance
output, credential file, key identifiers or API credentials as artifacts. Provider/
SDK exception details are suppressed because they may include stamped headers.
Multiple sufficient funding-source candidates require owner selection before a
proposal. The CLI's 0.060005 SOL sufficient-candidate heuristic is not a current
fee estimate or an approved transfer proposal.

Current operator status: authentication through the existing protected raw-file
binding `TURNKEY_API_KEY_FILE` is resolved. Read-only organization-wide wallet
enumeration succeeded but found no Solana wallet accounts. A separate read-only
metadata check located the existing standalone ED25519 Solana source, and the
owner explicitly confirmed it as the intended source. Its confirmed native SOL
is insufficient for the proposed 0.06 SOL funding amount plus a transfer fee.
Actual source address, key identifier, balance and private operational details
stay outside this repository. No new key registration, organization, wallet or
keypair is required. Earlier 401/PUBLIC_KEY_NOT_FOUND receipts describe a
historical authentication failure and are superseded; they are not a current
owner action. No transaction signing or broadcast occurred.

## Manual funding is independent

If credential delivery is unavailable, the owner can use the existing Turnkey UI
for the one-time transfer. Only the public sender address is needed for independent
RPC balance/fee verification. Confirm durable recovery of the existing PumpPortal
bundle and approve the complete source/destination/0.06SOL/current-fee/total-debit
proposal before any signing or broadcast. Choosing this route alone is not approval.
