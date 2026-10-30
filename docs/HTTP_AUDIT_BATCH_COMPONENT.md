# Targeted independent history-audit batching component

Implemented offline from `e910a845920a3e31ef1e2a3dc7ee62d51e8cd462`; no runtime wiring, provider request, deployment or financial operation occurred. This is a reusable research component, not verified public-RPC batch eligibility or production capacity.

`ComponentTransport.callSignatureHistoryBatch` sends one fixed-endpoint HTTP JSON-RPC array with one to six **separate** `getSignaturesForAddress` queries. It uses the existing `ComponentBudget` physical gate, pacing, timeout, body-byte accounting, cancellation settlement and two-MiB total response bound. It accepts only confirmed history requests with bounded keys/configuration, distinct generated request IDs and preserved pool/before/until/minContextSlot parameters. Other RPC methods are not exposed through this API. Responses may arrive in any order; missing, duplicate, unknown or mismatched IDs invalidate the batch rather than associating a response with the wrong pool.

`auditNativeFlowWindowsBatch` collects at most six distinct pool jobs for the same closed60second target. It calls the existing `auditNativeFlowWindow` for every pool, unchanged. The collector supplies only the independent first-page query; existing notification/context fences, confirmed rows, signature identities, row ordering, one-page truncation, per-pool payload limits, complete-window checks and actual availability remain authoritative. A successful HTTP result is not an audit pass, a swap proof, an executable qualification or a whole-market denominator.

The targeted collector supports the existing one-page policy. Preflight failures that require no query are returned immediately; they cannot leave a barrier waiting forever. A pre-dispatch cancelled/expired/unready job is explicitly unavailable and is not sent. Once requests are selected, loss of any selected admission while waiting conservatively refuses the unsent batch. After dispatch, an individual cancellation invalidates that job without cancelling siblings. The common earliest deadline and timeout still govern the one physical operation.

## Physical and logical accounting

The transport exposes plans, actual HTTP invocation starts, logical queries started, successful/error envelopes and queries lacking a validated response. Its recorder receives exact planned query definitions before admission, then response timing/ID metadata without provider error text. A live integration must preserve these records durably. Counters are scoped to this transport instance; they are not reconstructed lifetime/provider charges. A gate reservation or a failed plan is not mislabeled as an actual HTTP invocation.

One batch of six queries consumes one physical HTTP invocation and **six logical provider queries**. It does not establish six-for-one billing, quota consumption, rate entitlement or server execution cost. Wire/header overhead remains unmeasured, as in the existing transport; decoded received body bytes and uncertainty are accounted separately.

The workload motivating this component is a projection:36individual history queries +6support +6heartbeat +30held-price checks =78physical starts/minute before batching. Grouping six due history queries into one HTTP request would give6batch starts +6support +6heartbeat +30held checks =48physical starts/minute. Logical provider work remains78queries/minute. This arithmetic is not a measured jointly scheduled workload or proof of12available starts of safe protection headroom.

## Failures and information time

Ordinary per-item RPC errors invalidate their own audit while successful siblings still face every original semantic check. HTTP429 stops at headers, retains the uncertain response reservation and performs no retry. Per-item429 or-32005 preserves response metadata but halts future physical admission after the current operation settles; the collector conservatively blocks all current audit admissions on provider backoff. Future `PilotRpc` integration must route these conditions through its existing Retry-After/cooldown policy before reopening any chapter. This component does not clear refusals, rotate endpoints or retry.

Receipt time, full envelope validation time and per-pool completed audit availability remain separate from the target window and chain timestamps. A delayed response, expired audit or cached old receipt cannot be backdated into an earlier decision. HTTP batching does not make different query results an atomic Solana-bank snapshot, nor does it change confirmed commitment into processed-time information.

Caller-facing cancellation or timeout can precede physical settlement if the underlying fetch ignores abort. The existing gate keeps its physical slot occupied and preserves uncertainty until settlement. The collector returns unknown settlement on rejected/no-valid-receipt calls and cannot authorize a replacement request. Its physical/logical counts are likewise unknown when a thrown adapter call supplies no trustworthy receipt; the owning gate/transport records remain necessary for reconciliation.

Combining six queries creates one nonpreemptible request. A slow query, server-side serialization or a response above two MiB may make all six unavailable. The limit is not silently raised and no selected query is sampled away. Protection scheduling must account for measured batch latency before using this path alongside positions.

## Offline verification and next proof

The injected HTTP fixture verifies six unchanged strict audits using one physical invocation and six logical starts, reversed response ordering, exact current timestamps and retained historical refusal. Wrong-pool history makes the affected audit unusable. Separate fixtures cover ordinary partial errors, per-item and HTTP throttling, malformed response identities, absent history, saturated pages, response overflow, pre/post-dispatch cancellation, late physical settlement, expired information, context fences, and immutable request parameters. These are synthetic correctness fixtures, not live provider evidence or trading results.

```bash
npm run build
node --import tsx --test test/component-history-batch.test.ts \
  test/component-transport.test.ts test/native-flow-audit-batch.test.ts \
  test/native-flow-audit.test.ts
```

Validation completed with `npm run build`, `npm run compile`, all 71 affected transport/audit tests, and the full repository suite: 1,064 passed, zero failures. No network or financial database was used.

The smallest remaining live proof is one bounded public-RPC component comparison after the current trial: request a current, explicitly supported cohort's anchored history with exact existing per-pool parameters, compare a single batch against bounded individual reads where necessary, and measure actual acceptance, total response bytes, per-item results, receipt/validation latency, throttle behavior and logical-versus-physical consumption. Preserve changing-bank uncertainty; identical addresses or one successful socket do not prove parity. No main scheduling or position-protection replacement should be claimed from that component alone.

## Served-node floor integrity correction

Every original native-flow audit history page now includes `minContextSlot` equal to its original strict upper slot, whether that fence comes from a captured notification or validated coherent Clock/account state. History cursors can move backward without lowering this served-node floor. This is not a per-response bank-context field, an atomic snapshot or proof that each history row is a trade. A quiet address can legitimately have old newest history; old row slots alone neither prove nor disprove that its serving node is current.

Prior results are preserved unchanged. Their history requests did not specify this floor, so the served-node context remains **unproven**; this correction does not invent a historical node-lag failure or retrospectively convert those results into current-bank proofs. The added offline fixtures require the floor for notification/Clock pagination and preserve six batched logical identities. A context-not-reached response (`-32016`) makes that pool's audit unavailable and cannot authorize an independent predictive decision. The consolidated direct `PilotRpc` path now recognizes exactly `COMPONENT_RPC_ERROR_-32016` as transient unavailable data, preserves the drained response/counters and any historical uncertainty, and applies its existing paced2/5/10-second recovery schedule. It performs no automatic retry; unrelated RPC errors remain unchanged. A real injected HTTP-envelope regression verifies refusal through cooldown and a separately requested fresh read. The audit remains unavailable during node lag; no predictive result is invented.

The slot-floor correction passes build/compile, 89 focused transport/audit/runner fixtures, and the full repository suite: 1,068 passed, zero failures. These remain offline correctness results, not evidence of a live node honoring the requested floor.
