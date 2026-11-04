# Pending-backup recovery and graceful shutdown repair

H9 native source79e07c604e520e9be3a55e273b4289093646b76e, bundle
e959907f78471da8bb5c90b516ee90500054378cd9fb59718f4751fedddeb242,
run native-paper-20261104084359513/PID2937500, could not establish a runtime
backup. Source-bound administrator run41807481135/artifact13310926177
(sample SHA2563e79adb2eaf614bcf855fc22f4fabe0fd0a311c220a41cac655dee4cd41f4c00)
aggregates1315 pending-recovery/OTHER_BACKUP_FAILURE receipts and no success
in scanned prefixes. The selected512 failure hashes match the installed
`backup retention layout needs review; nothing removed` literal
(fb16d5e5a475ebe39e46148d9301622c67bf1b9b8c6f9f4ba10055902c28833f).
The omitted hashes are not inferred from the aggregate.

The separately authorized metadata capture, run41809029393/artifact13310598807,
found exactly two completed generations1774/1775, a232452096-byte pending
backup and one1024-byte unknown entry. Its basename hash
(a4c534a637d65d489dec990087cad325e64f9de1bc5bd8f8d6622f47f7bc0503)
matches `poe-financial-pending.sqlite-journal`. More than two generations and
insufficient disk space are ruled out by that capture. Production journal
contents and the precise stop signal that left it were not inspected. Tests
therefore cover both a genuinely hot SIGKILL journal and a genuine committed
SQLite PERSIST1024-byte journal with a zeroed header.

The old scanner rejected that journal before SQLite recovery; merely accepting
its name would then reach an unsuitable read-only pre-validation. The combined
release reuses the subsequently approved main recovery implementation from
de71a4c514da11c65a066a6aef330466aacd15e4, merged through39df83a6 and4c70cad8,
including its24 journal regressions and exact reporting handover. It retains
the original operation lease, fingerprints the complete pending family and
preserves it by rename inside one fixed private `.poe-pending-recovery` capsule.
Original bytes, inodes and modification clocks remain intact. The approved
paired sidecar handling remains; unknown or unsafe input refuses. Only a
separately copied database/journal pair is opened
writable by SQLite. The recovered copy must pass the full existing same-account,
inception, history, metadata, revision and snapshot-sequence validators before
normal nonregressing promotion. Financial-source paths and original source
inodes are excluded from the recovery namespace and writable targets.

A durable manifest binds the original inodes/hashes before relocation, and a
validated receipt binds the exact target inode/hash before promotion. Recovery
resumes interrupted preservation and promotion without another generation or
loss of the archived pair. Failed inputs remain preserved. The fixed allowed
capsule layout bounds storage to one incident and one candidate; a second
incident refuses for review. Actual remaining-copy plus financial disk reserve
is checked during copying. No failed evidence is deleted to make room. Existing
single-link file checks and two-generation retention remain intact.

An interrupted fresh destination can roll back to a genuinely empty SQLite
file, and cancellation after real preparation can leave a zero-byte file with
no journal. These narrow cases preserve the original input as an explicit
incomplete-staging disposition. They require an already fully verified
same-account backup and a durable agreed original source-inode witness. Source
disagreement is preserved as a refusal across new stores/workers; it cannot be
refreshed by restarting. The source fence remains through the later ordinary
copy and is resolved only by its actual verified persistent source snapshot.
A nonempty malformed database never takes this path. No empty file is promoted
or returned as a financial backup. The producer never uses ATTACH; any SQLite
super-journal EOF trailer is refused before writable SQLite recovery, and abort
preserves the entire pending family whenever any journal path exists, including
unsafe or unreadable paths.

Recovering an old pending artifact does not set financial readiness or refresh
its original financial timestamps. The existing runtime chain still requires
a new verified current-source backup afterward. The exact existing backup
technical pause already permits automatic operating recovery only when fresh
finance, source, provenance and admission checks pass. Owner/hard controls
remain closed. The approved typed BACKUP_RETENTION_LAYOUT_REQUIRED cause and four
native-only backup state fields expose the existing owned state without new
reporting I/O or any permission grant.

The actual supervisor has a30-second TERM-to-KILL interval. Previously intake
could wait30seconds before its first saved tail, then the engine could begin
another multiphase final backup. Shutdown now checkpoints the accepted intake
prefix immediately without closing it, cancels owned backup work and stops feed
producers. The intake remains open for their genuine asynchronous terminal
states. A real unsettled transport is recorded as unsettled and keeps its
contexts alive until actual closure or the existing external kill fallback.
After real feed settlement intake closes and checkpoints again before draining.
ACKs and queued prefixes retain their actual accounting and original clocks.

Persistent shutdown starts no new optional final backup. Finite experiment
behavior remains. Cancellation waits for actual native worker exit and retains
its parent operation lease until the owned continuation settles. It does not
classify an already started copy as an unstarted deferral or append a late
financial pause. Optional intake-save failure is recorded without a durability
claim; mandatory financial checkpoint, reporting and cleanup still run before
that failure is surfaced. Genuine financial failures retain their own outcome.

H9 also performed35 proof pins after same-window BACKUP_UNAVAILABLE refusals in
a bounded retained sample:110611456 bytes and16527ms cumulative pin elapsed,
with no economic decisions. New proof retention now checks the existing
financial-capacity gate before qualification lookup/queueing. Already owned pins
and immutable completed proofs keep their original lifecycle and expiry. A real
backup can complete independently and allow the same still-valid certificate to
prepare afterward. Source discovery and audit capture continue.

The same batch carries independently reviewed precise monitoring-reason
reporting, diagnostic migration-age policy attribution, same-query bounded
selection-competition telemetry and early/nonclosing intake persistence. These
change reporting and machinery; no trading strategy, financial age restriction,
provider budget, execution freshness, four-slot limit or portfolio control is
relaxed. The approved PAPER transaction cost remains explicitly modeled:
5000 base plus2000 priority lamports, with pool fees in actual-size SDK quotes
and original confirmed rent observations. It is not a dynamically measured
network-fee estimate.

Validation includes actual SIGKILL hot journals, three interrupted recovery
boundaries, immutable raw/source/WAL checks, full-validation refusals, mixed and
unknown inputs, disk and archive bounds, finite/persistent shutdown, real
asynchronous intake states, queued fsync/ACK races, physical worker/lease
settlement, backup-pause recovery and optional-save financial-cleanup behavior.
Earlier regression failures were corrected and retained in local validation
logs, including a new shutdown-local variable colliding with a publication
fixture's closure locator. Immutable full/package validation, native activation
and sustained operating acceptance remain separate release requirements.

The earlier A2 source passed341/341 local affected tests and289/289 fixture
follow-up tests. Its first hosted full run passed4116/4118; two stale test
fixtures were corrected without changing runtime source. Discovery of the
newer approved main required the additional recovery reconciliation described
above. Its complete immutable regression and package results must be bound to
the new combined source; prior source results do not certify it. The native
configuration remains`f030f068a845d28f0717bf3edabe8bba0483f55cc3cc2f95a6feedb634c10d28`.
The hosted immutable full/package gate and live acceptance are pending.

## Reconciliation with approved main

The combined branch retains main's entire24-case
`test/backup-journal-recovery.test.ts` unchanged. Its fixed capsule replaces
the undeployed A2 sibling-archive helper; the latter is removed. Main's exact
de71 reporting handover, backup documentation and dedicated recovery gate are
retained. The workflow branch list includes both repair branches, with every
existing full regression, publication benchmark and isolated package smoke gate.

The earlier assertions remain covered as follows; none relies on the retired
optional `rollbackRecovery` return field.

| Earlier boundary | Current actual regression |
| --- | --- |
| Hot journal needs writable isolated recovery; source/raw bytes, inodes and clocks unchanged | Both main's `real crash-left hot journal recovers only its candidate and preserves originals and source` and the additional hot/readonly-copy cases |
| Crash after promotion or an original-member handoff | Main's durable relocation/promotion interruption cases plus three actual SIGKILL cases after promotion, database relocation and journal relocation |
| Original source excluded from recovery targets | Recovery-namespace refusal and a real original source inode moved to pending after source-path replacement; bytes and live state remain unchanged |
| Foreign account or incomplete history cannot certify | Main's foreign/corrupt cases plus two repeated real hot-journal foreign/history failures with both good generations retained |
| Unknown or completed-copy sidecar cannot be erased | Main's `unrelated names and completed-copy journals remain refusal boundaries` and the additional unknown/completed-sidecar cases |
| Interrupted derived WAL/SHM cleanup is limited to candidate | Main's same-family candidate replacement plus the additional normalization-interruption regression |
| Insufficient copy reserve preserves originals and permits a genuinely later retry | Additional unavailable-reserve regression with original hashes and current source unchanged |
| Archive/temp metadata cannot grow without bound | Main's second-incident refusal and fixed temporary-publication cases plus repeated fixed-capsule capacity/layout refusal tests |
| A1024-byte committed PERSIST journal is not assumed hot | Main's cold PERSIST case and the additional actual1024-byte zero-header fixture |

The former A2 blanket mixed-WAL refusal is not imposed on approved main's
paired-family preservation and full-validation contract. This is an explicit
reconciliation of two implementations, not an assertion that missing WAL
frames were observed or reconstructed. The strict unknown/completed-sidecar
refusals, immutable original family and full financial certification remain.
The fixed one-incident capsule is stricter than A2's two-incident archive.

The nine additional EMPTY/source-replacement regressions and all worker
lease/cancellation checks are retained. An independent source-bound run passed
53/53 main recovery, EMPTY, native worker and abort/footer tests before the final
legacy-path original-inode guard; the final combined source requires its own
recorded validation and immutable hosted package gate.

The final main-based combined local run passed535/535 tests across18 affected
TypeScript suites and124/124 application/reporting MJS tests, with zero failures,
skips or cancellations. Full typecheck and compilation passed. These results
include the new original-inode guard and all three real process-kill recovery
boundaries. Hosted full regression, exact package validation, native activation
and sustained live operation remain pending for this combined source.
