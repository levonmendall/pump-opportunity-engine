# Reviewed financial-maintenance recovery

## Why the running account remained closed

The original PAPER account remained closed after current-pool observation became healthy. The owner-run inspection through ledger revision `140833` reported 3,674 denied resume receipts, 37 pause intentions, no stop intentions, and 16 flagged pause rows. That last total included restored pauses as well as hard reasons; it was not a count of maintenance failures. It reported no payload-hash, envelope, or denied-revision mismatch. Its first flagged row was an ordinary maintenance pause at revision `122331`, with the reason `financial maintenance unavailable; preserve records and close entries`.

The inspection was a bounded diagnostic. It did not perform the native validator's complete historical grammar or anchor verification. The recovery implementation authenticates those original records on the host before any acknowledgement can be appended. It permits only the reviewed maintenance chain and separately proven temporary reporting restores within the flagged group. Other hard reasons or unproved restores refuse before that append.

The original exception is not known. Healthy current reconciliation and idle execution do not establish that the old operation was harmless. This release therefore adds an explicit owner acknowledgement of the bounded historical incident. It does not reclassify maintenance failures as ordinary temporary pauses.

## Correct interpretation of the reviewed count

The first recovery candidate incorrectly required 16 exact maintenance pauses. Its validator already allowed a restored reporting pause when an earlier authenticated ordinary reporting pause proved its origin, but excluded that allowed row from its fixed total. A valid mixture could therefore pass authentication and every individual control check, then fail the final count.

The owner's exact native diagnostic subsequently returned `OWNER_MAINTENANCE_REVIEWED_CONTROL_MISMATCH` at source `370d3599f28451cc6d21cfee298ced71ebe8218d`, bundle location `80032:265`, on a read-only inspection of revision `167294`. The combined final check did not expose the live maintenance/reporting split. An authenticated disposable history with 15 maintenance pauses and one proven reporting restore reproduces the same refusal; that mixture is a regression fixture, not a claim about the actual account's split.

The corrected plan preserves the observed total of 16 flagged control intentions and reports its actual components: `maintenancePauses`, `restoredReportingPauses`, and their `suspiciousControlIntents` total. These reviewed counts cover only revisions through `140833`. The first flagged intention must still be the ordinary maintenance origin at `122331`. A later authenticated temporary reporting restore does not alter the earlier reviewed total, and any later maintenance failure or other hard/owner intention still refuses.

The current control reason and change time must continue to match the final authenticated control intention. These checks remain separate from the reviewed count, with specific refusal codes so another mismatch can be explained without inferring its cause from a generic error.

## One closed control boundary

The fixed action `owner-acknowledgement:maintenance:122331:140833` is tied to the original account, inception, PAPER mode, existing V3 epoch, reviewed source `0d9c42d2a607e0c29220bc2370470926d1575334`, first failure, fixed reviewed cutoff, and exact reviewed counts. The executing new source is separately recorded and proven by the pinned installer.

Before the sole writer appends anything, it verifies the complete authenticated control history, current state and journal head, original epoch, exact flat account, no pending financial action, and the two existing locked rent deposits. It rejects every unrelated owner intention, stop, other hard reason, malformed receipt, unproved restored reason, or maintenance failure after the cutoff. Ordinary later closed checkpoints and authenticated denied requests remain part of the verified history. Denied request volume has no new total-row cap.

The transaction appends one owner acknowledgement and changes only the closed control reason/time plus the normal journal revision/time. Entries stay disabled and daily controls stay paused. Cash, realized result, execution costs, locked deposits, positions, pending actions, capital, risk state, metadata and historical rows are preserved. The receipt explicitly states `historicalCauseKnown:false`, `historicalFailureDeclaredHarmless:false` and `entryPermissionGranted:false`.

The receipt binds the exact prior-state digest, original control anchor, full control-prefix digest, reviewed-prefix digest, reviewed counts and deposit digest. A retry returns the original verified receipt and cannot waive a later incident. Read-only replay validates the historical prefix without rewriting or reopening it.

## Fresh runtime permission remains separate

Both recovery history readers accept the acknowledgement only after validating its receipt. They still evaluate every later control intention. The acknowledgement is never reported as a successful resume. A subsequent ordinary runtime grant must satisfy fresh original-account reconciliation, current pricing and source support, complete inventory, evidence availability, current admission and existing risk requirements.

After a strictly later actual successful resume becomes the authenticated authority boundary, ordinary runtime checks do not repeatedly rescan the older acknowledgement prefix. Explicit acknowledgement inspection/replay still performs full validation. No cache is used to hide ledger changes.

## Release and crash handling

The fixed native export is `acknowledgeReviewedMaintenancePause`. Its read-only `inspect` mode returns the captured plan. Its `apply` mode rechecks that same plan inside the original financial writer's transaction. It is restricted to the existing runtime UID/GID and original ledger path.

The pinned root installer supplies source identity, stopped-service/cgroup evidence, consistent backups and the original maintenance lock. It installs the acknowledgement-aware source under a durable forward-recovery intent before an acknowledgement can commit. It releases its stopped-process probe lease only while the native writer acquires the original lease, validates and appends, then reacquires the lease and verifies the result.

The installer retains both the original pre-acknowledgement history proof and a post-acknowledgement baseline. A lost child response requires read-only receipt inspection. A possible commit with unavailable readback is reported as unknown, never zero writes. A proven retry appends nothing. Once an acknowledgement may exist, recovery proceeds only with the verified compatible source; it never restores financial history or grants permission as a deployment shortcut.

The installed root gate is pinned to a particular source/package. The owner updater changes that exact approval only after the package is built, tested and staged; it does not itself append the acknowledgement or enable entries.

## More useful failure evidence

The first maintenance failure in each runtime now retains its operation phase, attempted revision when available, bounded exception fingerprint and a narrow SQLite error code. Raw exception text, provider URLs, credentials and stacks are omitted. The outcome remains explicitly unknown. Later shutdown callbacks preserve the first cause, and failure to record the diagnostic keeps both financial and evidence latches closed.

Existing operating-readiness refusal reasons are retained in the private status snapshot, with the time and evaluated state revision. Reading these diagnostics adds no control-history scan, provider request, quote or financial action. These fields explain a decision; they never authorize one.

## Validation scope

Disposable regression coverage exercises the exact reviewed chain, atomic append and rollback, deposit and balance preservation, unchanged history, replay, wrong account/source authorization or revision, missing/tampered records, mixed or later hard/owner controls, and large volumes of later denied requests. Existing unknown post-commit failure tests must continue to remain closed without the explicit owner acknowledgement. Native bundle smoke checks that the new export is present without calling it or opening the operating account.

This document describes the repair contract. A tested or installed package alone is not evidence that entries have resumed. Actual fresh runtime status and subsequent financial evaluation must be observed separately.
