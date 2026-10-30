# POE lifetime Portfolio Equity trajectory: single original account

## Status and architecture

The original Portfolio Equity panel still has ONE line. The previous Render
receiver stored at most 24 hours of values in memory and restarted with an
empty chart. A Render free-plan instance has no durable volume or database.
Persisting history solely in its process cannot meet the owner's requirement.

The new companion reads **only** the source-owned `snapshot.json` that the
existing publisher already validates. It verifies account, inception, source
identity, timestamps, reconciliation, the exact reported equity USD value, and
source-file ownership. It retains observations in a separate, non-financial
SQLite database on EC2, and POSTs a bounded 720-point representation over the
EXISTING machine Bearer credential to `/api/equity-history`. The normal
`/api/snapshot` payload, fingerprint, publisher acknowledgements, ledger,
risk limits, PAPER execution, and all existing services are unchanged.

No new Render database, worker, hosting plan or third-party API is required.
On Render restart, the companion republishes the entire bounded lifetime
representation. Its persistent original source is EC2, **not** Render RAM.

The verified inception event records the original $1,000 cash contribution
at `2026-10-26T22:07:36.212Z`. It is labeled as inception, not a measured
market valuation. Later points are included only when the actual source
reported USD equity with valid market and reconciliation evidence. Missing
intervals are represented by unequal segment IDs; the chart never draws a
line across them. The complete accepted observation series is kept in the EC2
sidecar while 720-point source-owned display history is compacted by preserving
inception, current value and segment boundaries/extrema as far as possible.

## Boundaries

The existing source snapshots do **not** contain verified historical USD
equity values for each earlier point in their `pnl` field. That field is
trading/economic P&L, not equity, and MUST NOT be used to reconstruct
missing USD equity. Prior source snapshots may be recovered only when their
actual original bytes and original account identity can be authenticated.
An archival backfill must not invent values or use a synthetic historical
SOL/USD rate.

The separate recorder only receives new observations after installation.
Until the original EC2 companion is installed, the receiver retains its
existing temporary rolling-window fallback. **Merging or deploying the
dashboard does not by itself activate lifetime recording.**

## Deployment sequence

1. Verify the original protected `poe-runtime.service` and source snapshot
   pathname, owner UID/GID, and exact credential path. The supplied unit is an
   *installation template*, not a claim those paths are confirmed.
2. Compile the pinned repository on a non-financial checkout using Node
   24.19.0 and install under `/opt/poe-lifetime-equity/current`; provide the
   same better-sqlite3 native module used in the reviewed build. This must NOT
   replace `/opt/poe/current` or modify the original finance SQLite file.
3. Owner/root creates `/var/lib/poe/lifetime-equity` mode0700 owned by
   `poe-runtime`. Set a separate filesystem reserve/backup for this file.
   Before activation verify the companion's read-only input, credential
   source and that the original runtime remains running.
4. Install the reviewed `scripts/poe-lifetime-equity.service` as a separate
   systemd unit; enable and start only this companion, not the financial
   service. Watch for authenticated POST200 to the EXISTING Render service.
5. Verify `GET /api/snapshot` returns
   `equityHistory.retention = "ec2-durable-republished"`, with original
   account inception, exact live equity and truthful gaps. Restart the
   companion and independently redeploy Render, and verify the same
   historical time range appears without resetting the original account.
6. Audit any private archived source snapshots separately for historical
   backfill. Only actual signed/verified original source values may be
   imported. Report unrecoverable gaps explicitly.

If the credential or source-file path is unverified or missing, refuse
activation rather than alter the finance service, read secrets into logs, or
relax authentication. No funded execution is enabled by this change.
