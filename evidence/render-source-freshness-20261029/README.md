# Render source-freshness repair

Base: `cb4f53d3afc6253ff7f9b9cc79515a04c058a86c` on the existing Render dashboard. This change classifies reporting only. It does not restart or modify the financial runtime, alter account identity, enable entries, modify quotes or trading-validity rules, or replace source financial values.

The existing modern headline combined native capture, USD valuation, and a two-second financial reconciliation requirement. As a result, an otherwise fresh running capture source could appear `UNAVAILABLE` solely because `status.reconciled` was false. The browser also used financial valuation/reconciliation timestamps to label the entire source stale.

The API and browser now share one pure classifier. Whole-source freshness uses original source-generation and accepted-receiver timestamps with the existing 90-second boundary. Actual runtime stops, browser read failures, and selected-capture disconnects remain explicit. Financial valuation, reconciliation, evidence pressure, discovery/watch loss, and source-time position-protection status have separate bounded reason codes. Unknown source restriction text is not copied into these derived fields. Raw snapshot values, entry permission, account identity, financial reconciliation, quote validity, and ingestion authentication remain unchanged. Legacy snapshots without operating intelligence keep their existing semantics.

## Retained forward sample

The sanitized fixture projects 57 actual public reporting responses from source `cdba9d483fdcef105e74e3053a8d4bbf28bdff0c`. Source-generation timestamps span `2026-10-29T16:51:15.759Z` through `2026-10-29T17:06:00.099Z`; original generation, receipt, observation timestamps, response hashes, source/account identity, and classification inputs are preserved.

- 39 responses previously classified unavailable had capture connected and only non-current financial reconciliation. They now retain an operational observing headline with a reconciliation warning and unchanged paused entry permission.
- Two real selected-capture disconnects remain unavailable, with explicit notice that broad discovery continues.
- The other 16 responses keep their current-source classification.

This sample does not reconstruct the earlier 15:16–15:24 interval. It does not establish uninterrupted capture, financial acceptance, profitability, or deployment success.

## Verification artifacts

`source-manifest.json` binds every changed production/test file and the sanitized fixture to exact SHA-256 values. `focused-tests.raw.txt` retains the focused cache/authentication/legacy/browser/replay regressions. `npm-test.raw.txt` and `build.raw.txt` retain final full-suite and TypeScript build output. `npm-test.attempt-01.raw.txt` preserves the initial full-suite failure: a presentation test parsed the raw TypeScript template before evaluating its static classifier interpolation. The test now resolves exactly the real interpolation; served-browser serialization was independently checked. `tracked-source.patch` records the tracked-file changes; new test and fixture files are separately hash-bound by the manifest.

The independent review from `/root/expose_operating_gates` passed the final production changes, restriction mapping, actual browser serialization, real capture-loss handling, legacy behavior, and raw financial-field preservation. No deployment was performed by this worker.
