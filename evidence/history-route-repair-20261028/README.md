# Targeted history route and independent cooldowns

This is an isolated implementation, not a sustained provider-capacity result. No network or financial operation was run for this repair. Parent lead evidence establishes current primary-host history failures, a rejected20-row intervention, and six fast history-only responses from the fixed keyless PublicNode endpoint. Six calls do not prove reliability or a provider quota.

The native PAPER runtime now explicitly pins `publicnode-history-only-v1` for `getSignaturesForAddress` only. Pricing, support, transaction reads and WebSocket capture retain `api.mainnet.solana.com`. The route is included in the configuration hash, immutable authorization, HTTP lifecycle records and status. It is not fallback, request retry, endpoint/IP rotation or a second request allowance.

The original single ComponentBudget and physical gate still own all starts, spacing, rolling limits, response/uncertainty accounting, run duration, timeouts and actual cancellation settlement. Audit page size100→1000,1.5s physical timeout,2s declared operation bound and original decision deadlines are unchanged. Actual unsettled requests block every domain; malformed/storage/fatal evidence failures retain fail-closed behavior.

History-provider HTTP429/502/503/504 and escalated history timeouts now retain history-provider cooldowns instead of suppressing healthy primary pricing or capture controls. Retry-After is durably persisted on history throttle headers, including headers received after a logical timeout. The run manifest carries history cooldown on normal settlement and crash-recovery status reconciliation. A linked429 book with this route requires an explicit history cooldown receipt; it cannot silently guess one. Successful primary reads/control work do not erase the history cooldown.

History audit selection uses the history dispatch view. An oldest query in local cooldown cannot starve an eligible peer. A primary HTTP cooldown permits an already-supported history audit only if the physical gate is healthy and its current bank-ceiling evidence already exists. A missing upper ceiling still waits for primary support. Captured evidence, original target/deadline accounting and source-generation validation are retained.

The bounded calendar exposes unavailable ready targets separately. Targets whose known history readiness plus declared page bound is after their original deadline retain their unavailable/deadline accounting but cannot reserve impossible page work forever and silence degraded local reporting/backup. This does not validate those windows, authorize entry, clear cooldown, or promise six-page/holding capacity. Financial and required native-service priorities remain unchanged.

Verification: build and135 focused tests passed. Twelve added regressions cover fixed routing, shared accounting/spacing,429/503/late-header containment, inherited history cooldown, no implicit fallback, physical cancellation ownership, batch method routing, cooling-oldest fairness, primary-ceiling prerequisites and six-target degraded reporting. Existing runner, transport, launcher and PilotRpc tests ran together. The initial regression output is retained: changes to legacy wait diagnostics were corrected, and a new fake-clock test was corrected to advance its declared250ms pacing rather than expecting physical starts at a frozen timestamp. Those were offline failures, not forward observations.

Reproduce:

```sh
npm run build
node --import tsx --test test/pilot-rpc.test.ts test/component-transport.test.ts test/native-candidate-runner.test.ts test/native-paper-launcher.test.ts
```

Parent lead must run the complete repository suite, freeze the reviewed executable/configuration, update the strict readback metadata allowlist, and validate actual audit results plus sustained resource timelines in the next bounded forward interval. No source-wide capacity or profitability claim follows from these offline tests.
