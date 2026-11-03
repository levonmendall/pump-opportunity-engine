# Migration query deadlines and financial recovery

## Established operating failure

The installed source `69a8c2f8c0d79370a422c1d4cfa6fd60830087e6`
passed the administrator's native source, configuration, registry and financial
continuity checks. The task-owned admission marker was removed at
`2026-11-03T22:56:33.339Z` by administrator run `41735020310`. That action
requested ordinary readiness reevaluation; it did not resume the financial
ledger or grant entry permission.

Fresh observations then alternated between
`OPERATING_READINESS_CURRENT_ADMISSION_UNAVAILABLE` with
`POE_ENTRY_PROVIDER_UNAVAILABLE` and
`OPERATING_READINESS_SUSTAINED_PROTECTION_RECOVERY_REQUIRED`.
Cash reconciliations continued, but no operating recovery or usable primary
economic decision had completed in these observations.

Administrator diagnostic run `41735650069` authenticated a current-process
sample with SHA256
`95c8645e1ab48de7f2e211b2277c61bfe003592400009911a9d03e4b65e37988`.
Its selected diagnostic prefixes contain five source-owned `getTransaction`
physical timeouts between `23:00:26.057Z` and `23:00:49.388Z`.
All five used the original 1,200 ms physical timeout. Timer callback lateness
was at most 0.368 ms; each timeout was followed by primary-RPC cooldown and
subsequent real physical settlement with an incomplete response.

One complete retained example is caller request
`native-paper-20261103224151086:request:733`, physical request `293493`:

| Event | Original UTC timestamp |
| --- | --- |
| Source request planned | 23:00:44.764 |
| Physical request started | 23:00:44.787 |
| 1,200 ms timeout callback | 23:00:45.982 |
| Primary RPC cooldown reported | 23:00:45.992 |
| Physical settlement observed | 23:00:46.009 |
| Resulting primary cooldown ended | 23:00:47.992 |

The timeout retained the physical request and 2 MiB response reservation until
settlement. A timeout is not a successful response or a refunded request.

Migration-specific diagnostic run `41735955272` authenticated sample SHA256
`6ef835adc2244307f99e53dd3f7050492f41c4c16949111eac4f673ae41ddbfe`.
It additionally retains three `native-migration-age-unavailable` events with
`PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT`, original seed identities, and matching
primary-RPC timeout/cooldown sequences. This establishes the upstream migration
verification caller, rather than inferring it from the aggregate method count.

## Source path

The age-enforcing migration continuation in `NativeCandidateRunner.verify`
admits one bounded resolver read at a time. Its `getTransaction` calls had no
query timeout scope. Consequently, `PilotRpc` handled their local physical
deadlines through the ordinary recoverable-failure branch and advanced primary
RPC cooldown. Existing finalized token-creation proof reads already had a
separate query-local treatment.

For a flat account, `financialCapacityReason` correctly refuses readiness while
the primary provider is restricted. The ordinary readiness refusal correctly
resets the technical protection recovery interval. Repeated migration-query
deadlines therefore prevented the otherwise healthy account from accumulating
its required continuous 60 seconds of actual reconciliations.

The correction belongs at the upstream query failure boundary. It must retain
the migration's unresolved state, original workflow deadline and retry
provenance, while leaving genuine provider restrictions and physical request
accounting authoritative. The financial recovery thresholds remain unchanged.

## Differential integration regression

The disposable integration fixture runs the production request-options and
scheduled-adapter closures, `PilotRpc`, the production financial-admission
closure, `NativePaper`, and actual durable cash reconciliations. It injects
ten settled transaction-query deadlines over a 76-second synthetic interval.
It uses a fast wall timer with an explicit 1,200 ms advance of its synthetic
operating clock; this is not a provider-latency measurement.

The unscoped case completes 64 cash reconciliations but produces 19 financial
admission refusals and no technical recovery. The scoped case completes the
same 64 reconciliations with no financial admission refusal and exactly one
recovery. The issued proof must cover at least 60 seconds, contain at least
16 actual completions, have a maximum completed gap of 4 seconds, and use a
quote timestamp no older than 2 seconds. Failed physical queries remain
charged. The account, cash, pending actions and history are preserved, and no
trade or holding-protection cycle is invented.

## Evidence limits

The diagnostic exports are bounded selected prefixes, not a complete
15-minute packet archive. Their nominal lookback does not establish full
coverage. Aggregate counters include the earlier deployment pause and cannot
be presented as a post-release acceptance interval. No claim about an
external provider outage follows solely from these locally bounded timeouts.

Passing regression tests or deploying the correction is separate from live
acceptance. Subsequent acceptance must show normal permission recovery and
timely, usable economic decisions with original evidence timestamps, and must
retain any remaining missing-history, quote, replacement, publication or
protection failures as failures.
