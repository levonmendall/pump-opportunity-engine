# Issue 11: existing-account upgrade

This package upgrades **the existing** `poe-runtime.service`, account
`poe-3123e352-4581-455b-85db-acd7e825e99e`, inception
`2026-10-26T22:07:36.212Z`, original $1,000 virtual funding. It never initializes,
imports, reseeds, substitutes or restores a ledger. The database stays at
`/var/lib/poe/state/ledger.sqlite`. The original Render `/api/snapshot`
LoadCredential remains the sole publishing channel. No new secret is created.

## Access boundary

The existing administration runner is UID 994. Its available root helpers target
another application and cannot lawfully install/start this POE service. A user
systemd manager is absent. Do not bypass either fact. Package preparation and
review are unprivileged; one owner/root command is required for this original
service cutover. No new sudoers grant, account, provider key, infrastructure,
system user or funding is needed.

## Prepare the reviewed bytes

1. Finish the integrated repository regressions, then freeze a clean exact
   source commit and build the Linux x64 Node 24 / ABI 137 closure. Its existing
   package smoke must pass without provider or real-account access.
2. Through the existing read-only administration path, retain the stopped
   native-source settlement and exact ordered usage chain. Seal it with the
   existing `createResearchBaselineCheckpoint` and verify the exact source
   handoff. Do not invent counters, refund uncertainty, rewrite prior receipts,
   or open/import the experimental financial ledger. Archive irreplaceable
   market evidence independently of later experimental-account retirement.
3. Prepare `input.json` with the new executable identity, supported public
   origins, the original account/inception binding, and the exact SHA of the
   archived original public status. Its sole baseline path must be
   `/var/lib/poe/native-engine/research-baseline.json`; its checkpoint SHA pins
   the actual sealed bytes. Entry evidence and migration timestamps remain
   subject to current runtime validation, not historical support assumptions.
4. Prepare `service.json` with the supervisor's exact schema and `POLICY`,
   actual source/configuration hashes and all five release-file hashes. Start
   with `stage: "single"` and six deep slots. This is initial exposure
   validation, not a permanent candidate/position architecture restriction.
5. Assemble a fresh private output directory:

   ```bash
   python3 -B -I operator/native-paper-ec2/prepare-original-service-package.py \
     --bundle /tmp/poe-native-paper-output-REVIEWED \
     --service-manifest /tmp/poe-service-REVIEWED.json \
     --input /tmp/poe-original-input-REVIEWED.json \
     --baseline /tmp/poe-sealed-usage-REVIEWED.json \
     --original-status /tmp/poe-original-status-REVIEWED.json \
     --output /tmp/poe-original-package-REVIEWED
   ```

The assembler opens no financial account and makes no network request. It emits
the actual source, package index SHA, driver SHA and **one fully literal owner
command**. Do not substitute placeholders for final deployment receipts.

Stage these exact files using the existing runner at
`/var/tmp/poe-issue11-staging`, UID 994, mode 0700 directory / 0600 files. Verify
all indexed sizes and hashes after transfer. The owner executes the emitted
command through their existing root access. It bounds and hashes the driver
bytes before executing those same in-memory bytes, preventing a mutable-checkout
or check/execute race. The driver verifies every other indexed byte before
importing any code, then promotes the cached bytes into root-owned directories.

## What the cutover does

- Confirms the existing EC2 identity, dedicated nonroot user, Node executable,
  `/usr/bin/flock`, canonical original ledger/inode/lease/WAL paths, schema,
  initial funding, inception valuation, action/journal links and reconciliation.
- Requires original observer release `bce3d22bb434eb429aafacb788a18f39ec189c1b`
  and a flat account with no positions, actions or locked deposits. Exposure
  requires an actual financial-management handoff, not this observer cutover.
- Creates and independently audits a durable online backup **before** stopping
  the observer, then settles that service and its financial-owner lease and
  creates an exact current-state backup. Backups live under
  `/var/backups/poe/<commit>`; no backup is restored automatically.
- Installs immutable reviewed code, original-UID input and unchanged usage
  checkpoint; preserves the original secret, environment file and unit.
- Derives the initial provider cooldown from the actual verified flat stop:
  `max(prepared priorCooldownUntil, stoppedAt + 60 seconds)`. This conservatively
  covers unknown original-observer starts. It records prepared/installed input
  hashes and the exact field change; startup provenance pins the installed
  input. This cannot delay existing exposure, because flatness is required.
- Atomically changes the original release link and installs only the reviewed
  original-service drop-in. The sole source owns the original financial lease.
- On a stopped-phase installation failure before any new source starts,
  restores the previous configuration and resumes the previous source. No
  financial backup is copied over current state.
- Records append-only phase receipts plus the current transition under
  `/etc/poe/cutovers/<commit>`. Every interruption remains an actual gap.

The same owner command then waits at most 30 seconds for the existing public
status to identify the new original-account source. It verifies one live
read-only WAL snapshot against the hash-verified stopped backup: original
funding, inception, inception-price hash and rounding remain unchanged, revision
does not decrease, and every column of every old `actions` and `journal` row is
retained. New appended records are allowed. The prefix query has a five-second
progress deadline and a 64 MiB SQLite heap bound; it never restores a backup.

Root-private append-only phase receipts retain the detailed financial audit.
One nonsecret receipt, `/var/lib/poe-public/upgrade-verification.json`, is written
root-owned mode 0644 so the existing unprivileged administration path can read
the result without a second sudo action. It contains source/time/checksums and
row counts, not ledger bodies or credential data. This is a one-time upgrade
receipt, not another reporting process or account channel.

A financial identity/prefix failure suspends new candidates using the existing
admission marker and leaves the new financial manager running. A public-status
startup delay alone remains an incomplete result but preserves ordinary
supervised freshness gates and automatic recovery. It does not create a new
manual financial-authorization requirement. Neither failure automatically
downgrades code, stops financial management or overwrites financial history.

Even a complete final driver receipt proves only these bounded local checks,
not Render parity, protection, opportunity capture, PAPER trading, profitability
or sustained operational acceptance.

## Validate the resulting service

Confirm the actual source/config/input identity, unchanged account/inception,
nonroot source/publisher, one financial owner, fresh status during initial
cooldown and accounting integrity. Verify original-channel Render ACKs and at
least two distinct source snapshots against displayed original-account data.
Check source-age/stopped behavior; a publisher heartbeat must not freshen market
information. Measure real EC2 CPU, memory, disk, network and provider demand.
No synthetic result establishes a natural PAPER entry, exit or profit.

The service has no healthy cumulative CPU, elapsed, request or evidence-stop
budget. Systemd bounds rolling CPU and cgroup memory; source admission reacts
to pressure, unknown measurements and reporting failures while retaining
financial management. Diagnostic rotation never deletes the financial journal
or required market proof. These software checks are not actual host capacity
evidence until the installed source runs.

## Recovery / rollback

Routine restarts remain the same `poe-runtime.service`, source and original
ledger. Do not use the initial installer or `--init`.

The reviewed driver supports `rollback <new-commit>` from its protected
`/opt/poe/cutover/issue11/cutover-original-service.py`. Observer rollback is
allowed only if the current account is flat and its money, costs, realization,
deposits and other obligations remain compatible with the stopped snapshot.
It changes code/configuration only; it preserves every current ledger revision,
journal record and reporting metadata. If exposure appears between audits, the
driver refuses rollback and resumes the **new financial-capable source**.

Once financial effects or open obligations exist, the old observer is not a
management rollback. Keep the new source managing/recovering exposure and repair
forward or deploy a separately verified compatible financial release. Restoring
a backup over healthy newer financial history is prohibited. Actual corruption
requires a separately verified recovery decision accounting for all newer
financial commits; this driver provides no restore command.

Experimental financial storage, publisher, credentials and `/api/pilot` may be
retired only after the original cutover and reporting checks pass. Preserve
irreplaceable market evidence and usage receipts. Do not restart that account
as a workaround for unavailable original-service privileges.
