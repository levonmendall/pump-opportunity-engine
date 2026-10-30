# Reviewed original-service provider recovery upgrade

Offline package for source `5675961a0ad05df508eec6928644c9e403be0811`, replacing verified installed `93bf0b5d6a3f1258a74ac696798fb4e0ec6147a2`. This package is not installed by assembly or staging.

The package retains the original authoritative PAPER account and ledger, one financial writer, Adaptive Momentum v2, two simultaneous holdings, four deep-observation slots, the existing supervisor/resource policy/systemd sandbox, financial risk parameters, and authenticated reporting channel. It changes provider scheduling, bounded holding-price recovery and technical entry-readiness behavior. It does not reset daily loss or clear an owner stop, financial stop, account history, pending order, position or provider counterbook.

Before its first service stop, the reviewed root driver retains a bounded diagnostic export as the original runtime identity and an exact root-copy hash. Missing or rotated diagnostic data remain unknown and do not grant entry permission. Backup and complete historical action/journal prefix verification occur before and after physical single-writer settlement. New-source post-start identity, configuration, original account, ledger inode and exact retained historical prefix must verify before installation is reported complete.

Exact pre-start rollback is limited to a fresh financial lease plus observed physical settlement. After any possible new-source start, this driver retains the new financial manager and all later state. Both releases use provider accounting v2; the post-start barrier protects unresolved execution and restart uncertainty rather than asserting a schema mismatch. No backup or provider counterbook is restored. A future separately verified executable downgrade would require its own review against then-current state.

`OWNER_APPLY.txt` contains one hash-verified command for the protected installation boundary. It is ready for owner use only after independent review and successful actual nonroot EC2 staging. Rerunning that exact command resumes the durable transition; it does not initialize another ledger or repeat the historical daily-loss reset. The root helper does not contact Render. After actual host verification, Codex must bind the same Render receiver to this source and prove new authoritative acceptance.

`package-pins.json` and `transport-pins.json` contain exact hashes. `validation.json`, `frozen-configuration-import.json`, and `verification/` retain local assembly/configuration/108-test proof. Passing these checks is not forward operational acceptance.
