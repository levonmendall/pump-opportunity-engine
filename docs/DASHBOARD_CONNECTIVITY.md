# Dashboard source connectivity

Owner-requested reporting repair, 2026-10-27. This changes the Render viewer only; it does not install a trading runtime or alter any financial account.

## Why the panels looked frozen

The installed `bce3d22bb434eb429aafacb788a18f39ec189c1b` EC2 observer publishes a schema-v1 snapshot. Its `UNIMPLEMENTED_FLOW_BLOCKED` source declares entries disabled. In that release, `snapshot()` publishes actual migration discovery/provider counts and event-loop lag, but hardcodes the downstream funnel and selected-token RPC counter to zero, leaves processing lag and budgets unavailable, and publishes empty trades/decisions arrays. These are not measured strategy rejections.

The isolated experimental pilot on the review branch uses a different ledger and local `status.json`/events. `docs/PILOT.md` explicitly states that these are not sent to Render. A viewer redeploy cannot make missing source events exist, and must not merge research results into the authoritative EC2 account.

## Reporting repair

- `GET /api/connections` reports configured-source presence, the last accepted account/release/strategy/sequence, source and receiver ages, known observer capabilities, and the dashboard release.
- The normal snapshot response includes the same connection diagnostics without changing the accepted snapshot or ledger values.
- Source role is inferred as discovery-only only for the explicit `UNIMPLEMENTED_FLOW_BLOCKED` sentinel; a different strategy is labeled runtime-reported, not automatically operational.
- Known inactive downstream stages display `NOT ACTIVE` rather than claiming zero completed evaluations. Empty decisions explicitly explain that the engine is not connected in the published runtime.
- The isolated pilot is explicitly marked not connected. This is not a claim about whether its local process is running.
- Source age advances in the browser, including across mobile sleep/resume. The viewer refreshes every 15 seconds, on focus/visibility return, and through a manual refresh button. Concurrent snapshot requests are suppressed.
- Millisecond metrics are rounded for readability; missing measurements remain unavailable rather than becoming zero.
- Publishing still requires the original machine Bearer secret and exact configured identity. Viewer changes do not enable entries or expose secrets.

## Remaining runtime boundary

Actual candidate evaluations, fills, and pilot RPC diagnostics require a running producer that publishes those facts. The current observer cannot produce them by configuration alone. Wiring the pilot must preserve its experimental identity in a separate, explicitly labeled read-only reporting namespace, or follow a separately reviewed account-preserving runtime deployment. Do not change Render's expected financial account to a disposable pilot, invent measurements, or enable trading merely to populate panels.

## Verification

Tests cover observer/runtime classification, waiting and stale snapshots, duplicate-delivery age, unchanged financial projections, read-only access, authenticated ingestion, and browser-script syntax. The deployment check independently reads public endpoints, verifies unauthorized publishing remains rejected, and compares successive source sequence numbers when available. A passing Render build alone is not proof of source progression.
