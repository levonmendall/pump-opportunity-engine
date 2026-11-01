# Bounded local financial backups

`FinancialBackupStore` in `src/backup.ts` creates and verifies local SQLite
backups for the existing financial account. The native PAPER runtime requests a
backup after startup admission, then five minutes after the last successful
backup. A failed or deferred attempt becomes eligible for retry after one second;
the runtime must still admit that retry, and only one backup task runs at a time.
Shutdown waits for outstanding backup work and requests a final checkpoint copy
before closing the ledger. These are code paths, not evidence that a particular
release has been activated or that a deployed restore has been verified.

The original `PaperLedger` remains the only financial writer and retains its
financial ownership lock. A backup does not initialize an account, change
capital, perform a trading action, enable entries, or add a network service.
Source and backup paths must be private, canonical, and owned by the runtime
user. The backup directory is `0700`; its regular files are `0600`, with one
hard link. Never run the live-source reader under a different account: SQLite
may access or create WAL/SHM sidecars even for a read-only connection.

## Runtime copy and offline copy

For `persistent: true`, the backup worker opens a separate **read-only** SQLite
connection to the original source. It does not construct a `PaperLedger`, acquire
another financial-writer role, initialize a schema, change source journaling or
durability, or checkpoint the source. The existing source writer remains in WAL
mode with its existing durability settings. The reader uses `fileMustExist`,
`query_only`, and an explicit deferred read transaction; it never uses an
`immutable` or no-lock connection to a changing database.

The parent anchors the source device/inode before asynchronous preparation and
retains that identity for the operation. It also reads the account identity and
minimum acceptable revision from its existing ledger. This is a check on the
private original source path, not an assertion that the backup API can inspect
the ledger connection's internal file descriptor. A replaced source pathname is
refused; ordinary source size, modification time, and revision may advance.

After the worker inspects prior backups and exclusively creates the staging
file, the parent rechecks runtime admission. The worker then starts a source
read transaction. The first bounded state read fixes its WAL snapshot. State,
journal head, reporting sequence, page count, and the SQLite backup operation all
use that same transaction. Financial writes can continue on the original
connection without changing the captured snapshot.

`copyReadonlyFinancialSnapshot` in `src/backup-source-snapshot.ts` copies through
SQLite's backup API in 100-page steps. Its receipt records the exact captured
revision, last action time, reporting sequence, state hash, source device/inode,
and phase/resource measurements. Successful persistent creation includes those
measurements in its optional `sourceSnapshot` receipt; `latest()` cannot
reconstruct the timing of an earlier copy and leaves that field absent. The
source transaction is rolled back and its connection is closed immediately
after copying settles, before artifact normalization, integrity/history scans,
fsync, or promotion. The completed
artifact must match that captured receipt and satisfy the minimum revision and
retention history checks. A later revision in the still-running writer is
expected; a backup is a consistent historical point, not a current operating
readiness certificate.

For a nonpersistent store, the existing `create(ledger)` path retains
`ledger.backup(path)` on the original financial connection. The SQLite promise
yields between steps, but each native step can synchronously use that caller's
thread. Artifact verification still runs in the worker. This legacy path does
not provide the persistent runtime's isolated source copy or its snapshot
resource guards. Its copy promise must settle before that ledger is closed.

## Snapshot lifetime and resource limits

A source read transaction can delay WAL checkpoint progress. The persistent
snapshot helper therefore applies all of these limits:

- A maximum snapshot operation lifetime of 20 seconds, measured with a monotonic
  clock. Callers may tighten this limit.
- A maximum physical WAL-file growth of 64 MiB from the operation's initial
  observation, further limited to one quarter of the configured disk reserve.
  Preallocated WAL space can be reused without increasing file size, so this is
  not a count of cumulative logical writes. The lifetime limit also applies.
- Available space for the remaining copy plus the configured reserve on the
  backup filesystem, and the reserve on the source filesystem. Both filesystems
  are checked even when source and backup directories are on separate mounts.
  The native persistent runtime supplies a 256 MiB financial-write reserve.
- Unchanged source and staging device/inode identities, distinct from each
  other, plus private-file metadata, source sidecar metadata, fixed snapshot
  page count, and cancellation state throughout copying. The staging file must
  initially be the operation's empty owned file.

Checks run before copying, at each progress callback, and after the final native
step. The final step does not invoke the dependency's progress callback, so the
post-copy check is required. These are **cooperative** limits: a native SQLite
call, filesystem operation, or connection close can exceed a budget before
JavaScript resumes. They are not a hard disk quota or a promise that blocked
storage can be interrupted instantly. The helper releases its read transaction
on success and ordinary error; forced worker cancellation must settle before
another operation can take ownership.

Persistent stores use disk headroom instead of a fixed ledger-size ceiling.
Nonpersistent stores default to a 64 MiB artifact limit, configurable up to
1 GiB; the bounded native run supplies 16 MiB. Those stores check source main
database plus active WAL before copying and artifact size afterward. Their
legacy source API has no mid-copy cancellation callback, so that size bound is
also a preflight/post-copy guard.

## Operation ownership and failure

A separate standard Linux `flock` serializes backup creation and recovery. Its
small `0600` lock inode remains in place. For asynchronous operations, the parent
holds the validated lock file descriptor; the worker acquires the lock through a
fixed nonblocking `flock` child. The shared open-file description retains
ownership after that child exits. The worker does not own or close the parent's
descriptor.

Worker tasks are serialized and replies are correlated with their request.
Each request has a 30-second timeout. Cancellation fences subsequent copy and
promotion phases. On timeout or failure, the parent waits for confirmed worker
exit before closing its operation descriptor or allowing a retry to acquire
ownership. A timeout does not prove that a native operation stopped at the
instant the timer fired. Provider and wallet environment credentials are not
passed into this worker.

Runtime admission is checked after acquiring the operation lease and again
after artifact preparation, before starting the source snapshot. An unstarted
admission deferral preserves the previous verified-backup readiness state and
allows a later retry. A real copy or validation failure closes new-risk
admission while retaining financial history and existing exposure. Neither
outcome changes reconciliation, quote, pending-order, or held-position
protection deadlines. Moving copy work off the financial JavaScript thread
does not remove shared CPU/storage contention; writer latency and deadline
health still need measurement.

## Artifact validation, retention, and recovery

Only the completed staging copy is checkpointed and changed to DELETE
journaling. This produces a standalone artifact whose read-only inspection does
not accumulate WAL/SHM files; the source remains in WAL mode. Validation checks
SQLite integrity, schema, account/mode/inception, journal/state revision, the
same pure financial-state validator used by writer recovery, and bounded
reporting history/sequence. Operating-cost metadata uses the same pure cost
validator as recovery, including account/inception/chronology and refusal to
recreate missing metadata when action or journal IDs prove cost history.

The store fsyncs the validated new copy before deleting at most one old verified
same-account copy and atomically promoting the new artifact. Retention is two
completed files and one in-progress artifact, plus bounded SQLite sidecars
during crash recovery. Promotion must not regress the newest retained financial
revision or reporting sequence. Source identity and the captured snapshot are
checked before accepting the new persistent copy.

`latest()` selects the newest valid matching-account copy and reports
rejections. A corrupt newest copy falls back to the last good copy. It never
deletes unknown, foreign-account, or corrupt paths. Such files block automatic
retention until reviewed. Selection does not require the original source
database to survive or remain readable/in-size; backup identity and integrity
are checked independently.

Use asynchronous `maintainPending()` and `create(ledger)` in the runtime.
Synchronous `latest()` and `recoverPending()` are offline operator tools; their
integrity and history scans must not run in the decision loop. After a crash,
pending staging is not silently overwritten. Recovery validates its identity
and integrity and completes promotion only when safe. An invalid pending file
remains for review while the last good completed backup remains selectable.
Ordinary abort cleanup may remove only the current operation's known,
unvalidated staging inode and owned sidecars. An uncertain or validated artifact
is preserved; it is not a guessed cleanup target. Concurrent recovery while a
backup is active is refused by the same operation lock.

## Verification and restore

The large-backup regression retains its original adaptive timer-gap bound and
the assertion that no artifact integrity scan runs on the financial owner's
JavaScript thread. Snapshot tests cover the original writer advancing during a
fixed read snapshot, an artifact matching the captured revision, and reader
release before validation. Failure tests cover resource limits, operation lease
retention, and cancellation after real validation but before promotion. A
separate worker test forcibly terminates an actually pinned snapshot without
running JavaScript cleanup, then verifies that the original writer can advance
and that all committed WAL frames can be checkpointed and truncated. These
tests use the same SQLite addon as the runtime.

Report full elapsed and phase timings; successful artifact isolation alone is
not proof that live financial deadlines were met. Local fixture measurements
do not establish deployed storage capacity. The packaged disposable smoke also
requires a persistent copy with a captured snapshot receipt; compilation and
whole-project typechecking remain separate release checks.

Restore to a **new private target** with the existing account restore command.
Never overwrite a running source or reset capital. Full `PaperLedger` recovery
checks run again during restore; backup validation alone does not enable
entries or certify market readiness. Account/inception, financial state, and
reporting history must agree. Restored entries remain paused pending fresh
runtime reconciliation and candidate readiness. Tests use disposable local
state only.

The runtime exposes backup status and failure while preserving observation and
financial ownership through shutdown. Release installation, current operating
readiness, backup freshness alert delivery, and an actual deployed restore drill
need their own evidence. This module and its tests do not claim those outcomes.
