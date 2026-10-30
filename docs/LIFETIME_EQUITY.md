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
   pathname, owner UID/GID, and exact credential path. The authoritative source
   pathname is `/var/lib/poe/native-engine/snapshot.json`; the separate service
   status directory is not the source snapshot. The supplied unit is an
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

## Preserved pre-deployment original receiver evidence — 2026-10-30

A read-only GitHub Actions run (admin repository action 41012043804)
captured **59 actual accepted equity observations**, from
`2026-10-30T04:49:57.058Z` through `2026-10-30T05:47:16.815Z`, to
`/home/mm-ec2-runner/.local/share/poe-lifetime-equity/accepted-original-equity-20261030T060531507844Z.json`.
Exact private-file SHA-256:
`c977ff8a130d555394178179aba4d67c43083e9e4c7b496bada61a2ecfa34cb1`.
The action read NO finance database and made NO original-service changes.
This is a bounded copy of original receiver-accepted USD equity, NOT a
reconstruction of all history since October 26. Earlier coverage remains
unverified.

For source-side import, an authorized owner must copy **those exact
unchanged bytes** from the UID994 private runner home into the isolated
UID988 equity sidecar directory, maintaining file mode 0600 and owner
`poe-runtime`. Do NOT alter the original PAPER ledger. In the optional
root-owned `/etc/poe/lifetime-equity.env`, specify:

```ini
POE_EQUITY_BOOTSTRAP_FILE=/var/lib/poe/lifetime-equity/accepted-original-equity-20261030T060531507844Z.json
POE_EQUITY_BOOTSTRAP_SHA256=c977ff8a130d555394178179aba4d67c43083e9e4c7b496bada61a2ecfa34cb1
```

The companion verifies the file path, ownership, mode, SHA-256, original
account identity, chronology and actual accepted equity values; it imports
idempotently without modifying source financial history. It retains a
separate witness in `equity_imported_capture`. Conflicting values fail
rather than overwriting prior evidence.

Existing sidecar databases must have one hardlink, private ownership/mode, the
exact sidecar tables and the original-account identity. These are checked before
any writable SQLite open or journal-mode change. A renamed or hardlinked
financial database is rejected without modifying it. The trusted systemd
credential mode0440 exception applies only to this companion's exact credential
path and root UID/GID metadata; arbitrary group-readable credential files remain
rejected. The installed unit must derive the credential source from the original
reporting unit rather than assume the template path exists.
