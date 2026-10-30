# One authoritative POE snapshot

Target account `poe-3123e352-4581-455b-85db-acd7e825e99e`, inception `2026-10-26T22:07:36.212Z`; original virtual funding and ledger history are preserved. This reporting code neither opens nor initializes a financial ledger. The existing Render service `srv-daqon53tqb8s73bdceq0`, Free plan and URL remain unchanged.

The same account publishes one complete authenticated `/api/snapshot`. Financial fields retain the version1 contract. Optional `intelligence.version=poe-operating-intelligence-v1` adds bounded source-origin candidate, predictive, quality, provider, resource, protection and pending-action facts. Unavailable fields are null; predictive assessments remain distinct from financial evaluations and fills. Source and accounting times remain separate from publisher acknowledgement and receiver time. Duplicate reports do not freshen source or receiver timestamps.

The independent nonroot publisher uses the original service credential through `LoadCredential`, not the retired experimental secret:

```sh
node /opt/poe/releases/REVIEWED_RELEASE/snapshot-publisher.mjs \
  --watch --file /var/lib/poe/native-engine/snapshot.json \
  --account-id poe-3123e352-4581-455b-85db-acd7e825e99e \
  --inception-at 2026-10-26T22:07:36.212Z \
  --release REVIEWED_40_CHARACTER_SOURCE_COMMIT \
  --strategy SOURCE_STRATEGY_VERSION
```

`CREDENTIALS_DIRECTORY/poe-ingest-secret` must identify the original ingestion credential. The file reader accepts an atomic private snapshot owned by its service user; it reads no ledger, provider or wallet file. The HTTP request is bounded to5s and retries back off from15s to60s. It reoffers the latest verified snapshot every15s, including after a receiver restart. It has no cumulative request, CPU or elapsed-duration stop. SIGTERM settles its current request; it does not alter financial state. A real bounded JSON `accepted` or `duplicate` response produces a source-bound acknowledgement with account/inception/release/sequence, canonical receiver fingerprint, exact raw source-file SHA256 (including whitespace), original source time and actual acknowledgement time. These two hashes serve different purposes and must not be interchanged. Replace `--watch` with `--once` for the service's final stopped snapshot: exactly one physical POST, a5s timeout, no retry and a nonzero exit if no valid acknowledgement arrives.

The dashboard displays one Portfolio overview, open positions, pending orders, completed PAPER trades, source-projected P&L, candidate decisions and system diagnostics. Financial figures are never computed from candidate counters. The old `/api/pilot` responds410 with no data, and its separate publisher/UI/modules are removed by this prepared cutover. Environment variables and secret files are retired only after the original-account host cutover and full source-to-Render validation succeeds. This code change does not itself perform that cutover or delete financial files.

Before deployment, reconcile both real accounts and confirm the experimental account is flat/settled, establish exclusive original-account writer ownership, back up the original account, and freeze the exact runtime/source/schema. Deploy this existing Render service only when the same-account publisher is ready. Verify two actual source-to-public cycles, wrong-account/unauthorized POST rejection, duplicate/reordered delivery, reporting outage/recovery, truthful stopped/stale behavior and mobile rendering. Offline UI fixtures are not forward trading or operational acceptance.
