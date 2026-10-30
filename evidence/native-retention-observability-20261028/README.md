# Persistent notification-retention diagnostics

Metrics-only incremental delta after84cae65. Existing compaction, retention,
refusal, scheduling and data-validity rules are unchanged.

Five bounded scalar run totals are exposed as flow.notificationRetentionAggregate:
compactedScopeRows, nonempty compactionOperations, peakRetainedRowsPerScope,
peakRetainedRowsAcrossScopes, and candidatePressureRefusals. Peaks include the
single existing refusal reserve. Units are scoped metadata rows: a transaction
bound to two scopes counts twice. They are not unique trades, verified windows,
market coverage or a proof of useful capacity. No per-mint map or per-packet log
is added. Peak calculation scans only the existing bounded live/retiring scopes.

The existing4097-notice replay verifies genuine compaction totals, then retires
the affected candidate while another remains connected and usable; totals remain.
The existing16-row pressure test verifies one refusal,17-row per-scope/18-row total
peaks, and persistence across both re-ACK clearing and retirement without harming
the other scope. No additional network or financial state is involved.

All70 focused tests and npm run build passed. Raw outputs and hashed source/test
receipts are retained. Root will verify the final composed source before forward
measurement; these observations are offline mechanics only.
