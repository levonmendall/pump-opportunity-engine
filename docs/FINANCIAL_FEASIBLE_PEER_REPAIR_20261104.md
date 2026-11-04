# Current-certificate financial selection repair

The source-bound H8 export from administrator run 41796021148 contains four
retained original certificate expiries and two completed execution-economics
rejections. The 512-row priority export is bounded, with per-kind omissions;
it is not a complete operating interval. Original provenance and handoff/proof
receipts are in `evidence/financial-feasible-peer-20261104/original-cohort-trace.json`.

At 07:58:44.537 UTC, M3EZ's remaining preparation and decision sequence could not
fit its original 07:58:49.999 deadline. The launcher still selected that mint on
each turn and labeled WE52 as awaiting the selected candidate. WE52's proof
completed at 07:58:45.165. Both certificates expired. The export does not retain WE52's
original preparation state, so it cannot establish that a usable live decision
or trade was lost. A separate exact-launcher reproduction supplies an explicitly
synthetic warm peer and proves the local selection defect using the real
remaining-work, admission, rolling-provider-reserve and proof-cache components.

Selection now samples each current candidate's original certificate, cached
qualification/proof state, remaining preparation, request capacity, provider
dispatch and holding-preservation runway. A pure planner selects a ready decision
before preparatory work and keeps the existing economic order within each group.
When every candidate awaits a recoverable prerequisite, ordinary bounded recovery
still receives a turn. A sequence that cannot fit the original deadline does
not reserve that turn ahead of a feasible peer. The source retains that original
certificate and proof for normal expiry; it can compete again if stable
preparation actually progresses before expiry. No deadline, market timestamp,
quote, risk control, provider budget or proof identity is renewed by selection.

A transition-coalesced `native-paper-financial-selection` record and native
`financialReadiness.candidateSelection` retain the original sampling clock,
per-candidate reason, required/remaining milliseconds and provider headroom.
These are scheduling diagnostics, not financial permission or claimed quotes.
All existing source/current-certificate, PAPER account, preservation, preparation,
actual-size quote and final entry gates run again on the selected candidate.
Preliminary rejections without a buying proof retain their existing callback
path and do not acquire a new preparation or pin requirement.

The durable intake integration also separates candidate-persistence availability
from financial reconciliation/protection recovery. Unavailable intake still
closes source admission and new entries. It does not invalidate otherwise healthy
financial maintenance merely because discovery recovery is unavailable.

Focused tests execute the actual launcher and source/final-entry gate closures,
the real proof cache/handoff and financial deadline/reserve functions. They cover
a warm peer behind an unfit cold certificate, candidate-specific headroom despite
a prior cold plan, all-unready recovery, exact expiry, stable preparation recovery,
preliminary no-proof rejection, holding reserves/protection runway and unavailable
intake. A real candidate-runner peer-audit turn preserves the earlier certificate
when only transient financial priority is released. Full regression, immutable
package validation, activation and live acceptance remain separate requirements.

Local combined validation passed typecheck, compilation and 359 affected
financial, protection, intake, registry and dashboard regressions in three
disjoint focused runs (147, 211 and one actual-runner certificate-preservation
regression). The original unchanged
account CLI suite passed all 16 tests in isolation. Initial exact-source VM
fixture failures (new captured selector/intake variables) and a newly added spool
test's indexed-access type error were corrected without changing runtime policy.
Two earlier broad local runs were intentionally interrupted when the composite
scope expanded; neither is recorded as a completed full-regression pass. The
unchanged hosted full/package workflow now admits the exact H10 repair branch.
The native configuration hash remains
`f030f068a845d28f0717bf3edabe8bba0483f55cc3cc2f95a6feedb634c10d28`.
