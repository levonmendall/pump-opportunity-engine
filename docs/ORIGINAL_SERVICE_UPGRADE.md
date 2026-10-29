# Original POE service upgrade — prepared, staged, not installed

The sole target is original account `poe-3123e352-4581-455b-85db-acd7e825e99e`, inception `2026-10-26T22:07:36.212Z`, original virtual funding $1,000. Its database remains `/var/lib/poe/state/ledger.sqlite` and its service remains `poe-runtime.service`. No ledger is initialized, imported, reseeded or restored by this package. No experimental service or financial account is created. Real blockchain execution stays disabled.

The actual EC2 stage was verified by run [40796418549](https://github.com/levonmendall/meme-machine-admin/actions/runs/40796418549). All 14 files (13 payload files plus index) matched local hashes after transfer. The original service was active under `poe-runtime`, PID `2333724`, NRestarts `0`, before and after staging. Protected original-ledger auditing, installation and new-source operation have **not** occurred.

## Exact reviewed identity

- Application source: `5e55d8b939de99698ddb311a282461931fcbc957`.
- Application executable SHA256: `531012e82b6cb86149350ec4478c1f7a7b87b6f35f08f3b1f32447f05cd31eaa`.
- Configuration SHA256: `5e99ebe042521b3917a11b86ef4b46264205b11d38c407cba264a01046a79344`.
- Package index SHA256: `fa616981e2a86aec0f9c2711d0b3c961eb5ab922791f49e2a4e7e372497a84dd`.
- Privileged driver SHA256: `2b1eb71355697fbdc9459b2dd354ed869102aa448a1e500b769b57fa91890fab`.
- Transport SHA256: `093f5d27c1eb0047328ea7420cb2859c76e23c45d4f22d8b6c21ff4770d536f7`.
- Operator implementation: `cd43ecf70f8ccee11ee3cf177a9c7918aa317675` plus its reviewed predecessors; all operator bytes are independently pinned by the package index.
- EC2 delivery commit: `d412f14892d8c23be9987f3c9c8477d669663522` in the existing administration repository.

The application artifact is frozen read-only at `/tmp/poe-native-paper-output-original-issue11-20261029` in this workspace. The installation payload is already at `/var/tmp/poe-issue11-staging` on EC2, private UID 994. The operating profile starts with six deep-observation slots and one PAPER position as initial exposure validation, preserving the frozen buying rule and existing financial limits. These are not permanent market-capacity limits. Fresh migration discovery supplies current candidates; no historical hint is assumed a supported current pool.

## One owner action

The existing runner's root-authorized maintenance helpers target another application. They cannot safely install POE; there is no user systemd manager. No sudoers change or new administrative mechanism is included. From an existing sudo-capable session on EC2 `i-00044d4ea1471b957`, run this **one-time** command:

```bash
sudo /usr/bin/python3 -B -I -c 'import os,stat,hashlib,sys; p='"'"'/var/tmp/poe-issue11-staging/cutover-original-service.py'"'"'; f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK); s=os.fstat(f); assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==994 and not s.st_mode&0o022 and 0<s.st_size<=131072; b=os.read(f,s.st_size+1); os.close(f); assert len(b)==s.st_size and hashlib.sha256(b).hexdigest()=='"'"'2b1eb71355697fbdc9459b2dd354ed869102aa448a1e500b769b57fa91890fab'"'"'; sys.argv=[p,'"'"'bootstrap'"'"','"'"'fa616981e2a86aec0f9c2711d0b3c961eb5ab922791f49e2a4e7e372497a84dd'"'"']; exec(compile(b,p,'"'"'exec'"'"'),{'"'"'__name__'"'"':'"'"'__main__'"'"','"'"'__file__'"'"':p})'
```

The command reads bounded, owner-checked, no-follow driver bytes, verifies their literal hash and executes those same in-memory bytes. The driver then verifies the entire literal package-index hash and every payload before importing root-owned cached helpers. It independently verifies EC2 identity, existing Node 24.19/ABI137, the original service, exact account/inception/funding, canonical ledger/owner lease, and flatness. It refuses incompatible state before stopping the original writer.

## Backup and financial verification

The command creates a WAL-aware verified backup while the observer runs, then settles its service/financial lease and creates another exact current-state backup. Protected backups live at `/var/backups/poe/5e55d8b939de99698ddb311a282461931fcbc957/before-stop.sqlite` and `ledger.sqlite`. Actual backup byte hashes, state hashes, original inception valuation and revisions are recorded in root-protected cutover receipts. Their hashes cannot truthfully be supplied before the command reads the protected account.

Every original-database SQLite open, query and close runs under the existing runtime's effective UID/GID. This prevents a root read-only reader from creating root-owned WAL/SHM sidecars. Same-account temporary backup files are verified and closed in DELETE mode before their exact bytes are frozen into protected recovery storage; these are backups, not operating portfolios.

After startup, the command performs another consistent read-only financial audit. It compares every column of every prior journal/action row against the verified stopped backup, verifies unchanged account, inception, initial funding and valuation basis, and checks revision monotonicity. It neither samples the financial prefix nor copies an old backup over newer state. Financial verification failure closes candidate admission while preserving the new financial manager and obligations. A source-status-only timeout uses existing reporting/recovery interlocks rather than introducing a permanent permission gate.

A safe one-shot result is readable at `/var/lib/poe-public/upgrade-verification.json`; protected phase receipts remain under `/etc/poe/cutovers/5e55d8b939de99698ddb311a282461931fcbc957/`. The existing supervisor also exposes only matched delivery metadata at `/var/lib/poe-public/accepted-source.json` for comparison with Render. It contains no snapshot body, financial database or credential, and creates no additional publisher or reporting channel.

The initial provider pause is derived once from the actual verified flat stop, conservatively covering unknown original-observer request starts. Prepared and installed input hashes and the exact cooldown-field difference are receipted. Startup provenance records the actual immutable installed input. Reporting status is available before provider work.

## Recovery and rollback

Before any new source starts, a stopped-phase installation failure restores only the previous code/configuration and resumes the original observer. Once the new financial-capable source has started, it is never automatically replaced by the observer on a reporting or verification error. Positions and pending actions remain preserved.

Observer code rollback is permitted only when cash, costs, realization, reserves and exposure remain compatible with the stopped financial state. It preserves all current ledger revisions and reporting metadata. The exact guarded command, only if rollback is needed, is:

```bash
sudo /usr/bin/python3 -B -I /opt/poe/cutover/issue11/cutover-original-service.py rollback 5e55d8b939de99698ddb311a282461931fcbc957
```

If exposure appears between rollback audits, rollback is refused and the same financial-capable source is resumed. After financial effects/open obligations, repair forward or use a verified compatible financial release; the old observer is not a position-management rollback. Backup restoration over healthy newer history is prohibited. An offline current→installed-`bce3d22`→current fixture independently preserved state bytes, revision, legacy history and new reporting metadata; actual service rollback remains unexecuted.

## Verified scope and remaining work

The integrated application passed 1,684 repository tests, build, compile, and network-disabled immutable packaging/backup/reopen smoke. The final operator package passed 54 focused Python tests; the staging helper passed five independent tests. These are offline results, not trading acceptance.

Actual settled accounting preparation [40793644280](https://github.com/levonmendall/meme-machine-admin/actions/runs/40793644280) preserved 8,959 source units, 1,016,377,544 accounted response bytes, and 519,831,552 uncertain bytes. The 33 auxiliary units remain separately documented. Historical refusals and uncertain debits were not reset/refunded. No provider requests or financial-database access occurred in preparation or staging. Existing compute/transfer/storage costs remain separate and unverified.

After the owner command, Codex must verify actual financial/source receipts, deploy the compatible reviewed receiver to the **existing** Render service, bind its expected original-source release, and compare at least two matched current-source receipts with Render. Original channel/secret/account remain unchanged. No further owner approval is needed for those already-authorized reporting steps. The owner's newer Render commit `c41c82b` and always-visible P&L are preserved by the prepared reporting merge `9ef309d`/`3e5574f`.

Do not delete experimental financial files/credentials before original cutover and reporting verification. Do not claim a natural PAPER trade, sustained protection, profitability or 24-hour acceptance from this prepared package. The old observer remains the actual running source until the owner command succeeds.

## Indexed payload

| File | Bytes | SHA256 |
|---|---:|---|
| audit-original-account.py | 12369 | `08947c651488089e2eb2274404e69132ab54cfb89e30a640255c756746dad2c1` |
| backup-worker.mjs | 73859 | `53700fadf7172fd5f85b9f368256b0b6592abfc3a55adce8481812c0c154ea34` |
| better_sqlite3.node | 2226168 | `6fd4292c6c5f352436cd85c9e1cb286978efa43c20ae350973f83414ced9991d` |
| cutover-original-service.py | 35053 | `2b1eb71355697fbdc9459b2dd354ed869102aa448a1e500b769b57fa91890fab` |
| input.json | 762 | `9aa1eed53589c448bfebf60fdc1cf47f44bcd6e90f465d6d20906f63ef6cae02` |
| metadata.json | 154684 | `5ab32a3a4c960a0378b2194756419a4cc8cd5faae3b18a27e74b783ee7143d00` |
| native-paper.mjs | 5052042 | `531012e82b6cb86149350ec4478c1f7a7b87b6f35f08f3b1f32447f05cd31eaa` |
| original-status.json | 674 | `9e96f7504e7396dc8f0ec2c89829eb59ea1c3668cf19bc4487246213098aadeb` |
| poe-runtime-persistent.conf | 926 | `02086524f05593a85034bf13626f0c2c0a4caac2379cc4ae76cfa92d93d4b682` |
| research-baseline.json | 21021 | `7c26978f49f0edbb6026766645e8dbbb0af006a7874cdb89949d92cf58ec1a43` |
| run-authoritative-service.py | 36169 | `d90ea175e17ef165afc8a4dcc24ab302204d500aad738bd4554cdc5f32e3d6fb` |
| service.json | 1950 | `8a5b08b27a313a5efc8fb8b15f091f43f3dc639cb1ca0155ab36b8a09cc18555` |
| snapshot-publisher.mjs | 28874 | `4d80782c1cf6d31aec51c56f088283360f2f90760dd7489d621bbe124cb3df3f` |
