# Measured history-query failures and the bounded transport intervention

**Result:** the original endpoint's history-query problem is real in this sample, but its internal cause is not established. Reducing the history page from100 to20 rows did not repair it. One fixed, keyless alternative completed the same six100-row history queries within the unchanged1.5s operating timeout. This supports a narrow history-only routing experiment, not sustained provider capacity or autonomous-trading acceptance.

The three probes were independent, sequential EC2 components after c189 had stopped flat. They read no financial database, modified no financial files and left the original observer unchanged. Their source hashes, administration commits, UTC periods, receipts and measured results are in [PROVIDER_FAILURE_COMPARISON.json](PROVIDER_FAILURE_COMPARISON.json); raw bounded records are retained beside it. No provider request was made by this offline comparison.

## Exact comparison

Physical latency below runs from actual fetch invocation through body/JSON completion and reader settlement; it excludes approximately3ms of reservation/setup before invocation. A timeout is right-censored at the3s diagnostic limit plus bounded cancellation settlement. The operating audit timeout remains1.5s.

| Component / UTC on2026-10-28 | History route, page | Affected pools: complete/attempted | Affected-pool physical results | Quiet control physical results |
| --- | --- | --- | --- | --- |
| [40776522997](https://github.com/levonmendall/meme-machine-admin/actions/runs/40776522997),22:00:25.505–22:00:39.400 | api.mainnet.solana.com,100 |2/4 | J6: both headerless timeouts; HK:2509/2249ms |86/68ms |
| [40777452497](https://github.com/levonmendall/meme-machine-admin/actions/runs/40777452497),22:07:16.841–22:07:32.000 | same original endpoint,20 |0/4 | All four headerless timeouts |116/65ms |
| [40778700703](https://github.com/levonmendall/meme-machine-admin/actions/runs/40778700703),22:16:42.964–22:16:49.207 | solana-rpc.publicnode.com,100 |4/4 | J6:168/141ms; HK:245/368ms |126/209ms |

The affected pools were46ZfGg4F6r93ZNGBrQywzA9dQfgbyJu2ye7vb58UhXnR (J6NTA5Fa… token) andGAZmLL5v2omUcBmfVQyPwZWyrENt4uaonmCodfRUkjLp (HKvyE87… token). The control wasoMwGi1ntDawN9qJBhCjBXWaE8Je171DEzKn1rwJTMJp (DgxHupi… token). These identities are historical verified subjects, **not fresh pool-support or liquidity evidence**.

Each probe made a fresh confirmed Clock read for each subject on the original endpoint, then one history query with the historically captured slot floor and one with that fresh Clock context floor. Order alternated between pairs. Both original and alternative endpoints accepted the tested floor parameters when responding; the alternative returned100 rows in every history response. No history contents were independently audited in these diagnostics.

## What the measurements resolve

- The original1.5s runtime timeout can censor an otherwise usable history response: two same-endpoint responses completed in2249–2509ms under the diagnostic3s bound. This does **not** justify increasing operating deadlines: nonpreemptible HTTP occupancy competes with protection, native liveness and other candidates.
- Fresh versus historical `minContextSlot` did not explain the failures. J6 failed with both; HK page100 eventually responded with both; page20 failed with both. The alternative responded with both, including floors from a freshly validated original-provider Clock.
- Connection reuse alone did not explain them. Original failures occurred on both previously observed and first-observed sockets. The quiet control succeeded through reused and first-observed sockets. A first-observed socket means only that this probe had not previously seen that actual socket object.
- The retained original timeouts had no response headers/body. There is no evidence that local JSON decoding or large body transfer consumed their elapsed time. Node's `undici:client:sendHeaders` hook is **before the write**, not proof of bytes on the wire or remote receipt. DNS, TLS, intermediary and server-side time cannot be causally separated by these records.
- The page20 intervention is rejected as a repair: all four affected queries still timed out and additional paging would increase request demand. Sequential, nonrandomized measurements cannot establish that page20 itself caused worse latency.
- No429/503, overload or unresolved Retry-After occurred in any of these three components. This is not evidence of an entitlement to a particular sustained rate. The historical failures and cooldown records remain unchanged.

The main c189 interval's20 unavailable audits/14 expiration records should not be reclassified as pure scheduler starvation: all20 unavailable audits timed out after dispatch, with6.012–6.664s of the original decision runway still remaining. That is separate from previously demonstrated replacement-setup contention, which the coherent deadline repair addresses. Failed audits and missing successful signatures remain unavailable/unusable evidence, not predictive rejections.

## Narrow next operating change

A fixed history-only route to the tested alternative is worth forward validation. Keep original-provider pool/account/Clock pricing and native subscriptions, confirmed commitment, current support checks, physical timeout, predictive deadline, independent multipage audit and complete-trade requirements unchanged. Keep one physical operation gate and the same shared request, byte and pacing accounting across both routes. Treat alternative-provider cooldown separately so a history429 cannot close healthy native capture or prevent primary-provider holding pricing; genuinely unsettled physical operations must still fence all dispatch. Do not automatically retry or rotate routes after throttling.

The official public pages, retrieved2026-10-28 at22:09UTC, advertise a free public endpoint at`https://solana-rpc.publicnode.com`; [receipts and extracted text](publicnode-feasibility/) retain exact URLs and hashes. The separately advertised archive/Geyser access was not used. No key/account/paid plan was attached. Numerical allowance, SLA, and sustainable rate remain unverified; terms and actual provider responses remain binding. Existing compute, transfer and storage costs were not established.

The next combined interval must establish actual audit paging/completeness, deadline dispatch and settlement, notification continuity, per-route errors/cooldowns and sustained resource use. Record15s source/publisher process-group CPU/RSS, headroom, storage, request/method/byte totals and event-loop/validation timings with their original source timestamps. A6s provider probe cannot establish these properties. Keep candidate data loss distinct from strategy failure and protect held exposure before discretionary candidate work. No live holding or exit behavior is demonstrated by these components.

## Append-only usage reconciliation

| Component | Solana physical starts | Measured response bytes | Retained uncertain bytes | Local metadata reads, separate |
| --- | ---: | ---: | ---: | ---: |
| Original100 |9 |97,220 |4,194,304 |2 |
| Original20 |9 |10,686 |8,388,608 |2 |
| Alternative100 |9 |142,332 |0 |2 |
| Total |27 |250,238 |12,582,912 |6 |

The known source-book baseline was8542 units,979,334,227 accounted bytes and507,248,640 uncertain bytes, as retained in`paper-forward-02/analysis-c189.json`. Including these auxiliary components once gives**8569 known Solana units,992,167,377 accounted response bytes and519,831,552 uncertain bytes**. Accounted bytes include measured bytes plus retained uncertainty; do not sum that uncertainty again. The source counterbooks and financial manifest were not rewritten. Documentation downloads are separately receipted HTTP research traffic, not Solana RPC units. No actual usage or uncertain reservation was refunded.

All27 provider operations physically settled. Host-wrapper peak process-group RSS was81,244,160 /82,157,568 /83,320,832 bytes across the three short probes. These peaks are **not sustained resource-consumption measurements**, and no CPU-per-hour or continuous-capacity projection follows from them.
