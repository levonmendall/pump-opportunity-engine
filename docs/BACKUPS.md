# Bounded local financial backups

FinancialBackupStore in src/backup.ts is a callable module. Development runtime
now schedules it after useful work at startup and six-hour monotonic intervals,
with one operation in flight and bounded retry. It is not deployed on EC2.
The sole ledger writer passes its existing PaperLedger
and actual source path/account identity. Use a separate owner-held 0700 directory;
files are 0600. No source-file copy, second trading writer, account initialization,
network service or paid backup is involved.

create(ledger) uses SQLite's backup API into one exclusively created staging file.
The existing sole financial connection performs that copy. A single short-lived
standard Node worker handles artifact-only inspection, normalization and
promotion; it never opens a source SQLite connection or receives ledger state.
Its input is paths, the account identity and minimum revision. Provider/wallet
environment credentials are not inherited. The parent retains the operation
lease until the copy and worker have finished, including failed shutdown.
After completion, it checkpoints and changes **only that backup copy** to DELETE
journaling. This makes the result standalone: its read-only inspection does not
create accumulating WAL/SHM files. The source remains in WAL mode. Validation
checks SQLite integrity, schema, account/mode/inception, journal/state revision,
the same pure financial-state validator used by writer recovery, and bounded
reporting history/sequence. Operating-cost metadata uses the same pure cost
validator as recovery, including account/inception/chronology and refusal to
recreate missing metadata when action or journal IDs prove cost history.
It fsyncs the validated new copy before deleting at
most one old verified same-account copy and
atomically promoting it. Retention is two completed files and one in-progress
artifact (plus its bounded SQLite sidecars during crash recovery). A standard
Linux flock serializes backup/recovery operations; its tiny 0600 inode remains.

latest() selects the newest valid matching account copy and reports
rejections. A corrupt newest copy falls back to the last good copy. It never
deletes unknown, foreign-account or corrupt paths. Such files block automatic
retention until reviewed, rather than becoming guessed cleanup targets. The
selector does not require the original source database to survive or remain
readable/in-size; backup identity and integrity are checked independently, while
new backup creation still requires a valid private bounded source. The
default artifact limit is 64 MiB, explicitly configurable up to 1 GiB. Source main
database plus its active WAL are checked before copying, and the artifact is
checked again after copying; crossing the bound fails the backup and preserves
prior good copies/source history. The current ledger API has no mid-copy cancel
callback, so this is a preflight/post-copy guard, not a guaranteed hard disk quota
while the source grows concurrently. Runtime disk/freshness policy is still needed.

Use async maintainPending() then create(ledger) in the runtime. These keep heavy
SQLite integrity/history scans off the live event loop. Synchronous latest() and
recoverPending() remain offline operator tools and must not run in the decision
loop. Each worker request has a 30-second timeout; failure terminates the worker
and preserves uncertain staging for later recovery. The source copy still uses
the ledger's existing SQLite API without a mid-copy cancellation hook; its
promise must settle before the financial connection closes. Source TypeScript
workers register tsx explicitly inside their thread. Compiled workers use normal
Node JavaScript and need no TypeScript preload or development dependency.
In a local disposable 100,000-action/78.9 MB fixture, offline two-copy validation
took 268 ms and async maintenance/copy had a 29 ms maximum timer gap; the prior
runtime path measured 589 ms. These are local measurements, not deployed capacity
or a guarantee against source-copy/disk contention. Regression also verifies that
no artifact integrity scan runs on the financial owner's JavaScript thread.

After a crash, pending staging is not silently overwritten. recoverPending()
validates its identity/integrity and completes promotion only when safe; an
invalid pending file remains for review while latest() can still select a good
completed backup. Concurrent recovery while a backup is active is refused by
the same standard operation lock.

Restore to a NEW private target with the existing account restore command. Never
overwrite a running source or reset capital. Full PaperLedger recovery checks
run again during restore; backup validation alone does not enable entries or
certify market readiness. Account/inception, financial state and
reporting history must agree; restored entries are paused pending fresh runtime
reconciliation and candidate readiness. Tests use disposable local state only.

The runtime exposes backup status and failure while preserving observation and
financial ownership through shutdown. Backup freshness alert delivery, actual
EC2 restore drills and deployed supervisor proving remain separate work.
No production retention/restore acceptance is
claimed by this module or its tests.
