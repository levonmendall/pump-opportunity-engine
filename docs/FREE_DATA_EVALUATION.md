# POE zero incremental data cost evaluation

**2026-10-27 UTC · review branch `poe-free-data-evaluation-20261027` · research only**

1. **Decision: Free configuration PROMISING, WITH SPECIFIC REMAINING EVIDENCE GAPS.** The approved experiment stopped at its capacity preflight. No new PumpApi stream opened; no combined-workload or continuous-protection pass is claimed.
2. **Actual result:**6public-RPC requests/81,729response bytes verified one current v1 CPI-invoked canonical SOL-pool sell_v2. A20-entry pool-history page covered only one chain second, so its sustained activity/enrichment demand could not be bounded. Gate: `POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN`.
3. **Production capacity:** the proposed3-call pricing cycle every2seconds alone requires90RPCstarts/minute, above production's unchanged60/minute limit. Selected enrichment adds work; it was not measured live. The full tested design is not ready for production.
4. **Still missing:** supported mint/fee/vault verification for the selected current pool, matched PumpApi Buy/Sell data and precision/commitment contract, complete usable windows, actual enrichment queue/cost and changing-price protection response. This sample establishes no broad coverage or profitability.
5. **Smallest justified next step:** review the bounded selector's handling of burst-saturated candidates and a moderate-activity cohort before another live attempt. No more budget, Alchemy screenshot, Helius access, paid service or wallet action is requested. Existing unused allowance is preserved; this attempt was not automatically retried.

## Approved attempt: actual evidence and stop decision

The owner approved one<=90-second capture,256MiB cumulative PumpApi/5minutes
cumulative reserved time,128MiB new reservation with127MiB socket stop,
240additional public-RPC reads/64MiB responses and32MiB retained evidence.
`active-approved-allowance.json` records that approval and its exact source hashes;
`active-approved-supervisor.json` records the independently supervised outcome.
No production restart, account/financial mutation, wallet operation, paid provider
or second test occurred. Offline validation included the combined runner's
raw-selected-payload retention, confirmation availability, bounded shutdown and
finalized-event correction handling.

Selection used **one latest32-signature PumpSwap-program page**, with at most8
systematically spread recent successful transactions and24total preflight reads.
This is an activity-biased transport selection, not an unbiased opportunity sample.
Four transactions were fetched; the fourth contained a genuine canonical SOL-pool
Sell. Exact mint `91RBVuoCLvikHs4qeUGczABotGLd1Tjo84DMfpFUpump`, pool
`4dgUjYxeCnq7ZSqrNu14FWXmDiJrWmmw7wigL7VRHFsW`. Three earlier transactions did not
invoke an eligible canonical SOL pool. Address membership was not treated as a swap.

The selected pool's latest20history entries all had chain time
2026-10-27T02:43:51Z and spanned two slots. Twelve were successful address
transactions and eight failed. This is **not twenty verified swaps**, a sustained
rate, or a complete60-second baseline. The truncated page could hide much more
activity; its upper demand and compatibility with the48-enrichment allocation
were unknown. The preflight refused immediately, before current SDK pool/mint/
fee/vault pricing support was tested. **Canonical identity is verified; full
current pool support and entry-age eligibility are not.** No feed opened and no
new PumpApi reservation was appended. There was no quiet capture falsely labeled
as successful and no pagination/retry to hide the refusal.

One actual current transaction does improve on-chain decoding evidence:

| Field | Verified current RPC evidence |
| --- | --- |
| Transaction | Version1, successful confirmed read; signature `2LweUYAawyFV6VEVZcAXuUoM4AThkZ2qRdGs4TW39wR2bwcmGGU4LmCh8PSZvH7CV8H2qjJGpiLVEBSBteJXEDh7` |
| Direction/invocation | sell_v2, outer instruction3, actual PumpSwap inner instruction1, event-CPI inner instruction7; one encoded event |
| Executed base |178680009681integer base units; scoped token transfer agrees |
| Curve/user SOL |297140024gross lamports;293722911user lamports; scoped WSOL transfer agrees |
| Fee meaning |LP594281 +protocol148571 +creator2674261 =3417113lamports; gross minus these equals user proceeds. The reported74285buyback field is not another deduction in this event. |
| Trader |Actual event `user` and swap account roles agree; trader differs from transaction fee payer in this **real** sample |
| Scope limitation |One CPI-invoked Sell; no current Buy or multiple selected-swap case verified. This is RPC evidence, not a matched PumpApi payload. |

See [active-approved-analysis.json](../evidence/free-data-20261027/active-approved-analysis.json)
and the bounded raw `active-approved-record.ndjson`. No later confirmations were
backdated. No feature window or hypothetical current price was produced from this
preflight; changing-price exits, stream queue age and completeness remain untested.
Retained-source replay and synthetic exit tests remain separately labeled.

**Usage:**6of240additional requests,81,729of67,108,864response bytes;2signature
reads and4transaction reads, no retries/throttling. Remaining234requests are
unused, not a reason to start another attempt. Preflight child RSS peaked at
142,168,064sampled bytes/kernel max152,338,432bytes; recorded CPU159ms excludes
module imports. Those are Cloud **preflight** resources, not a combined workload
or EC2 compatibility proof. Prior PumpApi totals stay102.04MiB actual,
112MiB/100seconds reserved, with their original receipt hash unchanged.

**Capacity and wider scope:** fixed2-second pricing needs90requests/minute before
any flow enrichment/history versus the installed60/minute client. Raising a
research ceiling to150/minute does not show production fits. A burst-selected
pool cannot establish the rate distribution of12candidates or three holdings;
failed pool touches and swaps have different denominators. Existing broad-feed
bandwidth projections remain conditional, not measured continuous operating cost.
Documented API/data charges are$0; infrastructure/transfer entitlement remains
unverified and separate. No provider billing account, paid plan, wallet or new infrastructure was used.

The smallest follow-up is an offline bounded selection-policy review that can
exclude saturated pools and identify a moderate, independently verified activity
cohort without changing strategy thresholds. A further live attempt must not be
automatically opened by rerunning this completed grant. No paid provider or
larger quota is justified by this failed preflight alone.

Production read-check02:54:21UTC: snapshot482, original account/inception/release,
reconciledtrue, source facts25.02seconds old, entriesdisabled and positions/trades0.
No production deployment or restart occurred and no acceptance clock started.
Build/compile and275tests pass; focused independent review verified the refusal
and currentSell_v2 amounts, attribution and identity. See
`active-approved-production-check.json`/`active-approved-validation.json`.

The remaining sections retain earlier evidence/plans chronologically. Previously
pending allowance questions are superseded by the approval and outcome above.

## Earlier narrowed plan and allowance proposal — 2026-10-27 (superseded)

The prior broad captures remain102.04MiB actually received,112MiB reserved of
128MiB; reserved time100seconds, actual open time84.526seconds. The16MiB
unreserved byte allowance supports only about12–13seconds at measured rates.
A70-second window needs83.75–96.17MiB: **67.75–80.17MiB more than unreserved
capacity**, before enrichment/independent audit. The actual-versus-reserved byte
difference is not automatically refunded. Original budget receipts are unchanged.

One bounded selection check used the retained canonical pool with highest
historical effective SOL liquidity (`6ztGkeEPFbrBVh53fKbRtJk4Y74UBjPE8R5q5Ke2hvZv`).
Its latest20signatures showed no successful address activity in the preceding
10minutes:1public read/4,508bytes. It was rejected for the next transport test.
A single latest12-signature PumpSwap-program page then supplied the first three
successful transactions no older than60seconds:4reads/32,498bytes total. One was
a real Sell with **WSOL as base/custom token quote**, noncanonical and outside POE;
the other two mentioned the program address without invoking it. This supplies
negative decoding fixtures, **not an active supported sample or evidence of bad
feed coverage**. No pagination, broad archive or further search was performed.
Selection was explicitly activity-biased transport research, not strategy results
or unbiased opportunity selection. See `active-preflight-*` and `public-activity-*`
receipts in the evidence directory.

`src/pumpapi-mapping.ts` now treats a selected PumpApi frame as a signature hint
only. It uses a successful confirmed transaction's genuine event-CPI bytes and
compiled account roles for exact executed token units, curve SOL, user SOL,
fees, direction and actual `user`; it never substitutes the fee payer or UI
float. Full outer/swap-inner/event-inner identity is retained. The actual event-CPI
inner index can supply the research type's event index because each such CPI
encodes exactly one event; this is a real chain position, not an invented provider
ordinal. Logs and CPI representations do not double count. Transfer-validation
changes are corrections even when event bytes stay identical. Unknown/truncated
layouts and failed/missing transaction evidence are refused.

Explicit `curve` and `user` **RESEARCH_ONLY** views preserve both amount conventions
and original RPC-availability time. They can exercise existing unchanged feature
code without silently choosing the primary strategy convention or enabling flow
in production. Conversion requires a named supported-pool evidence identifier and passing
transfer checks; the harness must verify that the evidence matches the pool
and current supported behavior. PumpApi commitment/correction semantics remain unknown; current
official stream/FAQ pages rechecked2026-10-27 do not establish them. Confirmed RPC
enrichment is therefore later information and must not be backdated. Subsequent
finality/reversal checking is still needed. There are **no retained selected
PumpApi payloads** from which to finish provider-specific amount matching offline.

Minimum enrichment is **one `getTransaction` per distinct selected signature**,
not one per message or swap. One transaction may contain multiple real events;
confirmation failures, retries if explicitly allowed, history and pool/fee reads
must also count. The current five-read sample cost is37,006response bytes with no
stream usage; it is not a measurement of the combined candidate/pricing workload.
Direct Buy/routed/multi-swap matching and genuine changing-price exit response
remain untested. No hypothetical live holdings or natural trades were created in
this follow-up. Details/tests: [PUMPAPI_MAPPING.md](PUMPAPI_MAPPING.md).

**Proposed, not approved:** raise cumulative PumpApi receipt to**256MiB**; use a
stricter**5-minute cumulative time sublimit** within the existing30-minute limit,
including prior100seconds reserved; permit **one90-second active-pool combined
capture**,5-second shutdown reserve, and **240additional public-RPC reads/64MiB
responses**. Keep one connection/IP and the existing32MiB total evidence cap.
New128MiB reservation plus prior112MiB becomes240MiB, leaving16MiB transport
headroom. Stop at127MiB for the new socket,90seconds or any quality/resource limit;
no retry or second empty sample. This request raises bytes, not authorization to
spend. It is recorded in `active-capture-proposal.json`; existing hard counters
are not changed until approval.

RPC allocation:12preflight/identity/activity reads,135pricing reads (45three-call
cycles at2seconds),48distinct-transaction enrichments,12history/transaction audit
reads,33failure/in-flight headroom with no automatic retry. **Admission gate:**
recent independently verified successful supported-pool trades and activity/burst
rate must fit the full window/enrichment budget after pricing is reserved. If
those gates fail, no socket opens. If data loss or a cap interrupts the run, mark
its window unusable. Preserve actual received/confirmed availability and report
unobserved trade variants rather than extending the test.

This research allowance would require a separately enforced shared test ceiling
of150RPC starts/minute,30per10seconds and one in flight. Production's existing
60/minute client stays unchanged:3-call pricing at2seconds already needs90/minute
before enrichment. That is an explicit integration-capacity gap. The proposed
2-second attempt schedule measures freshness, stale periods and response; it
does not certify a maximum response or lower the2-second **at-use** freshness
rule. No production protection will be replaced. API/data fees are documented$0;
Cloud infrastructure/transfer allocation remains unverified, and no new charge,
paid plan, funding or EC2 experiment is authorized by this proposal.

Current combined validation: build/compile and245tests pass, including10new mapping
checks. A read-only dashboard check at02:13:11UTC retained the original account/
inception and installed release, snapshot406, entriesdisabled, positions/trades0,
reconciledtrue; source facts44.87seconds old. No production action occurred.

The following sections retain the earlier comparison evidence and account facts.
Alchemy/Helius material is **historical, outside the current assignment**.

## Production boundary and actual requirements

The installed EC2 release is `bce3d22bb434eb429aafacb788a18f39ec189c1b`, strategy
`UNIMPLEMENTED_FLOW_BLOCKED`. It observes free PumpPortal migrations and public
SOL/USD, reconciles a cash-only account and publishes authenticated snapshots to
the existing public Render viewer. It is **an observer, not an autonomous PAPER
trader**. At01:41:36UTC the existing read-only status check verified enabled/running, zero
restarts since22:30:55UTC, fresh reconciliation0.425seconds old,67MB RSS and
57.81GB root availability. Snapshot349 at01:41:32UTC matched account/inception
and source release with underlying facts16.25seconds old. The original Free
Render service remains on main with automatic deployment off; public viewing
and machine authentication are unchanged. See `production-*-final.json` and
`render-service-final.json` in the evidence directory.

No production restart, account initialization, snapshot injection,
entry enablement, wallet operation or infrastructure change was performed by
this experiment. Natural PAPER trades remain zero; acceptance clocks are off.

The development rule remains `persistent-buying-v0-unfrozen`; none of its
thresholds or information requirements changed to fit a provider.

| Purpose | Actual fields and timing | Evidence/limitations |
| --- | --- | --- |
| Discovery | Migration signature, mint, observed receive time; confirmed successful migration instruction and PumpSwap creation CPI; canonical pool/program, SOL quote, mint behavior and age | Free PumpPortal discovery followed by bounded RPC verification. Feed observation is provisional until checked. Scope is migration age 5–120 minutes for entry; older pools can still be hypothetical held-position tests. |
| Candidate flow | Per executed trade: mint, actual trader wallet, side, **integer** token units/SOL lamports; signature plus genuine instruction/event identity; commitment, receive time and available slot | Required for gross/net buying, buyers and concentration. Fee payer is not automatically trader. Provider UI numbers or aggregate net swaps cannot silently substitute. The economic amount convention—wallet net versus gross/pool flow and fee treatment—still needs a verified adapter contract. |
| Qualification | Six **closed 10-second receive-time bins**, 60 seconds total, up to 70 seconds warming when unaligned; net buying ≥1 SOL; ≥4 positive bins; ≥5 buyer wallets; largest buyer ≤35%; nonnegative first-to-last trade price return | `src/strategy.ts`. Different wallets do not prove independent people. Price structure uses observed lamports/base-unit ratios, not executable quotes. Gaps/corrections invalidate and rewarm affected windows. |
| Eligibility and risk | Verified migrated canonical SOL pool, supported mint/extension checks, current actual-size buy quote ≤2 seconds old at use, size/effective-liquidity ≤5%; $50 initial all-in cost, three positions/$150 aggregate, durable $50 UTC-day loss pause | Exact-size SDK quote, fees, gas/rent/account planning and reconciled equity remain mandatory. No thresholds were loosened. |
| Held pricing/protection | Exact held base units, pool/config/fee/mint/vault state, signed virtual/effective reserves, confirmed coherent batch context; market block age ≤30 seconds and mark age ≤2 seconds **at use** | Three real RPC calls currently supply one helper quote. A state notification triggers refresh; independently arriving account values do not constitute a coherent mark. Pool age entry exclusion does not erase held exposure. |
| Held exits | Conservative gas-net liquidation versus cost: 15% stop, 30% profit threshold, 15-minute maximum holding time | Current exits have **no flow-dependent term**. Paid trade flow is not required throughout a holding merely for these exits. A future flow exit would need its inputs. Monitoring cadence/maximum response are not frozen; the 2-second at-use age is not a mandate for continuous 2-second polling. |
| Execution | One earliest modeled attempt after 1-second delay, 5-second expiry; fresh size quote and limits; unknown/failed exits retained | No signing, transaction simulation/submission or actual position was needed for these tests. A mark is not a fill and a stop is not a guaranteed price. |
| Integrity/recovery | Wall receive time plus monotonic durations, complete instruction identity including inner/routed swaps, commitment upgrades/reversals, bounded queues; restore subscriptions and rewarm after gaps | Do not backdate confirmed information into earlier windows or infer loss from sparse slot jumps. Financial recovery is distinct from replaceable market context. |

Supported token checks remain pinned to Pump SDK 2.2.0 and the current code:
legacy SPL or supported Token-2022 behavior, including the tested metadata
extensions; unsupported transfer behavior, authority/account mismatch, pool
variant or malformed state is refused. Raw vault balances alone are not prices.

## Eligibility, official sources and configuration decisions

Primary documents were retrieved/rechecked on **2026-10-27**. Detailed references
and interface limits are in [FREE_DATA_REQUIREMENTS.md](FREE_DATA_REQUIREMENTS.md),
[HELIUS_ASSESSMENT.md](HELIUS_ASSESSMENT.md),
[ALCHEMY_ASSESSMENT.md](ALCHEMY_ASSESSMENT.md) and
[PROVIDER_BINDINGS.md](PROVIDER_BINDINGS.md). Documentation is not an account receipt.

| Configuration | Classification | Verified result and gap |
| --- | --- | --- |
| Free PumpPortal migration discovery | **VERIFIED FOR THE TESTED SCOPE** | Existing observer plus new actual migration/pool/quote proof; discovery only, no selected-token trade-flow claim. |
| Helius Free Parsed Streams + targeted RPC | **BLOCKED BY ACCESS** | Current official docs list confirmed-only Parsed Streams on Free, 1 credit/delivered matching transaction, 1M shared credits/month. No usable existing binding or verified remaining Free credits was located in tested scopes. No request/subscription/credit used. |
| Existing Alchemy filtered transaction stream + batched RPC | **BLOCKED BY ACCESS** | Existing repository secret and HTTPS Alchemy Solana host verified without revealing key or contacting provider. Current account plan, remaining free CU and overage state unavailable. No Alchemy data request made. |
| Public RPC coherent batch sell pricing | **VERIFIED FOR THE TESTED SCOPE** | Small read-only actual-size hypothetical quote and captured-state parity; no production SLA, long-run protection or candidate-flow claim. |
| Public RPC account-change triggers + reconciliation | **PROMISING, WITH NAMED EVIDENCE GAPS** | Reconnect/restoration and fresh recomputation work in a quiet pool; no changed pool/vault content or natural adverse price move tested. Earlier schedules leave stale gaps. |
| PumpApi broad stream for candidate qualification | **PROMISING, WITH NAMED EVIDENCE GAPS** | Credential-free data is received and bounded, but exact amounts, identities, commitment, corrections, selected-trade coverage and useful feature windows are not established. Current adapter deliberately emits no normalized trades. |
| Pool polling alone as replacement for complete candidate flow | **UNSUITABLE FOR THE STATED REQUIREMENTS** | Cannot recover every trade, buyer, gross buy/sell sequence or concentration from occasional reserve states. |

Helius current GA/Free documentation conflicts with older paid-only beta copy;
the current interface is used for planning, but actual entitlement is unverified.
Its filter must combine selected pool accounts, PumpSwap program/instructions and
`includeCpi`; executed amounts must be distinguished from order constraints.
Confirmed delivery cannot be treated as equivalent to PumpPortal processed data.
No paid PumpPortal trade subscription was activated as a reference.

Alchemy's Solana native `blockSubscribe` on the documented streaming host filters
matching transactions by one selected pool account; it is confirmed/finalized.
`logsSubscribe` can deliver provisional processed logs, with subsequent checks.
Ethereum-specific subscription names do not establish Solana support. One
historical successful v0 Sell decodes through the pinned official IDL and agrees
with transfers/fees; a fee-sweep is excluded. Buy, routed/multiple swaps, future
transaction versions and **actual Alchemy delivery** remain unverified. This is
decoder evidence, not a live completeness sample.

## Budgets, isolation and counters

- Incremental provider/data budget: **$0**. Unverified eligibility leaves Helius
  and Alchemy executable data budgets at **zero**. After verification, caps are
  `min(20000, floor(0.02 × remainingFreeCredits))` and
  `min(250000, floor(0.02 × remainingFreeCu))` respectively; account-wide other
  usage, stream/reconnect overhead, history, verification and headroom count.
- PumpApi assignment cap: 128 MiB received and 30 minutes total across attempts;
  one data-only connection per IP. Reservations are persisted before network
  use, retained after uncertain exits and never refunded automatically.
- All new retained evidence: ≤32 MiB, separate `evidence/free-data-20261027/`.
  Named adapter allocations total 29 MiB; aggregate space checked before capture.
  Broad stream payloads are discarded rather than persisted or enqueued.
- Tests run as nonroot Cloud UID1000, **not EC2**. Child heap/RSS, CPU, file size,
  descriptors, wall time, message size, queue depth and parent heartbeat are
  bounded. This does not establish EC2 compatibility or egress allocation.
- The PumpApi socket owner holds the connection lock; parent budget lock is
  separate. Parent IPC loss closes the child socket. An offline real-process
  supervisor-death test verifies that restart cannot overlap the orphan lock.
  Exact host, no authentication, redirects disabled, no action/subscription
  messages and no trading endpoints or wallet material.

No provider plans, account permissions, billing settings, paid credits or
infrastructure were changed. Protected GitHub checks returned only named-binding
presence and public host validation; no secret URL/value was exported. GitHub's
existing PUBLIC repositories' standard hosted metadata jobs used isolated branches,
no legacy application/tests/deployments and no provider requests.

## Actual experiments and denominators

### Free discovery and pool verification

The first next successfully verified migration was selected without future price
or activity filtering: mint `CRpqtPYyBckKTwgrixiPBYQsi6YESBxA8LMJ5p3fpump`,
pool `oT9d7guo6As8KqNQsBJKm62Rkzqa6ZA8XmAhcFrLVZz`, received
01:16:18.252Z. Confirmed v0 migration/create CPI, slot461880832, supported
Token-2022 metadata behavior and Mayhem signed virtual quote reserve were checked.
Five public RPC requests received29,781bytes; full run34.243seconds. A0.01SOL
quote returned11,376,382,925,120base units and same-state sell8,736,099lamports.
These are independent estimates with embedded pool fees, not fills or performance.

The original capture incorrectly reported clean source when run from a nested
evidence directory. Its proof retains that original field and a **later**
provenance correction: actual source was modified, exact capture digest unavailable.
The helper now resolves the code's repository root and regression tests cover
nested paths/untracked source. This capture is not a frozen release or acceptance
gate. See the [integration proof](../evidence/free-data-20261027/discovery/evidence/integration-proof-2026-10-27T01-15-44.429Z.json).

Second cohort mint `2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump`, pool
`DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD`, came from the previous real
migration capture. It was a quieter example in the earlier state test; that does
not establish broad source activity. Its migration age exceeded120minutes during
the later experiment, so later use is **hypothetical held pricing**, not eligible
entry evidence. No active/busy matched cohort has been proved.

### PumpApi schema/resource probe

The first10-second/8MiB-reserved probe closed at its byte headroom after5.864seconds
child elapsed (about5.10seconds open; parent6.073seconds): **5,101frames**,7,320,474
application bytes,7,341,091socket-counter bytes,5,098parsed,0malformed. Three final
frames after the stop decision were counted. There were **zero selected events**
for the two verified mints and zero normalized trades; completeness denominator
is therefore **unavailable**, not100% or0%. No strategy-usable window completed.

Field inventory observed numeric `tokenAmount`/`quoteAmount`, nested `trader`,
signature, block/timestamp and pool fields. It did not establish exact integer
semantics, true instruction indices or commitment/reversal behavior.536repeated
signatures in a bounded fingerprint sample are **not**536duplicate trades; multiple
events may share one signature. No signature-only deduplication occurred.

Peak supervisor RSS77,463,552bytes; child CPU635ms including startup; peak sampled
event-loop lag8.79ms. Selected queue high-water0 reflects absent selected events,
not proved throughput under a busy selected pool. Only986bytes of raw record were
retained. The stop's one gap is closure, not evidence of a provider loss.

At this short broad-feed rate (~1.44MB/s),70seconds would receive~100.85MB. The
original64MiB next-stage plan could not warm that window; this alone does not
prove the128MiB assignment cap insufficient. A revised bounded plan reserves
104MiB for a single80-second attempt plus the original8MiB, leaving16MiB for
unmetered framing/TLS/proxy/in-flight uncertainty. Exact wire overhead is not
measured by Node socket `bytesRead`.

The revised capture completed80.006seconds child elapsed,79.430seconds open
(01:35:40.961–01:37:00.391Z): **61,948frames**,99,405,838application bytes,
99,653,847socket bytes;17,018messages were labeled `pump-amm`. Both selected mints
again had zero events. A raw transport warm condition was reached, but **verified
strategy-usable observation time remains zero** because flow/field integrity is
unverified. There was no unexpected in-window disconnect. PeakRSS109,260,800bytes,
CPU4.607seconds including startup, peak loop lag9.23ms; selected queue high-water0
and selected queue-age percentiles unavailable. Only985bytes of raw record were
retained; broad messages were not archived. There is no third live attempt.

Across both attempts:84.526seconds open,106,994,938socket bytes (**102.04MiB**),
112MiBreserved; aggregate receipts retain both attempts and the16MiB headroom.
See [pumpapi-results.json](../evidence/free-data-20261027/pumpapi-results.json)
and the adjacent capture plan/budget receipts.

A **later** public-RPC history audit used two requests/9,435bytes,20signatures per
pool. Both bounded lists extend before both observation windows, with no null
block times and **no pool-address transactions in either window**, including a
±2second boundary margin. Thus zero selected events are consistent with zero
observed on-chain pool activity in this bounded sample. The swap denominator is
zero: no trade completeness percentage, field mapping, paired latency or decision
equivalence can be computed. No extra transaction fetch was needed. The audit is
a later confirmed view, not feed replay or full-market coverage. No busier selected
pool was obtained before the receiving budget was committed; large broad message
counts do not substitute for a matched busy-pool sample.

### Public RPC state transport and actual-size replay

The earlier same-pool capture lasted60.070seconds,58.329seconds overlapping ready
transport. Poll7.5s:8attempts,7fresh quotes,24HTTP requests. Account subscriptions
with15s periodic reconciliation plus change-trigger refresh:7fresh quotes,21HTTP
plus14WS control requests;65total requests across setup/test,173,593HTTP bytes and
24,825notification bytes. Planned disconnect restored seven subscriptions and a
verified quote623ms later. One block-time request returned unavailable; another
unexpected socket close occurred near58seconds. Failure is retained, not retried
into a favorable sample.

All17notifications were writes to shared config/native-mint accounts with
unchanged selected content; watched pool/vault content changes were zero. No in-window underlying swap denominator was obtained.
Both paths share public RPC, so agreement is not independent chain coverage.
Only22.57%/22.26% of elapsed cache time was within2seconds; longest stale gaps
13.066/13.244seconds. Different fallback cadences confound request savings. Neither
transport is accepted as a replacement for position protection.

Chronological replay uses16retained coherent account batches,15usable quotes and
one unavailable block-time sample. SDK single quote, RpcMarket and shared-batch
decoder agree exactly on the **same bytes available at the same recorded times**.
Original successful quote age at availability p50=60ms,p95=80ms; coherent-batch HTTP
p50=50ms,p95=89ms excludes earlier uncaptured link-discovery timing. Four notional
exit scenarios preserve unchanged rules; the synthetic15-minute boundary was
recognized1,477ms after its declared time. Synthetic stop/profit conditions were
already true at first quote, so their0ms recognition is not adverse-move latency.
No new network use, financial account or forward performance resulted from replay.

### Current shared-batch live proof

The two verified pools were repriced in three immediate shared-batch rounds at
01:34:41.927–01:34:42.824Z: **9public RPC calls**,38,298response bytes,6/6usable
hypothetical full-size sell quotes. Each matched the established single helper
on the exact same captured account bytes offline. Whole round durations were
209.25/216.39/432.00ms (p50=216.39ms,p95=432ms, **n=3**); source age at availability
59/72/78ms. CPU300ms, RSS~148MB; no natural pool-price change or exit was observed.
Two holdings use3calls instead of6; three-holding9→3 savings are proved only with
explicit synthetic fixtures. Quotes preserve fee/mint/vault/virtual-reserve checks,
full integer quantities and one confirmed coherent dependency-batch context.

This proves bounded request reduction and price parity, not fee savings on an
unverified Alchemy account. The helper deliberately does not introduce a streamed
pricing cache or financial writer. See [BATCHED_PRICING.md](BATCHED_PRICING.md)
and [batch receipt](../evidence/free-data-20261027/batch-live-2026-10-27T01-34-41.927Z.json).

## Failure behavior and unresolved integration work

Focused offline tests cover rate/quota refusal, bounded physical requests,
stale/null/malformed/oversized account data, missing block time, source slot/link
regression, duplicated/delayed/malformed/oversized stream messages, absent trade
fields, bounded selected queues/evidence pressure, restart/rewarm and supervisor
death. Unknown data remains unusable; no fictional mark, free fill or automatic
unlimited retry is created. Pool mutations are isolated; essential source gaps
invalidate windows. A stream restart warms fresh current context rather than
replaying an entire outage.

Prior disposable financial SIGKILL/WAL/consistent-restore drills are reused and
clearly labeled; they were not production crashes, real exposures or elapsed
acceptance windows. No financial history was reset for this assignment.

**Proposed admission policy, not implemented enforcement:** reserve each held
position's worst-case quote/reconciliation/exit capacity and retries first, plus
25% headroom; only admit candidates whose complete60–70second flow window and
verification fit remaining quota. Current60starts/minute client limit cannot
support three separate3-call quotes every5seconds (108calls/minute). A shared
three-pool batch every5seconds uses36calls/minute before other work. Every2seconds
would still use90calls/minute and exceed the current60/minute client limit. Cadence and
reserve must be tested/frozen before entries; this calculation is not permission
to reduce protection. Flow-budget loss should durably close entries/cancel or
quarantine unexpired entry actions before retirement, while held RPC continues.
The successful cancellation ordering is tested; actual upstream hard-stop and
storage-failure quarantine orchestration remain unfinished.

## Conditional cost/capacity projections

All projections below are **assumptions**, not measured monthly entitlement or
strategy quality. Candidate transaction rates are not inferred from broad PumpApi
message counts. A transaction may contain several swaps; duplicate matching
subscriptions can add deliveries and must be counted. Use one nonoverlapping
selected filter where supported. Rates include a25% safety reserve below.

| Scenario | Candidate flow assumption | Flow deliveries/day;30days | Held quote assumption | RPC CU/day;30days |
| --- | --- | --- | --- | --- |
| Light | Three candidates,1matching transaction/minute/pool,8hours/day, rotation included in active time | 1,800;54,000 Helius credits, before independent history/RPC | Up to three holdings together,3-call batch every5seconds for8hours | 432,000;12,960,000 Alchemy CU |
| Higher activity | Twelve candidates,10matching transactions/minute/pool,24hours/day | 216,000;6,480,000credits, before other usage | Up to three holdings together,3-call batch every2seconds for24hours | 3,240,000;97,200,000CU |

Alchemy official Solana costs: each `getMultipleAccounts`20CU, `getBlockTime`20CU,
so two account reads plus block time are **60CU/cycle**, not one20CU request.
`getTransaction`/`getSignaturesForAddress`40CU each; WS delivery0.0002CU/byte.
Add selected-stream bytes, subscriptions, reconciliation/history, retries,
metadata/rent reads and other account usage; no credit consumption is claimed
from public-RPC method counts. With an entirely unused documented1M Helius Free
allowance, the higher scenario exceeds it by at least5.48Mcredits/month; with a
documented30M Alchemy Free allowance, held pricing alone exceeds it by67.2MCU.
Neither allowance is verified for this account. A PAYG account does not inherit
the advertised Free tier merely because an app exists.

At the **short observed** PumpApi broad rate, continuous receipt would be~124.5GB
per24hours/~3.73TB per30days; the longer sample projects~108.4GB/day/~3.25TB/month,
before unmeasured wire overhead. A synthetic2× burst scenario would double those rates. These are conditional bandwidth/resource warnings,
not a forecast or a throughput guarantee. One stream's fee may be zero while its
network/CPU cost and maintenance burden are material. Do not deploy broad receipt
to EC2 on this evidence.

**API/data fees:** $0 for the credential-free/public tests; zero Alchemy/Helius
requests and no paid PumpPortal subscription. **Existing infrastructure:** EC2 and
Render continue within existing allocations; their actual economic allocations
remain unavailable. **Transfer/storage:** Cloud/EC2 egress entitlement is not
verified; retained evidence is bounded, and no whole-system-zero-cost claim is
made. **Maintenance:** small batched SDK helper is lower complexity than a new
streamed pricing engine; raw flow decoding and cross-provider verification still
require work regardless of price.

If Free capacity proves insufficient, first reduce **admitted candidate duty**
explicitly while preserving full windows and held protection; do not alter rules
or silently claim the original coverage. A paid alternative needs separate
approval. Helius documents additional credits at$5/million subject to eligible
plan/terms; the higher-flow assumption implies at least$27.40/month incremental
credits beyond a hypothetically untouched1M allowance, **excluding any required
plan and other calls**. PumpPortal remains a bounded reference option at0.01SOL
per10,000messages with a0.02SOL access floor, not an activated comparison. Actual
lowest total cost cannot be ranked until selected instruction rates, duplicates,
delivery bytes, current account terms and protection cadence are measured.

## Reproduction and review-only next steps

From the repository root on the review branch, Node24.19.0:

```sh
npm ci
npm run build
node --import tsx --test test/pumpapi-probe.test.ts test/batch-market.test.ts test/free-data-failures.test.ts test/source-version.test.ts
node --import tsx scripts/free-data-quote-replay.ts
```

The replay uses retained public evidence and no provider credential/network.
Read probe plan/budget receipts **before** any repeat live command:

```sh
node --import tsx scripts/pumpapi-probe.ts
```

No-argument usage makes no connection. The schema/capture commands reserve a
whole attempt before connecting; uncertain reservations persist. They must not
be repeated to exceed128MiB/30minutes, evade one-connection/IP limits or collect
another unreviewed broad sample. Public-RPC probe commands and limits are in
`BATCHED_PRICING.md`/`RPC_OBSERVATION.md`; never point them at the financial DB.
The later history audit command is
`node --use-env-proxy --import tsx scripts/free-data-history-audit.ts`; it refuses
to exceed6public reads/30seconds/6MB and uses the closed-window receipt. Repeating
it does not make late historical information available to earlier decisions.

The approved preflight is complete and refused the stream. Do not rerun the
completed grant; review the bounded selection-policy limitation first.
The earlier provider comparisons are retained for audit, not as access requests
or work prerequisites. Do not migrate production, change the strategy or remove
its blocker when a trial succeeds. Recheck supported pool identity/activity,
measure complete workload/freshness and report unobserved variants explicitly.

Final verification: TypeScript build/compile and275tests passed; independent
review corrected the unchanged-notification wording. Retained new evidence is
about0.45MB, well below32MiB. See `validation-final.json`. This review branch
also preserves previously undeployed RPC-market/observation/recovery work needed
by the replay; none is installed or accepted as an autonomous trader.

The record is bounded by real elapsed time, available samples and current access.
Gates A–D remain incomplete; economic edge is **UNPROVEN**.
