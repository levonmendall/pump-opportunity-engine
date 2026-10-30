# Independent review of durable never-invoked pacing repair

PASS for source `f96e1ccede6c27e8d4b70ffa14a113c1cef2bf63`. This review authorizes integration of the reviewed source, not an EC2 service or financial action.

The prior implementation conflated allocated reservations with physical starts. Its checkpoint builder conservatively moved every reservation without a persisted physical stamp to the seal time. Repeated local admission refusals could therefore accumulate into an artificial short provider window and obstruct holding reads despite no corresponding HTTP traffic. The actual-class offline reproduction demonstrates this mechanism; it does not establish the precise cause of every historical live failure.

The correction records a static, operation-specific never-invoked attestation only before the transport callback is invoked. It persists that attestation before excluding its timestamp from physical pacing. Actual invocation, incomplete physical settlement, absent or malformed proof, conflicting IDs, partial byte reservation and ambiguous crash state retain conservative handling. No allocated operation ID, cumulative call, observed byte, uncertain byte or pending reservation is refunded.

The canonical baseline and checkpoint format remain compatible with deployed source69. A separate verified timestamp multiset carries exclusions between raw chapters; duplicate timestamps remove only the witnessed multiplicity. Sealed checkpoints retain raw source hashes and all accounting totals. Existing unknown69 records are not retrospectively classified as nonphysical: a migration seal gives them one conservative upper bound, subsequent seals preserve that bound, and the starts age out normally.

Independent checks:

- 53 focused tests passed, including the real ComponentBudget/PilotRpc producer, aborted and expired pre-invocation paths, a matching error thrown after actual invocation, failed attestation persistence, malformed witnesses, raw restart, sealed restart and 31-book legacy migration.
- An additional probe loaded the actual deployed69 component and baseline modules. They accepted the new raw book and checkpoint with identical canonical accounting. Old69 reopened a copy conservatively. A physical start sharing the exact timestamp of a proved reservation remained counted.
- The sustained offline producer completed 60 physical holding reads alongside 60 proved local refusals over 120 simulated seconds. Its maximum completed holding gap was 2,250ms, with no holding refusal or HTTP timeout. No provider requests were made.
- All 449 tracked source, script, test, operator and package files remained byte-identical across these checks. Exact application hashes and log hashes are in `verification.json`.

No review blocker found. Parent integration checks and live forward observation remain necessary. A genuine provider outage or slow physical request can still breach protection timing; this repair does not hide or relabel those failures. Legacy unknown starts may still impose a conservative one-time migration window, as the regression explicitly demonstrates. No financial ledger, account, funded-execution rule, position limit or four-slot setting is changed here.
