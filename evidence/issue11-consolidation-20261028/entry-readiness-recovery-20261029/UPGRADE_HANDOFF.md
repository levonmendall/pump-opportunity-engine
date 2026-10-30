# Original POE upgrade: ready, not installed

The reviewed package is staged on the existing EC2 machine. The running service remains source `cdba9d483fdcef105e74e3053a8d4bbf28bdff0c`; this handoff does not claim the new repair has run. Four deep slots, one PAPER position and the original $1,000 account remain unchanged.

| Pin | Verified value |
|---|---|
| Frozen new source | `f96f02eeccd56dda6ce811bdc4405f237224c54f` |
| Native executable | `b3ec5aa43b877a4c5ff44f6217be32a4539766c351deb143d557894ccb118ec9` |
| Configuration | `acbe8e435d4f9f3a61cecc6f511469272890766abf63d8d5b891fc4a5e8085cf` |
| Driver | `e5437db739e8b346e08c340970c6f5365707f86c33a2624d36dbb2dc52c465ae` |
| Package index | `98345ee89aded191b3035aa2c1a03377885169975db1a126c77a060c97411c7b` |
| Service manifest | `8a5d4bac098bfc4cb09e2e58e5b465510082a0ce7863739718f6ad8abe61292c` |
| Compressed transport | `4a0642e5d0a4e8b1e7f5d8a853f3ed46cd6d997200aa753d2b5f1d14428d24c3` |
| Owner command | `49cb98a2d34307d25ed8a8f9f7db38ebb92630f04cacb75eb203b4380c53e34a` |

Application verification:1777/1777 tests, build, independent review, parent-frozen executable import and disposable backup/reopen passed. Upgrade helper verification:44/44 tests and independent exact-byte review passed. The actual inert bundle/current V2 manifest, nine indexed artifacts, ten compressed roundtrips and owner-command safeguards passed. Reporter, supervisor, backup worker, SQLite addon, unit and resource policy remain byte-identical to the installed cdba release.

Actual nonroot staging run `40931614525` at admin commit `1859c4a15bacdfeca0d47192688d2557c5cbb4ad` succeeded at2026-10-29T18:31:35.252UTC. It verified exact staged bytes, the strict unit parser on EC2, and runtime UID988/GID982. Supervisor2460375, zero restarts and active/running state were identical before and after. No root operation, financial database read, provider request, credential read or service control occurred. See `actual-ec2-staging/` for raw output, parsed proof and run identity.

## Owner-only installation

The administration runner is UID994 and cannot modify the protected original service. The following reviewed command verifies the exact single-link driver bytes in memory, then applies the pinned package to the same account/service. This is an installation privilege boundary, not another request to authorize PAPER trades.

```bash
sudo /usr/bin/python3 -B -I -c 'import os,stat,hashlib,sys; r="/var/lib/poe-cutover/forward-f96f02eeccd56dda6ce811bdc4405f237224c54f/forward-original-upgrade.py"; p=r if os.path.lexists(r) else "/var/tmp/poe-original-entry-readiness-upgrade/forward-original-upgrade.py"; f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK); s=os.fstat(f); assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==(0 if p==r else 994) and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<=131072; b=os.read(f,s.st_size+1); os.close(f); h=hashlib.sha256(b).hexdigest(); assert len(b)==s.st_size and h=="e5437db739e8b346e08c340970c6f5365707f86c33a2624d36dbb2dc52c465ae"; sys.argv=[p,"apply","98345ee89aded191b3035aa2c1a03377885169975db1a126c77a060c97411c7b"]; exec(compile(b,p,"exec"),{"__name__":"__main__","__file__":p,"__poe_verified_driver_sha256__":h})'
```

Do not run the superseded96e6-only package command. The new fixed stage is `/var/tmp/poe-original-entry-readiness-upgrade`. A resumed invocation prefers the already root-frozen f96 driver and will not trust changed runner bytes.

## Financial preservation and rollback

Before replacing code, the driver validates the completed cdba forward transition, original root trust index/helpers, exact current V2 supervisor and original account/inception/funding/ledger identity. It verifies complete prior financial action/journal prefixes, creates fresh live and stopped backups, preserves historical root records and before/after configuration images, and requires a graceful stop, physical transport/cgroup settlement and the same financial-owner lease.

Recovery may restore the exact old code/configuration only before any possible new-source execution and only after fresh settlement/lease verification. Once a new start was intended or possible, it retains the new financial manager and never downgrades or restores a financial database. Open exposure and unresolved obligations are preserved. No ledger initialization, reseeding, original history deletion or real-money execution is permitted.

## Required follow-through

1. Read the actual `upgrade-verification.json` receipt through the existing read-only workflow. Require sourcef96/configurationacbe, complete financial prefix verification, unchanged account/inception/funding/ledger and expected resource profile. A successful root invocation is not operational acceptance.
2. Update only the existing Render receiver's expected financial source to f96 after that local verification; retain the same account, dashboard, secret and strategy. Verify new-source acknowledgments and actual mobile/desktop rendering.
3. Run a versioned sustained forward measurement of reconciliation age, automatic safe eligibility recovery, hard-stop persistence, held/pending priority, qualification/attempt idempotence, journal/CPU/RAM/disk-I/O consumption, provider demand and reporting. The service continues beyond finite measurement windows. Preserve real interruption gaps; no24-hour acceptance is claimed here.

Owner execution, post-start financial verification, Render source rebinding and new-source forward validation remain pending.
