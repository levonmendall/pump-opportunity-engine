# Selected capture stability repair

Base: installed `31efee2c44725722e7948165126e6296111f165c`.

## Findings

The original receipt clock uses the first chunk of an entire undrained WebSocket receiver batch. With `allowSynchronousEvents=false`, an active stream can keep that batch nonempty indefinitely. A deterministic test against the pinned real ws Receiver reproduces fresh frames falsely appearing over five seconds old. This explains a reproducible source of receipt/processing deadline refusals; it does not prove every historical refusal was false. Actual local stalls still fail the unchanged limits.

Every service-evidence record previously read the financial ledger once or twice solely to classify durability, including ordinary native-flow records whose classification does not depend on ownership. The lazy classifier preserves every original classification while skipping those unnecessary reads; ownership-dependent records still consult one current authoritative state snapshot.

Gap retirement attempted indexed-registry transactions inside socket callbacks. The repaired callback immediately invalidates candidate certificates and retains gap intent but leaves registry retirement to the regular coordinator step. Immediate financial bridge gap handling, unusable native windows, generation fencing, one-shot contention retries and physical unsubscribe settlement are preserved.

Empty selected connections were deliberately closed immediately, producing TRANSPORT_CLOSED records and connection churn while replacement candidates were prepared. Persistent operation now retains the same empty connection for at most 15 seconds while servicing managed heartbeat/pong obligations. A replacement requires fresh support and a real ACK; no old window is reused. Actual disconnects retain normal recovery/backoff. Nonpersistent retirement remains immediate.

## No stale-data or safety relaxation

Five-second receipt freshness, per-handler processing limits, market/audit/quote freshness, correction detection, provider accounting, normal financial readiness, PAPER-only execution, verified actual token age <=24h, four deep slots and existing exit policy are unchanged. No event is silently discarded to make a window pass. The receipt observer retains bounded header/timestamp metadata only and fails closed on malformed/unknown provenance. Reporting distinguishes a connected empty transport from usable selected capture.

Refusal records additionally separate handler-start receipt age from handler elapsed time; connection diagnostics identify expected closure and receipt-queue measurements. These are local application receipt times, not kernel/network timestamps.

## Validation and activation

Transport, classification, idle-handover, deferred-gap and reporting regressions are added. Full production-toolchain results and exact bundle identity must accompany deployment. No code edit or passing unit test alone proves live stability or PAPER fills. Preserve the existing exact owner-approved EC2 installation boundary and original financial/market history. Render must accept the verified installed source after any successful source switch, not before.
