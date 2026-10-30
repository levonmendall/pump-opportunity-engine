# Holding RPC stage reporting through the original dashboard

Source commit: `cd354281ea36123fa3df5db118d05db6752df091`. This source-only followthrough is not installed and did not change the operating EC2 service.

The deployed 567 source records financially owned acquisition stages in `usage.rpc.protectionRecovery`, but its original operating projection discards them. Historical exports consequently retained unavailable holding evaluations while lacking the RPC phase facts needed for exact attribution. This correction projects only existing, allowlisted source facts; it does not reconstruct missing historical causes.

The existing bounded `quality.limitations` channel now carries at most three additional notes:

- Calls, logical attempts, actual rolling holding starts, bounded recovery probes, RPC retry successes and dispatch refusals.
- Positive counts for the eight fixed acquisition stages: provider restriction, quota/spacing, physical settlement, physical timeout, caller cancellation before/during a physical request, transport/node response and local admission.
- A valid last-failure stage, original timestamp and observed physical-in-flight boolean.

These are explicitly scoped to the current RPC instance, which may be replaced inside a persistent service run. They are not completed holding evaluations, durable lifetime counters or a diagnosis of every interruption. Missing counts stay unavailable; arbitrary errors, URLs, credentials, local paths, policy objects and unknown stages are ignored. The public schema remains unchanged. The original Render receiver at `bb1e91eb7c9f00d00aa459c6984cdbddfc0a27a1` accepted an actual new projection in the offline compatibility check, and its existing dashboard renders these notes as text. No frontend merge or UI replacement is needed.

The projector also used ordinary RPC cooldown to classify fresh holding protection as degraded. Since 567 financially owned recovery can operate through optional-work backoff, new sources now use their authoritative `providerRestrictionUntil` for this diagnostic classification. Actual provider restrictions, malformed new restriction metadata, missing completed evaluations and overdue protection remain degraded/unavailable. Legacy sources retain their old cooldown interpretation. Entry blockers, ledger controls, strategy decisions and all financial gates are unchanged.

Validation: 133 focused operating/reporting/financial-readiness/publisher/dashboard tests and the TypeScript build passed with exact source hashes unchanged before/after. Four added regressions cover stage retention/privacy, optional versus authoritative cooldown, malformed/future metadata, and maximum counters. Independent review passed 44 tests and a worst-case payload with three holdings, six existing refusal categories and all eight maximum stage counts: ten notes, maximum 410 of 512 characters, total intelligence 5,198 bytes below the existing 32 KiB bound.

No provider requests, original financial account reads, service controls, credentials, new account, new reporting channel or new writer were involved. Existing financial and qualification evidence requirements remain unchanged.
