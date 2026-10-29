# One-off source restart evidence exporter

This tool collects a bounded, sanitized explanation of the native child restart
observed around 2026-10-29 18:50:51 UTC. It is not a runtime, publisher, account,
financial migration, recovery operation, or operational-acceptance claim.

The exact cause is still unknown until the reviewed tool runs on EC2 and its
output is examined. Passing these tests does not establish the restart cause.

## Frozen inputs

- Original account: `poe-3123e352-4581-455b-85db-acd7e825e99e`.
- Source commit: `f96f02eeccd56dda6ce811bdc4405f237224c54f`.
- Native source SHA256: `b3ec5aa43b877a4c5ff44f6217be32a4539766c351deb143d557894ccb118ec9`.
- Configuration SHA256: `acbe8e435d4f9f3a61cecc6f511469272890766abf63d8d5b891fc4a5e8085cf`.
- Runs: `native-paper-20261029183807362` and `native-paper-20261029185051115`.
- Structured supervisor-log window: 18:49:00 through 18:52:00 UTC, exclusive end.

The frozen source archives final status as `runs/<runId>/result.json`, not
`runs/<runId>/status.json`. The current run need not have a result while running.
The exporter reads those two fixed result/settlement pairs and the fixed
source/supervisor diagnostic rings. Untimestamped source console lines are
explicitly not assigned to a run. Missing, bounded, rotated, malformed, or
unknown-hash evidence does not establish the absence of an incident.

## Execution and output

The existing original-service upgrade package must hash-index this tool as a
non-runtime artifact. The reviewed parent driver passes verified bytes to an
isolated Python child with UID 988, GID 982, empty supplementary groups, fixed
environment, and an eight-second timeout, before any stop or financial mutation.
No extra owner command, service, admin workflow, or publisher is required.

The script accepts no paths or arguments, uses no network, opens no ledger, and
controls no service. If invoked as root, it permanently drops UID/GID and groups
before private reads; the planned upgrade starts it unprivileged directly.
The script does not read `__file__`, so the parent's isolated bootstrap may set a
descriptive frozen-path value without exposing the root-frozen artifact path.

The only output file is the existing public-directory artifact:
`/var/lib/poe-public/source-recovery-forensics-20261029.json` (at most 512 KiB).
It excludes balances, quantities, position payloads, credentials, wallet/provider
strings, and arbitrary error text. Known error codes are drawn from exact static
literals in the frozen source. Unknown reasons are SHA256-only. Supervisor facts
are processed before untimestamped source noise, within three seconds of log
work. Files are read through canonical fixed paths with owner/type/mode/link and
size checks; publication is atomic.

Successful stdout is one JSON object:

```json
{"kind":"POE_SOURCE_RECOVERY_EXPORT_RECEIPT","readerUid":988,"readerGid":982,"financialDatabaseOpened":false,"financialWrites":0,"serviceChanges":0,"path":"/var/lib/poe-public/source-recovery-forensics-20261029.json","bytes":1,"sha256":"<64 lowercase hexadecimal characters>"}
```

The receipt's actual positive byte count and digest bind the retained artifact.
The parent must verify the receipt and artifact before interpreting any facts.
Failure or timeout remains explicitly unknown and does not waive any financial
upgrade gate. The full artifact must not be embedded in a smaller bounded upgrade
verification receipt; retain its exact path, byte count, hash, and a small safe
summary instead.

## Offline verification

`focused-tests.raw.txt` contains raw verbose output for 14 disposable-file tests.
`offline-verification.json` records exact commands, source/artifact identities,
exit codes, output digests, and the fact that no production/privileged execution
occurred. Python compilation and scoped whitespace validation also passed.

The tests cover source/account binding, safe unknown reasons, no injected private
payload leakage, strict file bounds and symlink/hardlink refusal, active-log
prefixes, timestamp filtering, partial/oversized lines, bounded log work,
supervisor priority under noisy console output, atomic publication, fixed CLI,
and permanent privilege dropping before private reads.

Independent review status is recorded separately when completed. The tool must
not be described as having captured EC2 evidence until its actual runtime
receipt and sanitized artifact are verified.
