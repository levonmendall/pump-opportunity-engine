# Existing POE reporting-token delivery and standalone publisher

Prepared for review only. No real transfer token was read or encrypted, no EC2 receiver key was generated, no workflow was pushed/dispatched, and no publisher was started by this preparation. Unit tests generate disposable synthetic RSA keys/tokens in isolation.

This delivers only the existing pilot ingestion credential from `/workspace/poe-dashboard-publisher/pilot-ingest.secret` to `/home/mm-ec2-runner/.local/share/poe-reporting/pilot-ingest.secret` on verified instance `i-00044d4ea1471b957`, account `133857166104`, region `us-west-2`, as existing UID994 (`mm-ec2-runner`). No source-path argument can select a wallet/provider credential. No credential value or credential hash is logged. It does not call GitHub Actions Secrets APIs or change connection permissions; the previously retained403 remains evidence of that unavailable capability.

The independent native candidate segment creates no financial account or writer. Its reporting identity remains `poe-pilot-8468add6-f916-48cf-a585-6cd008a81360`, inception `1793123773252`, with `entriesEnabled:false`, `financialExecutionAuthorized:false`, and `portfolio:null`. The original EC2 observer/account and original authenticated portfolio channel are untouched.

## Fixed public context and host authentication

The lead derives this exact public JSON object from the actual bounded owner-private Cloud status, hashes those original source-status bytes, and reviews it alongside the native runner's public input `reportingBinding`:

```
{"accountId":"poe-pilot-8468add6-f916-48cf-a585-6cd008a81360","inceptionAt":1793123773252,"sourceStatusSha256":"<ACTUAL_SOURCE_STATUS_SHA256>"}
```

The placeholder is documentation only. It is not a deployable context and must never be replaced with a fabricated digest. The context contains no balance, wallet credential, provider credential or private financial history. Place the reviewed actual JSON in administration repo `scripts/poe/reporting-source-context.json`. Pin its byte SHA256 in the workflow dispatch `source_context_sha256` field.

`poe-reporting-delivery.yml` is intended for the **existing** administration repository at `.github/workflows/poe-reporting-delivery.yml`; `reporting-token-transfer.mjs` goes to `scripts/poe/reporting-token-transfer.mjs`. Workflow access remains `contents:read`, existing self-hosted runner only, main only, serialized by the established administration concurrency group. It verifies current IMDSv2 account/region/instance, runner/UID, capacity, and original public observer state without service control or financial-file reads.

A public RSA receipt by itself does not authenticate a host. Before sealing, retrieve its public receipt from the successful exact reviewed administration run and verify that run's repository/commit, verified instance/account/region/UID and context hash. Do not accept an unsolicited public key.

## One reviewed delivery

1. Generate a fresh nonsecret 32-character lowercase hexadecimal nonce. Dispatch `phase:prepare`, that nonce and the reviewed public-context SHA. The workflow generates one RSA3072 receiver key in a new POE-only0700 nonce directory, with private key0600 and context0600. Missing `.local` / `.local/share` owner components are created0700 sequentially; existing safe modes are preserved and symlinks, writable-by-group/others or wrong owners are refused. It refuses reuse of a prior nonce. It prints only public SPKI, its public-key SHA, nonsecret identity/provenance and public directory identity. The actual receiver key exists only on EC2.
2. Save only the nested `receipt` object from that authenticated run into an owner-controlled public-receipt JSON file. The private key never leaves EC2. Within30minutes, run the reviewed Cloud command:

   ```bash
   node operator/reporting-delivery/reporting-token-transfer.mjs cloud-seal /absolute/public-receipt.json /absolute/reviewed-source-context.json /absolute/reporting-token.cipher
   ```

   This opens only the fixed existing reporting-secret source, requiring owner0600, one link, no symlink, maximum256bytes, and an owner-controlled parent. It preserves the existing publisher's surrounding-whitespace trim convention. RSA-OAEP-SHA256 binds nonce, exact source-status hash, pilot identity/inception, instance and UID. Output is exactly384ciphertext bytes; only that encrypted token representation goes into administration repo `scripts/poe/reporting-token.cipher`. Public script/context/receipt metadata contain no plaintext token.
3. Dispatch `phase:install` with the **same** nonce/context SHA. The host verifies its local private context against the reviewed input and its receipt, decrypts locally, and installs the fixed dedicated reporting file atomically with0600. A differing existing credential is preserved and causes refusal. Matching retries before private-key deletion are nondestructive. Installation reads the destination back and compares bytes in memory without printing a token/hash. It records a nonsecret delivery receipt, then deletes the one-time private key. Failure preserves the existing destination and recoverable receiver state; it does not rotate an original credential or automatically generate another key.
4. Verify the installed file metadata and the independent publisher's `--verify-only` result. Then start the publisher through the existing authorized nonroot supervision arrangement with actual native status path and frozen source identity. Confirm authenticated acceptance and source agreement across two cycles before calling reporting live. A successful file install alone does not prove endpoint acceptance.

The context expires after30minutes from receiver preparation. Expiry, unexpected private state or a conflict is a reason to inspect the exact failed step; never widen paths, print secrets, change permissions, overwrite a different credential, or create an automatic retry loop.

## Exact deployed publisher bundle

`build-publisher.mjs` pins the already deployed reporting commit `a40c75e7256ffdf4aff720cf79e53a0960252246`. It bundles that existing publisher and projector/validator with esbuild0.27.7, producing only standard-library runtime imports, `dist/publisher.mjs` and a public source/hash manifest. No provider SDK, wallet code or ledger code is included. Build code requires an explicit exact reporting checkout and verifies its three source files against the pinned Git blobs before bundling. It does not read reporting source from the research checkout or require those files to be cherry-picked there. The standalone installed artifact needs neither checkout nor build dependencies. The prior9161bundle is preserved unchanged in commit `ef8e6491284d90e56a6803f96e0eb1408d643a1b`; this commit updates only operator artifacts. Current bundle SHA256 is `649f4cc27f74f3aa53fcc831a3437b7e3d9eb8eef63896782b5b451aba1427eb` (30,148bytes).

`run-publisher.sh` requires explicit absolute Node24.19+ path, actual owner-private native status path, installed reporting-secret path, actual account ID and inception. It clears inherited environment/credentials and gives Node filesystem-read permission only for the reviewed bundle, that status file and that reporting file; no filesystem-write/child/worker permission. It preserves the fixed existing HTTPS receiver and validates account/source data through the existing projector. The publisher remains a separate process from market observation or financial management.

```bash
bash operator/reporting-delivery/run-publisher.sh --node /absolute/approved-node \
  --status-file /absolute/native-run/status.json \
  --secret-file /home/mm-ec2-runner/.local/share/poe-reporting/pilot-ingest.secret \
  --account-id poe-pilot-8468add6-f916-48cf-a585-6cd008a81360 \
  --inception-at 1793123773252 --verify-only
```

Use `--once` for one real authenticated report or `--watch` for the existing bounded/backoff publisher only after review and actual installation. These commands were not run against real inputs during preparation. Status and secret must both be private files owned by the publisher UID; do not export a ledger or weaken permissions to fit a different process owner. Sender/publisher process source and actual source timestamps remain separate from receiver contact time.

## Offline validation

```bash
node operator/reporting-delivery/build-publisher.mjs --source-checkout /absolute/exact-reporting-checkout
node --test operator/reporting-delivery/reporting-token-transfer.test.mjs
POE_REPORTING_SOURCE_CHECKOUT=/absolute/exact-reporting-checkout node --import tsx --test operator/reporting-delivery/publisher-bundle.test.mjs
bash -n operator/reporting-delivery/run-publisher.sh
```

The public reporting checkout must contain exactly the a40release source and compiled `dist/src/pilot-telemetry.js` for independent parity tests; the builder reads the pinned TypeScript directly. The optional `native-projection-compatibility.test.mjs` tests use the explicitly identified `/workspace/poe-native-candidate-runner` checkout (projection source bytes pinned6b84c2e), not an assumed research-tree implementation. These four synthetic checks verify native source times pass through the new bundle, including null financial reconciliation. Legacy publishers without source times remain supported by the receiver.

The synthetic tests prove roundtrip/context binding, bounds, owner/mode/link checks, immutable conflicting credentials, interrupted temporary-state preservation, publisher parity, no transport in verify-only, clean environment and restricted filesystem/process access. Workflow YAML and embedded Python/shell are compiled offline. These checks do not constitute an EC2 installation, successful credential delivery, uninterrupted operation, market coverage or trading evidence. Key generation, decryption and the publisher/preflight run with `prlimit --core=0:0` so credential-bearing processes cannot leave core files. No new provider/hosting expense or plan change is involved; existing infrastructure/transfer costs remain separate.
