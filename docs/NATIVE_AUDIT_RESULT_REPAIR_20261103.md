# Preserve completed audit outcomes across contention and generation changes

This repair follows the completed-result transaction change in `81d2f65` and the cross-scope tail binding repair. It changes candidate audit lifecycle handling and optional failure diagnostics. It does not authorize trading, relax missing-success checks, extend an audit deadline, or add provider requests.

## Reproduced lifecycle failures

Five coordinator replay cases failed before this change:

- A helper returned a complete missing-history failure, but the logical session finished after its deadline. The diagnostic identified an actual gap in the unchanged observation generation; the session deadline error prevented retirement.
- An unusable result belonging to an older candidate object, ACK time, connection, or subscription deleted a current certificate before the generation check rejected that result.

Completed unusable diagnostics now invalidate only the exact current candidate and observation generation. An unchanged-generation failure still retires that capture after a logical deadline; an old generation cannot revoke a current certificate. Late verified results remain ineligible for a financial decision. The existing pre-callback SQLite contention handling retains the completed session and its original availability time without fetching history again.

## Financial callback boundary

The market-registry writer lease is released before `onAuditAvailable` runs. The callback rechecks the candidate object, mint/pool, ACK, connection and subscription. For a verified weak window, the callback runs before ordinary candidate retirement, preserving the prior cash-only internal-checkpoint recovery behavior. Retirement follows in a `finally` path. The ordinary certificate, internal-stop provenance, financial admission and qualification checks remain in use; no substitute permission is passed to `NativePaper`.

A real second SQLite connection acquires an immediate writer lease inside the callback in both continuing and weak-window cases. Existing integration cases verify recovery of an inherited internal checkpoint, refusal of owner or unknown stops, no qualification/market request from the weak-window recovery, and normal certificate removal on retirement.

## Reusable history

Reuse still requires a fresh provider page to reach an exact finalized overlap with a verified contiguous suffix. A repeated missing successful signature remains a failure; an unusable window cannot publish a replacement cache. A new ACK clears the prior generation's cache before another audit can reuse it. No old failure is converted into verified evidence by retaining history.

## Completed response versus another physical request

A coordinated replay exposed a separate false-generation failure: the final successful history request consumed the remaining discretionary request capacity. The post-response tail check used the physical-dispatch admission gate and therefore rejected unchanged, current source data as `NATIVE_AUDIT_SOURCE_GENERATION_CHANGED`.

The runner now accepts a separate source-information admission callback, wired to the existing source-information gate in `run-native-paper`. Only validation of a completed response and retention of its verified history use this callback. Physical dispatch still uses the existing source and operation admission gates. Source stops, fatal capture state, exact candidate/ACK/connection/subscription checks and audit deadlines remain enforced. Callers without the new callback retain their previous admission behavior.

Seven focused tests cover capacity exhaustion after a successful response, actual information closure, fatal source state, generation change, deadline expiry, legacy admission behavior and refusal to dispatch when physical admission was already closed. The capacity-only case failed before the change; all seven now pass. The TypeScript build and whitespace checks passed.

## Compact missing-history witnesses

The optional existing `native-failure-evidence.json` now retains up to eight missing-success audit samples, each with up to eight signature rows. Each sample includes original helper and producer times, target window, strict slot fences, snapshot/tail counts and the exact observation generation. The full projected missing-success set has a SHA-256 digest, total count and explicit omission count. Samples state that source-delivery causality is undetermined without a complete receipt trace.

Audit samples share the existing 24 transport/detail slots. The original maximum of 40 total records, 64 KiB of details, 4 KiB per detail record and 640 KiB file size remain unchanged. Duplicates and omissions are counted. Successful audit payloads and arbitrary URLs/error text are not copied. This is a bounded sample of already-produced evidence, not a packet archive, complete census, or trading authority.

Offline projection of the two previously exported host samples retained all their missing-history failures: one audit in export `41650375330` (3,331 bytes) and four audits in `41651677346` (8,760 bytes), including the repeated `jAz7HwaWv8MgbKjVsrhKbK6A9dFeNKA6mew7gpbsPrGg6NoFCu69zNMjitSE6HJryMojDekr5yFSi8yJ2H3CGne` signature. This replay verifies witness retention only. It does not establish why those source packets were absent or claim that their exact underlying cause is repaired.

## Validation

The relevant runner, logical-session, audit, tail, batching, financial integration and failure-evidence suite covers 342 cases. The initial combined run passed 341; one existing backup integration fixture refused its default-umask file mode. Re-running all 51 financial integration cases with the required private `umask 077` passed, including that case and the weak-window/internal-stop cases. The TypeScript build and whitespace checks passed. No remote runtime or financial store was modified.
