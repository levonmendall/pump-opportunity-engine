# Settled native PAPER result readback

Prepared for lead review and fixed-hash staging only. No real account, host,
secret, provider or network was accessed while developing these helpers.

This extends the existing fixed-path candidate readback protocol. It is not
another administration interface or financial writer. Only the existing UID994
account and `/home/mm-ec2-runner/.local/share/poe-native-paper` are reachable from
production CLI; there is no path, account, provider or credential override.
The original candidate descriptor/chunk helper must retain its reviewedSHA256.

Run this AFTER the bounded PAPER administration job has settled. The exclusive
self-hosted runner cannot execute this readback concurrently with the runtime
job. Use the public Render channel for live visibility, then read back local
source evidence for exact comparisons.

Preparation verifies the fixed account/inception/executable, actual settled
source groups with absent PIDs, stopped exact source hashes and a settled
publisher. The supervision package hash/source and each segment's subordinate
receipt must match the final supervisor. A PID reuse is conservatively refused.
The imported experimental account cannot be substituted for the authoritative
portfolio.

The financial checksum audit acquires the existing owner lock exclusively and
nonblocking using a read-only descriptor. Its named inode must remain identical.
Any active writer or WAL/SHM/journal sidecar blocks this audit. SQLite is opened
read-only/immutable through an already-verified file descriptor; no WAL or SHM is
created. It checks quick-check, exact table names, revision/count continuity,
action/journal links, account/inception/initial contribution, cash reservations,
ownership and stored costs. Only explicit fields, table counts, source
comparisons and file/body checksums are exported. Raw database/body/journal/
action/metadata bytes and private files are never archived.

For a flat account it independently computes SOL equity and P&L from cash,
locked deposits and original SOL inception conversion. It does not fabricate USD
results or a fresh held-token liquidation mark. For open holdings independent
current liquidation/equity remains unavailable; the exact source projection and
its original timestamps remain available separately. Ledger controls are
compared with source controls without treating them as fresh executable entry
permission. The checksum audit has its own actual `ledgerAuditedAt` timestamp.

The archive allowlist contains:

- supervisor/package and per-segment stopped source/settlement receipts;
- exact final local source bytes;
- exact first-two/latest-two accepted source payloads and ACK/hash witnesses;
- bounded projected financial/decision/protection events with original source
  file, line and line hash;
- source event-kind counts and full original event-file hashes;
- the explicit read-only ledger audit and an all-exported-file hash index.

It excludes complete market-flow archives, account bytes, raw private ledgers,
keys, provider/wallet credentials and arbitrary files. The private original event
records remain retained on the host. Event projections are not a substitute for
complete strategy evidence. A missing reporting witness is explicitly marked
unavailable rather than inventing one or discarding financial forensics.

Bounds: selected bytes and compressed archive each32MiB, per-call chunk4MiB,
source files128MiB/32files with8MiB line/file limits, projected events4MiB per
segment, existing fixed source snapshots4MiB each. The compressed writer rejects
extra bytes before crossing32MiB. No existing archive is overwritten. Minimum
free disk128MiB; workflowCPU60s/address space256MiB/wall90s plus3s kill reserve,
file40MiB/nofile64/nice19. A partial failed export has no complete valid manifest
and remains preserved for diagnosis.

The lead pins the final helper hash in the workflow template before dispatch.
Sequence:

```bash
# Existing administration repository; one completed PAPER source job only.
gh workflow run poe-native-paper-results-readback.yml \
  -f phase=prepare -f source_run_id=ACTUAL_COMPLETED_RUN_ID \
  -f source_attempt=1 -f offset=0 -f length=4194304
# After prepare succeeds, obtain successive4MiB chunks using phase=readback.
# Reassemble header/data/footer framing exactly as existing candidate readback.
# Verify every chunk hash, stable archive/manifest identity, complete archive
# SHA256, tar allowlist, and every index-file hash before using any result.
```

An archive hash proves byte integrity, not natural PAPER execution, provider
reliability, correct strategy, complete market recall or24-hour acceptance.
Match at least two exact accepted local snapshots with retained public Render
cycles; a receiver heartbeat must never replace the original source timestamp.

Offline reproduction uses generated disposable fixtures only:

```bash
python3 -B operator/native-paper-ec2/test-readback-results.py
```

The same event projection also includes explicit observation/scheduling metadata:
watch verification/promotion/retirement; candidate-local gaps and shared native
transport/control incidents; audit target eligibility, dispatch state/summary,
page/result metadata and independent predictive assessment; physical start/
settlement/timeout; HTTP headers, first/body completion/decode timings; and local
admission, isolated-query and global-provider cooldown classifications. Original
source sequence/monotonic time, source file/line/hash and receipt time stay
separate. Connection reuse remains `not-instrumented` when the source says so.
No response bodies, request parameters, raw notification logs, account bytes or
arbitrary nested objects are included. Feature scalar/price-ratio evidence is
kept for predictive diagnostics. Audit signature arrays retain counts; missing
successful/unconfirmed/status-disagreement lists have explicitly labelled first
16 diagnostic samples and truncation flags. These are not complete flow or
independent market denominators. Complete original events remain private.
The existing4MiB projected-event ceiling still fails before export on pressure;
it never silently discards selected diagnostic records or changes qualification.
