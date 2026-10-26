# Remaining owner actions

Completed: repository and billing-wallet creation; EC2 inventory; Render source/
runtime/settings edits; publisher shutdown; reporting credential rotation and POE
deployment. No repeat dispatch, source edit, shutdown, AWS key or deploy click.

1. **Run the pinned initial POE bootstrap once through existing owner/root access
   on i-00044d4ea1471b957.** Follow [EC2_BOOTSTRAP.md](EC2_BOOTSTRAP.md).
   Preflight40404058329/job 121857131607 proved the connected runner lacks the
   exact OS permission; POE user/service are absent. No runner privilege change
   is proposed. During this same private terminal action, supply the existing
   rotated POE_INGEST_SECRET from authenticated Render Environment at its
   non-echoing prompt. This reporting-only secret must not enter chat, GitHub,
   command arguments, logs or artifacts. PAPER entries remain disabled.
2. **Confirm durable private recovery of the existing PumpPortal bundle.**
   File:/workspace/shared/poe-secrets/pumpportal-billing-wallet.json,
   mode0600/parent0700, outside git. If private workspace file access is available,
   import it directly into the existing owner password manager/secret vault.
   Otherwise identify an existing private vault or authenticated file-transfer
   connection by nonsecret name for delivery. Never paste/display the bundle,
   API key or recovery key in chat, GitHub, Render, logs or artifacts.
3. **Resolve Turnkey's public-key registration, or choose manual funding.** The
   supplied complete API authentication pair is already stored in an owner-only
   raw file outside git and passes local pair validation. No more private-key
   delivery is needed. Read-only Turnkey requests return 401 PUBLIC_KEY_NOT_FOUND:
   "no user credentials found in organization with that public key." In the
   existing Turnkey console, register this public API key for the intended
   execution user in organization03a45b97-036b-4766-936e-af7c3eda72c9 with the
   minimum read-only account-query access, or identify its correct existing
   organization binding if it is already registered elsewhere. No new wallet or
   integration is required. Alternatively, use the existing Turnkey interface for
   one-time manual funding and provide only its public Solana sender address.
   Do not repost private keys; no signing/broadcast is authorized by this action.

No transfer approval requested yet. Once public sender/native SOL, destination,
durable recovery and current sender-specific fee are verified, the complete
0.06 SOL proposal requires explicit approval before signing/broadcast. Existing
data-spending caps and0.02 SOL floor remain; no automatic top-ups. The manual route
keeps Turnkey SDK access independent of unrelated PAPER development.
