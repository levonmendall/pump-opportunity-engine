# Independent fixed-account PAPER result-readback review

Scope: source review and generated disposable fixtures only. No EC2, provider,
real account, credential, wallet or production access was performed.

The initial12 generated fixture tests passed. The helper correctly uses the
existing fixed-path chunk protocol, acquires the financial owner's lease before
read-only immutable SQLite access, refuses sidecars and exports bounded numeric
projections/hashes rather than a database, state body, metadata or journal dump.
Held marks and USD P&L remain explicitly unverified by the ledger-only check.
Each transmitted chunk has its own hash; whole-archive hashing is a separate
recipient requirement. Archive completion does not claim trading readiness.

Initial review found two reproducible source-provenance defects:

1. A package.json with a different executable source was accepted because its
   bytes/source were not checked against supervisor.packageSha256/source.
2. An otherwise well-formed accepted-source witness from an unrelated prior run
   was accepted because its run ID was not constrained to the supervisor's actual
   one or two measured segments.

Both counterexamples used generated fixture files only. They were reported for
correction, with requested regressions. Also requested: record the actual ledger
check time and verify the financial-owner pathname still identifies the locked
inode before/after inspection. Missing publisher witness evidence should remain
an explicit unavailable result rather than prevent other forensic evidence from
being retrieved.

Status: final GO pending those narrow corrections and regression review.

## Final review

**GO for the fixed-account, settled-process projection/readback scope.**

The package bytes/source are now bound to the supervisor's recorded package
hash/source. Every witness run must belong to that supervisor's measured
segments, and exact witness bytes are still checked against its source hash and
publisher ACK. Both reproduced counterexamples now have explicit refusal tests.
The owner-lock pathname is rechecked against the locked descriptor before and
after inspection. The audit records its actual local check time and compares
permission/pause/reconciliation fields in addition to balances and ownership.
A missing publisher witness is explicitly unavailable and no longer erases other
forensic results. Finite JSON numbers, an enforced compressed-output bound and
disk headroom checks were also inspected.

The reviewer reran the final17 generated-fixture tests: all PASS. No real
financial state, host, provider, credential or deployment was accessed. The
fixture tests establish local mechanics and refusal behavior only; actual host
readback, dashboard cycle agreement and natural PAPER lifecycle remain forward
verification requirements. Retained held-position values are not independently
repriced by this utility and it makes no current USD/P&L freshness claim.
