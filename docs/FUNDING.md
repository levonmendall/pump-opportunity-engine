# Existing billing wallet and Turnkey source

The $1,000 PAPER account is virtual and unrelated to real funding. No transfer
signing/broadcast or live trading is authorized. Preserve both existing wallets.

## Completed authentication

Owner registered the existing API public key. Turnkey authentication now works.
TURNKEY_API_KEY_FILE selects /workspace/shared/poe-secrets/turnkey-api.json,
0600/parent0700, outside Git. This is actual local SDK stamping material, not a
network-secret placeholder. Do not display, replace or install it on Render/trader.

Operator-only official SDK8.8.0 completes getWalletAccounts across organization,
includeWalletDetails=true and pagination. No Solana wallet accounts returned;
bounded read-only standalone-key PUBLIC metadata resolved the funded ED25519 source.
Owner independently confirmed its public address; confirmed native RPC checked
balance. Actual treasury details remain private outside this public repository.
See evidence/turnkey-readonly-resolution.json. Historical PUBLIC_KEY_NOT_FOUND is
resolved, not a current owner action. No wallet-key export/signing test/transfer.

## Existing billing destination and recovery

Public destination: `6BajxF2CSXTCv5F1HdYH9SFNkqJT94AMW9cCfUq8sSTQ`.
Existing complete bundle:
 /workspace/shared/poe-secrets/pumpportal-billing-wallet.json,0600/parent0700.
Created once without printing values; latest23:38:36UTC confirmed0SOL.
Treat the bundle/API as wallet-capable. Keep recovery key outside runtime.

Durable owner recovery is unconfirmed. The supplied route reply still contains
its name placeholder. No vault/transfer route is named and callable. Supply only
nonsecret existing connection details; then exact private retrieval/import steps
can be verified. No invented download link or secret delivery in chat, GitHub,
Actions, Render, logs or public artifacts. No replacement wallet.

## Funding remains incomplete; no approval requested

Requested recipient amount:0.06SOL (60,000,000lamports). Confirmed source balance
at23:38:36UTC is insufficient for that plus fee. It was not topped up/replaced.
A smaller experiment requires owner choice; never silently reduce coverage.

Prior representative one-signature fee:5,000lamports (0.000005SOL),
expected debit0.060005SOL. **Not a current sender-specific proposal.**
After recovery and sufficient amount/balance, build only an unsigned exact
source/destination message, refresh blockhash/fee and balance, then present
source, destination, amount, fee and total debit for explicit approval.
No automatic top-ups. Manual existing-Turnkey UI transfer remains an alternative
after those checks; rebuilding access never blocks unrelated PAPER development.

At0.06SOL funding,0.02SOL floor leaves at most0.04SOL for data. Measurement caps:
0.01SOL/UTCday,0.04SOL/four-day total,$2.50/day/$10total whichever binds.
At documented event rates, at most10,000events/day/40,000total before USD/safety
constraints. This does not prove four-day continuous coverage. Measure real
billed rates/useful windows/charges before budgeting24/72-hour acceptance.
Additional spend needs approval.

## Secure runtime installation

Only the API key later enters EC2. Never transport secrets through repository/
Actions inputs/output/artifacts, Render or chat. The standard extractor
scripts/install-provider-credential.mjs reads a protected bundle into a NEW0600
API-only file and refuses replacement. Prefer root0600
/etc/poe/secrets/pumpportal-api-key plus systemd
LoadCredential=poe-pumpportal-api-key:/etc/poe/secrets/pumpportal-api-key.
The consumer reads only that credential. Installation, authentication and actual
billing measurement are unperformed. Trading/submission/remote-signing remain denied.

References: https://pumpportal.fun/create-wallet/ ,
https://pumpportal.fun/data-api/real-time/ , https://pumpportal.fun/FAQ/ .
