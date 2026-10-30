These are exact public `/api/snapshot` responses saved before the October 30 reporting deployment. They retain genuine accepted equity observations that would otherwise disappear when the Render memory cache restarts or is replaced by an older EC2 replay.

- `current-live-status.json`: source timestamp 2026-10-30T15:02:45.250Z; 485 receiver points; SHA-256 `b66d6cc4f264461a44160684af8e6f02bb3ba4c83ee545e79c19898a687c91a5`.
- `owner-transition-current.json`: source timestamp 2026-10-30T15:28:12.712Z; 455 displayed durable/source points; SHA-256 `2ec517cf5a5dddc683d197e48a7b66e1ce2e7c8352ec69c8c5afe1244ec10aa2`.

Their timestamp/value union contains 487 distinct observations. Missing intervals remain unknown. Render imports only historical equity points after checking exact file hashes, original account/inception, snapshot fingerprint, timestamps and values. It creates no current financial snapshot, ledger state, heartbeat or ingestion acknowledgement. Later EC2 replay keeps its own capital-epoch markers; supplemental receiver points remain explicitly labeled as preserved receiver data.
