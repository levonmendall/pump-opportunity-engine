# Original POE service upgrade — launch configuration corrected; standard start pending

The sole target is original account `poe-3123e352-4581-455b-85db-acd7e825e99e`, inception `2026-10-26T22:07:36.212Z`, original virtual funding $1,000. Its database remains `/var/lib/poe/state/ledger.sqlite` and its service remains `poe-runtime.service`. No ledger is initialized, imported, reseeded or restored by this package. No experimental service or financial account is created. Real blockchain execution stays disabled.

The original stage was verified by run [40796418549](https://github.com/levonmendall/meme-machine-admin/actions/runs/40796418549). The owner subsequently ran its bootstrap and received `ORIGINAL_WRITER_MUST_BE_SETTLED`. The indexed control path reached that predicate after a successful service stop and original owner-lease acquisition; it restarted the original observer before any new-source start. The precise first-failure stop state was not recorded and remains unknown. Do not repeat bootstrap or delete retained preparation.

Read-only host run [40798966387](https://github.com/levonmendall/meme-machine-admin/actions/runs/40798966387) confirmed the recovered original observer, PID `2431222`, original source/account/inception, entries disabled. The guarded repair is now separately staged by run [40801911352](https://github.com/levonmendall/meme-machine-admin/actions/runs/40801911352), with exact hash readback and that same PID/state unchanged. Actual root continuation and new-source operation remain **unverified**. The initial protected financial audit/backup is inferred from the old control path; its detailed root receipts must still be verified.

Current status supersedes the earlier staging/refusal history above: native source is installed and the launch-order rename/reload has completed. Actual run40805746959 confirms the correct native command and independently verified empty stop array, but the service is stopped after a text-metadata parsing refusal. Use the standard start below; do not repeat historical installation or repair commands.

## Exact reviewed identity

- Application source: `5e55d8b939de99698ddb311a282461931fcbc957`.
- Application executable SHA256: `531012e82b6cb86149350ec4478c1f7a7b87b6f35f08f3b1f32447f05cd31eaa`.
- Configuration SHA256: `5e99ebe042521b3917a11b86ef4b46264205b11d38c407cba264a01046a79344`.
- Package index SHA256: `fa616981e2a86aec0f9c2711d0b3c961eb5ab922791f49e2a4e7e372497a84dd`.
- Original indexed driver SHA256: `2b1eb71355697fbdc9459b2dd354ed869102aa448a1e500b769b57fa91890fab`.
- Transport SHA256: `093f5d27c1eb0047328ea7420cb2859c76e23c45d4f22d8b6c21ff4770d536f7`.
- Operator implementation: `cd43ecf70f8ccee11ee3cf177a9c7918aa317675` plus its reviewed predecessors; all operator bytes are independently pinned by the package index.
- EC2 delivery commit: `d412f14892d8c23be9987f3c9c8477d669663522` in the existing administration repository.

The application artifact is frozen read-only at `/tmp/poe-native-paper-output-original-issue11-20261029` in this workspace. The installation payload is already at `/var/tmp/poe-issue11-staging` on EC2, private UID 994. The operating profile starts with six deep-observation slots and one PAPER position as initial exposure validation, preserving the frozen buying rule and existing financial limits. These are not permanent market-capacity limits. Fresh migration discovery supplies current candidates; no historical hint is assumed a supported current pool.

## One owner standard start

The owner ordering repair **completed the rename and systemd reload**. Actual run [40805746959](https://github.com/levonmendall/meme-machine-admin/actions/runs/40805746959) confirms the correct native Python command, correct `00-legacy`/`90-native`/`reporting` drop-ins, both PIDs zero and inactive/dead.

The repair's metadata guard then refused because `systemctl show --all` omits an empty `ExecStop` command array. An independent typed D-Bus query verified exactly `a(sasbttttuii)` with zero entries. No other required field is missing. The maintenance parser is corrected on the review branch and 20 focused plus63 existing checks pass; this is not a new application release or claimed live repair execution.

No further installation, rename, daemon reload, reset, account initialization or custom helper is needed for this confirmed state. Start the existing original service from the sudo-capable EC2 terminal:

```bash
sudo /usr/bin/systemctl start poe-runtime.service
```

The runner lacks that root permission. Independent review approved this normal same-unit/source/account restart; the native supervisor retains host, root-manifest/executable, account and exclusive lease checks. It may append normal PAPER financial records. Previous financial identity/funding and all36,834actions/36,835journal rows remain verified by the retained receipt; fresh source/account, post-start financial-prefix and matched Render reporting still require actual runtime evidence.

Literal [START_OWNER_COMMAND.txt](../evidence/issue11-consolidation-20261028/empty-exec-stop-20261029/START_OWNER_COMMAND.txt); actual metadata and regressions in that directory. Earlier long bootstrap/resume/ordering commands are historical evidence, not next actions. No healthy manager, natural trade or acceptance interval is claimed before actual startup verification.

## Backup and financial verification

The original control path prepared `/var/backups/poe/5e55d8b939de99698ddb311a282461931fcbc957/before-stop.sqlite` before its refusal. It did not reach creation of the stopped `ledger.sqlite` backup. Continuation verifies the retained before-stop backup and its complete historical prefix, then creates fresh `before-stop.sqlite` and stopped `ledger.sqlite` backups in the numbered retry directory. Actual backup hashes, state hashes, inception valuation and revisions remain in protected receipts; detailed private results must be verified after authorized execution.

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

If observer-code rollback is used after binding Render to5e55, verify actualbce source and restore the SAME channel's expected bce release/UNIMPLEMENTED_FLOW_BLOCKED strategy before claiming reporting recovered. Keep account and secret unchanged.

If exposure appears between rollback audits, rollback is refused and the same financial-capable source is resumed. After financial effects/open obligations, repair forward or use a verified compatible financial release; the old observer is not a position-management rollback. Backup restoration over healthy newer history is prohibited. An offline current→installed-`bce3d22`→current fixture independently preserved state bytes, revision, legacy history and new reporting metadata; actual service rollback remains unexecuted.

## Verified scope and remaining work

The integrated application passed 1,684 repository tests, build, compile, and network-disabled immutable packaging/backup/reopen smoke. The original indexed operator package passed 54 focused Python tests; its original staging helper passed five independent tests. The separately pinned administrative continuation passed 63 operator checks plus six independent additional refusal cases. These are offline results, not trading acceptance.

Actual settled accounting preparation [40793644280](https://github.com/levonmendall/meme-machine-admin/actions/runs/40793644280) preserved 8,959 source units, 1,016,377,544 accounted response bytes, and 519,831,552 uncertain bytes. The 33 auxiliary units remain separately documented. Historical refusals and uncertain debits were not reset/refunded. No provider requests or financial-database access occurred in preparation or staging. Existing compute/transfer/storage costs remain separate and unverified.

The compatible receiver `79195ecfb2aaf138715a730194edf1a489937fc1` is already live on the **existing** Render service: deployment `dep-dbha06qfngtc73b2dgo0`, finished 2026-10-29 01:24:20.876Z. It preserves the owner's `c41c82b` UI/manual refresh/P&L and existing authentication/source checks while accepting optional validated original-account intelligence. Its 228-test suite, build and compile passed; independent reporting/schema checks passed. Actual original-source cycles remain accepted and an unauthenticated POST returned401.

Render expected-source binding has now been merged to5e55/persistent-buying-pilot-v1, preserving all other configuration and the original secret. Same79195receiver configuration deploymentdep-dbhai58n74is73cqva40 is live (2026-10-29 02:02:40.046Z); healthz200/api/snapshot503AwaitingPOEdata honestly show receiver availability without a current source. After owner correction, Codex must verify actual protected financial/source receipts and compare at least two matched current-source receipts with Render. Original channel/secret/account remain unchanged. No further owner approval is needed for these ordinary reporting steps. The future unified reporting merge `9ef309d`/`3e5574f` must be reconciled with current `79195ec` main, preserving newer work and retiring experimental backend/credentials only after safe original cutover/reporting.

Do not delete experimental financial files/credentials before original cutover and reporting verification. Do not claim a natural PAPER trade, sustained protection, profitability or 24-hour acceptance from this prepared package. The corrected native launch is selected; the unit awaits the standard owner start. No healthy native financial manager or natural trade is claimed yet.

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
