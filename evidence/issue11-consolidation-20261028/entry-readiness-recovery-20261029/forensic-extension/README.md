# Bounded original-account entry-control forensics

This extends the existing one-off read-only exporter. It preserves the original two investigation windows and adds 17:46–17:49 UTC for snapshots 9307 and 9310. It does not alter the running engine, dashboard, financial state, source configuration or trading permission.

The exporter reconstructs raw entry controls from committed pause, successful-resume, safe-stop and inception actions at or before each source timestamp. A failed resume does not clear a pause or stop. A pause does not erase the inherited stop flag. Missing or malformed actions, exhausted history bounds and actions tied with source-generation time remain unknown. Current controls are never backdated into a historical snapshot. The public snapshot sequence does not identify a journal revision; the report keeps that limitation explicit and compares the actual latest reconciliation with the retained public timestamp.

Only sanitized controls, timestamps, bounded static reasons, price-age and mark-age facts are exported. No balances, position quantities, wallet/provider strings, arbitrary payloads or credentials are published. Reconciliation availability is distinct from established raw entry controls. The query remains read-only, query-only, with trusted schema disabled, a 1.5-second read budget, bounded rows/bytes and the original same-inode account binding. Privileges are permanently dropped to UID 988/GID 982 before private reads. No writer lease, checkpoint, financial write, service control or network request occurs.

Offline verification: 24 exporter tests and 10 admin tests passed, with independent review. The malformed-control reconstruction and setter-consistency findings were corrected and preserved as regressions. Fixture results are not production facts.

The revised staging directory is `/var/tmp/poe-original-entry-control-forensics-20261029`; the earlier staged exporter remains untouched. The same existing one-off public artifact is used. `OWNER_READ_ONLY.txt` is reviewed command text only. Owner execution and actual protected results remain pending.
