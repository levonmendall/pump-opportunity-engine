# Native PAPER packaging — Cloud-verified scope

This is a separate financial-capable **PAPER-only** bundle. The established
candidate-only builder and its no-financial/no-addon restriction are unchanged.
No provider request, real account read, wallet access, account transfer, or EC2
financial runtime was performed by this work.

## Delivered

- `scripts/build-native-paper-ec2.mjs`: clean committed source, pinned SDK/IDL and
  pure-JS bigint transforms, one exact better-sqlite3 13.0.3 linux-x64 N-API
  addon, separately built backup worker, no external npm runtime resolution.
- `src/native-paper-bundle.ts`: before the writer opens, verifies executable
  against the input hash; source commit; private owner-held regular files;
  compiled addon/worker/lock anchors; Node24/linux-x64/ABI137/glibc platform.
  Returns immutable startup provenance. Plain `tsc` output remains refused.
- The SQLite loader rejects alternate native-binding paths and hashes the exact
  addon before load. This is trusted owner-operated provenance, not a same-UID
  adversarial filesystem sandbox or proof of every vendor SDK variant.
- Only the imported `pilot.ts` and `run-native-candidates.ts` final CLI guards
  are omitted during this bundle build. Their exported algorithms remain. The
  intended native PAPER launcher is the sole operating CLI. The first review
  caught this defect because import-only smoke had not exercised direct CLI.
- The output `verify-native-paper-package.mjs --disposable-smoke` accepts no
  ledger path. It denies ordinary network APIs and creates/removes only a fresh
  private `/tmp` fixture. It imports the packaged trader without starting it,
  then proves actual SQLite idempotency, packaged-worker backup and reopening.
  It can be run on EC2 **before any existing account is transferred**.

## Actual verification

`build-release-review.txt` and `reviewed-metadata.json` identify the final tested
code commit, executable, worker, addon and final metadata hashes. Successful
smoke uses SQLite3.53.4 on Cloud Node24.19.0, ABI137. The separately measured
host Node24.21.0/ABI137/linux-x64/glibc2.39 is compatible in principle; the host
financial probe itself has not run here. It remains necessary.

`focused-final-release.txt`: six guard/tamper/launcher checks pass.
`build-types-final-release.txt`: repository typecheck passes. Earlier compile
passed in `compile.txt`.

`full.txt` deliberately preserves an adverse, concurrent full-suite attempt:
1286 tests, 1282 passes, three failures and one cancellation. Three failures
were backup/compiled-fixture wall timeouts under overlapping suite load; one
static launcher assertion still expected the old literal guard at the caller,
rather than its new verified helper. The assertion was corrected, with the
helper's actual unbundled refusal and compiled tamper behavior covered by the
focused tests. No timing bounds were increased. This is **not a full-suite pass**;
the lead must run one quiet combined suite after merging all repair branches.
No active fixture children remained after this attempt.

The independent review initially blocked the imported-CLI collision, then
approved the corrected Cloud packaging scope. Original failed build logs are
retained. A smoke-time provisional metadata digest is labeled separately; the
final output receipt and actual startup record hash the final metadata bytes.

## Reproduce without market or account access

From a clean, committed checkout containing the integration and packaging:

```bash
node scripts/build-native-paper-ec2.mjs --output-directory /tmp/poe-native-paper-output-review
node --max-old-space-size=192 /tmp/poe-native-paper-output-review/verify-native-paper-package.mjs --disposable-smoke
node --import tsx --test test/native-paper-bundle.test.ts test/native-paper-launcher.test.ts
npm run build
```

The output directory must be new, private and empty. Preserve and pin final
`metadata.json` and all listed file hashes in the existing deployment manifest.
Do not stage a bundle whose `metadata.smoke.exitStatus` is not zero.

After independent host verification and a single-writer, backup-preserving
handoff of the **same existing experimental account**, the launch shape is:

```bash
node --max-old-space-size=256 /PRIVATE/RELEASE/native-paper.mjs \
  --resume --directory /PRIVATE/EXISTING-EXPERIMENTAL-ACCOUNT \
  --input /PRIVATE/RELEASE/verified-input.json \
  --paper-contract confirmed-program-ordinary-flow-paper-v1 \
  --stage single --deep-slots 3 --duration-seconds 900
```

These placeholders are intentionally not a dispatch command. Input hashes must
refer to that exact rebuilt executable and commit; host baseline paths must
carry the already-settled chain once, without resetting usage or reseeding.
Use the existing nonroot resource-bounded supervisor/publisher arrangement.
No persistent financial supervisor or account migration is installed by this
patch. A finite segment's graceful stop preserves exposure and records the
monitoring interruption; it is not continuous protection or 24-hour acceptance.
