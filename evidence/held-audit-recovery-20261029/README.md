# Held-audit recovery and coherent operation admission

This isolated repair starts from `8bd509f`, whose application is the installed `5648606` arming release. It does not change that operating checkout, access a provider or financial account, control a service, or claim forward verification. The installed general-arming recovery has already succeeded; its financial policy is deliberately unchanged here.

The earlier [held-contention evidence](../audit-held-contention-20261029/README.md) proves an avoidable local mechanism using the real RPC/budget/runner over injected responses: an outer 1,200 ms guard admitted source work, the eventual 1,700 ms request guard refused before transport, and the single-page handler discarded its target with 7,999 ms left. Public counter increases during a holding do not identify which live targets experienced this mechanism; provider errors and genuine data limitations remain separate.

## Complete critical path and contention

1. The operating loop handles due financial actions and due held-position protection before source work. Existing complete-protection and pending-action boundaries remain authoritative.
2. Ownership maintenance, cash reconciliation, backup start, reporting/checkpointing and possible candidate entry preparation remain subject to their existing local/deadline gates. They can consume wall time; no earlier timestamp is reused to admit a later request.
3. The outer source opportunity now reserves only the existing 125 ms local planning budget. This lets the runner maintain deadlines and determine its actual next operation instead of guessing that every source step costs 1,200 ms.
4. Runner planning preserves source/target expiry, original independent-audit deadlines, and generation identity. Ready audits continue to prevent discretionary replacement setup and origin verification. Required support refresh, upper-bank-clock coverage, heartbeats, peer PONGs, retirement and reconnection retain their service priority.
5. Before the selected operation, the operating financial gate is called with its complete bound: 2,125 ms for an audit page plus validation, 1,700 ms for native support/setup/retirement, 1,200 ms for heartbeat/PONG and 1,500 ms for an origin read. A blocked operation returns to shared scheduling rather than invoking a request destined for refusal.
6. The same declared bound reaches the actual request wrapper. Its final reservation is the greater of that bound and the unchanged physical timeout plus 200 ms. The wrapper rechecks the current clock, financial envelope, source state and caller deadline. Physical timeout, four-second protection boundary, and absolute ten-second audit deadline are not extended.
7. `PilotRpc`, its one physical slot, provider/query cooldowns, durable request budget, actual-start timestamps and response/validation accounting remain the final authority. Local planning neither creates a free request nor releases an unsettled operation.
8. Successful pages retain the existing strict history, pagination, context-fence, executed-flow and notification checks. Completion can still be unavailable or unusable. No incomplete window is converted into a strategy rejection or qualification.

## Safe logical recovery

Only the actual `PilotRpc` can issue a no-invocation observation through a module-owned `WeakMap`. A generic matching error, a constructed `PilotRpcUnavailable`, copied metadata, or a provider failure after a real invocation has no such proof.

For admission/dispatch refusal inside a call, the proof requires the exact same budget object, an unchanged actual invocation count, zero in-flight work, completed local dispatch and no storage failure. A reservation written before admission was lost remains charged and uncertain; it is not refunded. Ordinary chapter recovery still owns preservation and reopening. Pre-call query/provider cooldown or occupied-slot refusals are separately identified at their actual throw sites; they do not claim that another operation has settled. A final persistence failure supersedes the earlier refusal.

The runner accepts that proof only for the same pool and current call time. It retains the original pending page, target, features, source generation and absolute deadline. Retry opportunities have a 250 ms floor and still pass every physical/financial/provider gate. Deferred audits remain in the pending set so replacement/setup cannot consume their committed runway; only the dispatchable subset is filtered by retry time. Page opportunities update peer fairness. Existing expiration and technical-failure accounting still applies when the deadline is lost.

Generation changes are checked before dispatching an old deferred page. A re-ACK, disconnected/gapped scope, changed window or expired target cannot authorize another stale request or assessment. Diagnostic state distinguishes local recovery waits from actual provider/query cooldowns and reports the original deadline and retry time without asserting physical settlement.

The installed PAPER history policy intentionally disables batches after measured stalled envelopes. A caller supplying the new financial-operation contract is therefore explicitly kept on single-page transport even if it exposes the optional research batch method. Historical research batching without this operating contract remains available; no provider policy is silently widened.

## Controlled validation and limits

The added regressions exercise actual `NativeCandidateRunner`, `FlowWindow`, independent history audit, `PilotRpc` and `ComponentBudget` with locally injected HTTP results. Held completion clocks and pending-action boundaries are explicit synthetic scheduling inputs, not real positions or provider performance evidence.

They verify:

- The measured 1,000 ms held-context failure band retains its original page without a physical request, then completes that same target after a fresh protection epoch.
- Repeated local planning cannot create a 50 ms physical-refusal loop or mislabeled provider wait.
- A real pre-dispatch refusal retains a page, while an unowned matching error remains terminal.
- Admission lost after durable reservation retains its charged uncertainty and uses normal chapter recovery.
- A genuine invocation followed by timeout or a spoofed local-error string cannot obtain no-invocation proof or a replacement physical slot.
- Four simultaneous scopes, including a 3,000-row multipage active scope, make fair progress within their original deadline between synthetic held completion epochs; a pending sell boundary preempts them.
- Old generations and expired targets cannot qualify or dispatch a stale retry.
- Financially guarded source work cannot bypass its operation contract through the optional batch path.

Earlier development outputs are retained, including an invalid overly broad test guard and a fixture that initially omitted the unchanged 250 ms physical spacing. Neither is represented as runtime evidence. Final raw suite/build results, independent review and the exact source/configuration manifest are retained alongside this report when complete.

The strategy, age rules, financial readiness, owner-stop provenance, quote freshness, one-position limit, four-slot operating selection, provider limits and financial source files remain unchanged. This repair requires source-pinned original-service deployment and actual forward dispatch/protection/resource measurements before an operational improvement can be claimed.
