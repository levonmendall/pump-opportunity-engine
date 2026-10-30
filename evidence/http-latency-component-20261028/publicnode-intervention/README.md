# One history-only keyless alternative — availability component v3

Prepared offline. **No new provider request, operating failover, audit-timeout change or financial action has been performed by this change.** This is one narrow availability comparison justified by measured pool-specific failures, not a provider search.

The prior100-row component40776522997 retained two J6 timeouts over3s and two HKvy completions over2s; the page20 intervention40777452497 then timed out on **all four** affected history calls, while the quiet control remained fast. `page20-rejected-summary.json` preserves the latter result's original hash. **Page20 is rejected as a repair**; operating initial pages remain100. Existing results, actual usage and uncertainty are unchanged. Neither smaller payloads, fresh minContextSlot floors nor socket reuse alone explains the observed failures.

The parent retrieved bounded current official PublicNode pages/terms into `../publicnode-feasibility/`. They advertise keyless free Solana public RPC and permit blockchain-RPC use. No numeric free quota, reliability guarantee or SLA has been established. This component uses no account, key, billing connection, archive token, Geyser route, purchase or plan change.

The proposed smallest operating direction, **only if later validated**, is history-only acquisition from a second fixed source while keeping supported SDK/Clock pricing on the original provider. Accordingly the actual v3 test sends:

- Three confirmed `getMultipleAccounts([Clock])` calls to **https://api.mainnet.solana.com**.
- Six confirmed100-row `getSignaturesForAddress` calls to **https://solana-rpc.publicnode.com**, using each pool's historical primary-provider floor and then its newly validated **primary-provider** Clock floor, with alternating pair order.

Both endpoints are hardcoded by method and validated in the hash-pinned plan (`clockEndpoint`, `historyEndpoint`). There is no arbitrary URL input, endpoint rotation, fallback, retry or rate-limit evasion. The earlier measurements had no429/503. The undici hook matches the actual per-request origin plus request object, so mixed-source diagnostics cannot accidentally attribute a Clock connection to history. Socket reuse remains an object-identity observation; `sendHeaders` is explicitly a **pre-write hook, not proof of wire transmission or remote receipt**.

All previous limits and safeguards remain:9 calls maximum,45s aggregate with shutdown reserve, three-second **diagnostic** acquisitions,750ms actual-invocation spacing, one physical operation, unchanged response/evidence/CPU/RSS bounds, actual abort settlement, same stopped c189/flat-account gate, inherited leases, parent-death kill, source/cooldown fencing and no financial/credential writes. The wrapper bytes are unchanged. A refusal/unsupported method/stale floor is recorded as unavailable; floors and Clock validation are not weakened. Retain every new consumed request/byte and incomplete-call2MiB uncertainty separately and honor any provider cooldown before subsequent operations.

This tests whether the alternative can answer the actual primary-to-history minContextSlot shape within the unchanged decision envelope. A successful response establishes neither complete historical paging, price/account coherence across providers, full trade evidence, sustained throughput nor production failover readiness. No token quote or trade qualification is computed. The old and fresh Clock observations keep their actual timestamps; a different provider's history is never represented as a coherent multi-account quote.

Verification:14 focused Node tests pass (including the existing5 host/Python cases), build passes, and tests assert the exact three-primary/six-alternative routes,100-row parameters, fixed-URL privacy/refusal and mixed-source diagnostic scoping. Independent delta review is recorded in `verification.json`. Parent stages the unchanged wrapper plus updated probe/plan/workflow pins in the existing private administration channel and dispatches once. If this one alternative is unavailable, report that precise limitation; no automatic vendor search or second effort follows.

Public API/data fee eligibility and existing compute/transfer/storage costs remain separate. A short keyless component cannot prove continuous zero-cost provider capacity.
