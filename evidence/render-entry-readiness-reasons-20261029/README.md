# Entry-readiness reason compatibility

This is a reporting companion to the separate backend reconciliation and recovery repair. It does not repair scheduling, change entry permission, or establish successful operating recovery.

The existing modern-source classifier recognizes fourteen exact `POE_ENTRY_*` blocker codes. The existing dashboard displays a static explanation for each code, including the unchanged two-second reconciliation requirement. Unknown or extended codes remain `OTHER_SOURCE_RESTRICTION`; arbitrary private blocker text is not copied into derived warnings.

The same self-contained classifier still runs in the API and browser. Financial snapshot fields, authentication, account identity, source/publisher freshness, stopped and disconnected states, legacy handling, and the owner's existing candidate bars are unchanged. No new schema, reporting channel, account, service or financial write is introduced.

The focused tests execute actual HTML served by the dashboard. They verify all fourteen explanations, unchanged entry permission, precise reason propagation, and sanitization of unknown code suffixes. Existing recorded replay, genuine capture-loss, stale/stopped and financial warning tests remain intact.

Base source: `9bdf59aa9ca4fe2af92dfeecd65cfa6ab8346fe1`.

Implementation and verification are offline only. No Render push/deploy, EC2 operation, private financial read, provider request or financial-service restart was performed by this task. Root must review the final backend reason enum before deployment.

Raw focused/build/full-suite output and exact source hashes are retained alongside this file. Initial counts and independent review are recorded in `verification.json`.

The latest wording clarification is verified in `wording-clarification/verification.json`. Ordinary shared RPC occupation is described as reserved monitoring/capacity, rather than provider failure or failed position protection. Only the static explanation and its browser expectation changed; the classifier and all financial behavior remain unchanged.
