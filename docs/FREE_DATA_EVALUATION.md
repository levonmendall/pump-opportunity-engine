# POE free-data evaluation — offline design decision

**Later focused evaluation:** see [ADAPTIVE_MONITORING_EVALUATION.md](ADAPTIVE_MONITORING_EVALUATION.md).
Its single bounded public-RPC component proposal supersedes the older proposed
next-measurement sequence below. Both are proposals, not active grants; counters
and the completed429 remain unchanged. No duplicated screening layer is deployed.

2026-10-27 UTC · review branch `poe-free-data-evaluation-20261027` · no deployment

1. **Current configuration: unsuitable for the combined workload at 60 RPC starts/minute.** Two pricing calls every two seconds consume all 60 before required transaction enrichment, verification, recovery or headroom. This arithmetic rejects that configuration, not every possible free configuration.
2. **Enrichment remains an operating dependency.** The currently evidenced PumpApi contract supplies lookup hints, not complete verified trades. Each new distinct selected transaction requires a confirmed `getTransaction`; one read can supply several genuine swaps. Sampling cannot supply absent fields or missed events.
3. **A conditional narrower design now has an offline implementation:** one fresh eight-account pricing batch including the Solana Clock sysvar. It preserves the common account decoder and SDK math, and labels bank-clock provenance explicitly. Its first quote uses two reads; steady quotes use one. Live Clock behavior, endpoint response tails and continuous protection remain unverified.
4. **Feasible proposed envelope:** one held pool plus one candidate; 54 working starts/minute plus six reserved starts, unchanged two-second research pricing cadence, and explicit arrival/deadline constraints below. This is a capacity proposal, not production readiness or a change to strategy parameters/position limits.
5. **Smallest next measurement:** a proposed field-only capture of at most 30 seconds/four selected signatures, with 20 RPC requests reserved. It answers what actual feed payloads supply before asking for complete production readiness. A separate RPC-only protection component follows; the final combined workload must still pass. **Nothing was run or newly authorized by this offline review.**

No Alchemy or Helius investigation, provider purchase, wallet operation, network
retry, throttle reset, observer restart or Render change occurred. No new budget
or owner action is requested in this report. PAPER entries and live trading remain
disabled; no acceptance clock starts. The original account/inception and all
financial history remain authoritative and untouched.

## Actual evidence and preserved allowances

The two original PumpApi connections received 106,994,938 socket bytes over
84.526 seconds open, reserving 112 MiB/100 seconds. Their selected pools had no
matched events. The first active preflight used six RPC requests/81,729 bytes,
then refused a history page truncated into one chain second. The continuation
used 14 more requests/190,905 bytes in a 1.342-second selection pass, skipped two
saturated histories and ended on HTTP 429. **No new PumpApi capture opened.**

The continuation independently decoded two direct canonical-SOL sells, with exact
base units 45,355,765,675 and 17,862,432, gross SOL 75,552,859 and 315,762 lamports,
and user proceeds 74,684,000 and 312,919 lamports. Scoped Token2022/WSOL transfers,
actual trader roles, fee arithmetic and instruction/event identities agree. An
earlier real v1 CPI `sell_v2` also establishes that fee payer can differ from
trader. No matched PumpApi Buy/routed/multiple-swap case exists. These transactions
are adapter evidence, not natural PAPER trades or complete current pool support.

| Durable item | Current value, unchanged in this review |
| --- | --- |
| Additional RPC requests | 20 / 240; **220 remain** |
| Additional RPC response bytes | 272,634 / 67,108,864; **66,836,230 remain** |
| Provider block / uncertain responses | `RPC_HTTP_429`; no pending reservations |
| PumpApi reserved bytes/time | 117,440,512 bytes / 100,000 ms; two original captures |
| Sole new capture | Unused; no new reservation appended |
| Assignment ceilings | 256 MiB cumulative PumpApi, five minutes reserved time, 32 MiB retained evidence |

The sticky refusal and completed grants remain intact. Unused allowance is not
permission to retry. API/data fees for the earlier credential-free reads were
$0 under the retained public documentation; existing infrastructure and transfer
entitlement remain separate/unverified. This review made no market-data/RPC or production network requests. Review-branch publication is development work only.

Receipts: `active-approved-*`, `active-continuation-*`, `pumpapi-budget.json` and
`active-approved-rpc-budget.json` under `evidence/free-data-20261027/`. The original
raw records are preserved. `offline-design-review.json` records before/after
hash agreement, offline validation and the new source versions.

## Scheduling defects corrected

The previous client enforced rolling ceilings but did not pace starts: it allowed
14 requests to start within about 1.29 seconds. That was below its research ceiling
and still caused an endpoint refusal. A local ceiling is not endpoint entitlement.

`SelectionPacedRpc` now adds an actual **1,000 ms cooldown after observed physical
settlement**, also enforcing wall/monotonic start spacing and stricter delays
reported by the shared source. One instance sits inside all selection/support
phase wrappers. Its durable state and standard flock prevent a second owner or
restart from creating an independent burst gate. It persists a start before
transport, without maintaining another provider counterbook. There is no request
retry, endpoint selection or network-identity rotation.

Cancellation during a pacing wait starts and charges no RPC request. Cancellation
of a request does not release a physical slot until transport actually settles.
A stalled slot blocks further starts. If cancellation returns before transport
settles, the next observed settlement starts a full fresh cooldown; elapsed
time since the original start cannot bypass it. HTTP 429 and provider overload remain
sticky across restart; neither a cooldown nor a pool expiry clears them. Tests
use injected transports/clocks and temporary files, not the actual counterbook.
The old completed CLI grants remain closed; wiring the guards does not reopen them.

The earlier no-revisit set existed only within one pass and therefore revisited
the prior rejected `4dg…` pool. `SelectionRejections` now persists exact pool/mint,
reason, observation time, evidence reference and release condition across attempts.
Three historical refusals for two pools were seeded offline using their original
timestamps, without changing the receipts or extending expiry from today's clock.

| Rejection class | Release condition |
| --- | --- |
| Saturated/capacity-unknown or projected demand too high | 24-hour cooldown, then full fresh activity/support checks |
| Insufficient/short activity baseline | 10-minute cooldown, then fresh checks |
| Stale/unknown source time, missing state or changed links | One-minute cooldown, then fresh validation |
| Unsupported structural/token/identity behavior | Reviewed support-policy version change, then fresh validation |
| Global throttle, pacing/storage/budget error or cancellation | Stop the pass; never poison a pool record or clear the global block |

An expired guard permits examination, never automatic eligibility. A newer short
cooldown cannot mask an older active guard. The store is bounded to 128 records/
64 KiB; corruption, write failure or exhaustion fails closed without evicting an
active guard. Prior rejection skips are recorded before new history/support reads.
Discovering a pool inside a transaction still costs that transaction read.

Offline composition tests cover pacing of every selection and support read,
shared accounting, restart rejection skips, cancellation, physical slot ownership,
throttle persistence and global-versus-pool failure classification. This corrects
software scheduling; it does not establish a rate that public RPC will sustain.

## Required fields and permanent data dependencies

The current development rule uses six closed ten-second bins over 60 seconds
(up to 70 seconds to warm): net buying, four positive bins, five buyer addresses,
concentration and trade-price structure, plus separate age/liquidity/eligibility
checks. Thresholds were not changed. The primary gross-curve versus user-SOL
amount convention remains unfrozen; research retains both explicitly.

The retained feed captures contain a broad schema inventory and no selected raw
trade payload matched to on-chain evidence. Field presence/type is not validated
meaning, precision, completeness or commitment.

| Required input | PumpApi evidence now | Current source of usable information |
| --- | --- | --- |
| Pool/mint/signature and local receive time | Exact-scope/syntactically valid signature hints; POE can timestamp arrival | Useful lookup hints only; execution/canonical/migration facts need verification |
| Executed direction and constituent swaps | `action` and `breakdown.action` exist; aggregate meaning unverified | Actual compiled swap plus matching event from confirmed transaction |
| Integer token/SOL amounts and fees | UI-number quantities/decimals occur; selected precision and fee convention unverified | Integer event bytes and scoped transfer cross-checks |
| Trader per swap | `txSigner`, `breakdown.trader` and `tradersInvolved` occur; role correspondence unverified | Matching swap user account and event user; payer is not assumed to be trader |
| Complete event identity | No verified chain instruction/event identity contract | Signature, program, outer instruction, swap-inner position and event-CPI position |
| Slot, commitment, corrections and success | `block`/`timestamp` and repeated signatures do not establish these contracts | Confirmed successful read at its actual completion time; bounded later rechecks |
| Coverage, gaps and recovery | An open broad socket is insufficient; replay/correction guarantees unverified | Bounded independent history/instruction audit; invalidate gaps and warm fresh windows |
| Actual-size net liquidation | Generic prices/reserve claims are insufficient | Fresh coherent supported pool/config/fee/mint/vault state through existing integer SDK math |

Raw UTF-8 retention preserves the exact serialized numeric lexeme; it cannot
recover precision already rounded upstream. Multiplying a parsed float by decimals
or adding a lossless JSON parser alone does not establish executed integer units.
A breakdown index is not an invented on-chain event index. Different wallets do
not prove independent people. A selected field sample must resolve these meanings
against actual instructions, including missing/unsupported cases.

**Validation-only work** includes establishing adapter semantics across supported
shapes and offline decoder regressions. **Recurring work** currently includes one
confirmed transaction fetch for every new distinct selected signature, including
null/failed/nontrade attempts that require classification. Duplicate hints can
share a fetch; several swaps in one transaction must all be emitted. Sampled
verification cannot make unenriched selected transactions complete. Independent
history/finality checks, support/admission and account/rent checks are additional
work, not aliases for enrichment.

Let `S` be unique selected signatures across the union of tracked pools, not raw
frames or swap-event count. Operating cost is at least:

`pricing + S + integrity + discovery/support/execution + recovery + headroom`.

Twelve pools each reaching five buyer addresses imply at least 60 buyer-pool
occurrences, not necessarily 60 signatures: one transaction can contain multiple
swaps/users/pools. Under separate-signature arrivals that alone costs 60 reads;
transaction sharing must be measured rather than assumed as a saving.

Current held exits use actual-size price, entry cost and elapsed time (15% stop,
30% profit, 15-minute maximum), with no flow-dependent exit. No flow rule was
removed. Held tokens therefore do not automatically need perpetual trade streams.
A future flow-dependent exit would need its complete required flow separately.

## Correctness-preserving pricing investigation

The existing link/time cache still needs one full dependency read and an exact
slot-block-time read when slots change. Same-slot time hits cannot be budgeted as
guaranteed capacity. Reusing an older block timestamp as a later slot's timestamp
is unsupported: slot ordering alone does not prove strict monotonicity of RPC
estimated block times. Partial account notifications at mixed slots are not a
coherent quote, and cannot reconstruct buyer flow.

The new **research-only** `ResearchClockPositionPricer` requests all seven pricing
dependencies plus canonical Clock in one confirmed batch. It validates Clock's
owner, exact 40-byte layout, matching batch slot, integer Unix time, no future
time and at most 30-second source age. It retains original receive times and
rejects regressing contexts. Clock is explicitly `confirmed-bank-clock` evidence
with `marketClockUnixSeconds`; no `marketBlockTime` or fake `getBlockTime` result.

Every quote still uses the same PDA/owner/mint/extensions/vault/config/fee/effective
reserve validations and exact SDK sell arithmetic. Only verified links are reused;
reserves/fees are always freshly decoded together. Changed links, missing/invalid
accounts, stale Clock, cancellation and stale-at-use output invalidate the cache;
no automatic retry occurs. Highest verified slot survives invalidation.

Pure account decoding was extracted from `pool.ts`; existing production helpers
retain their actual block-time check, fields and behavior. The new adapter is not
wired into `RpcMarket`, execution, reporting or the installed runtime. Offline
retained-byte tests with explicitly synthetic Clock accounts demonstrate exact
sell/fee parity, including changed reserves and fee tiers, and failure handling.
They do not prove current public-RPC Clock behavior or protection performance.
The expected Clock layout/equality invariant must also be checked against actual
account bytes and the current primary interface in a future authorized component test.

Cold quote: two reads. Steady quote: one complete eight-account read. A one-to-three
position union batch may eventually share dependencies, but the implemented
Clock adapter and proposed capacity envelope cover **one held pool only**. Targeted
account notifications may later trigger/coalesce a full batch; no streamed pricing
engine or skipped freshness checks are introduced here.

## Feasible proposed workload and its limits

| Work, one candidate plus one held pool | Starts per rolling minute |
| --- | ---: |
| Full-size held pricing, unchanged two-second research start cadence | 30 |
| Every selected distinct transaction enriched | 12 |
| Migration/support, cold links, candidate execution/account/rent checks | 6 |
| Independent bounded history/finality verification | 2 |
| Recovery/relink reserve | 4 |
| Unspent safety headroom | 6 |
| **Total** | **60** |

Working allocations total 54; reserves are not available for speculative admissions.
With the same allocations, the old two-call pricing design would need
60 +12 +6 +2 +4 +6 =90 starts/minute: a 30-start/minute shortfall against 60.
These are declared scenario allocations, not measured continuous demand.
At 24 hours/day, 54 working starts/minute projects to77,760/day and2,332,800
per30days; the full60-start reservation projects to86,400/day and2,592,000
per30days. None of those sustained public-endpoint rates is verified.
Initial support/account checks can span several scheduled slots while admissions
stay closed. If a cold path requires more calls, it consumes its class allocation
or postpones admission; no helper is priced as one call when it makes several.
The migration WebSocket and external USD source are separate traffic/cost inputs,
not hidden Solana RPC calls. No production limit, coverage, risk cap or strategy
threshold has been changed. This is an explicitly narrower proposal, not a claim
that the intended shortlist or three-held-position workload already fits.

A feasible timing envelope would reserve even-second starts for protection and
unused odd-second starts for lower-priority work, with at most one physical read
and completion within 800 ms (200 ms guard). Flow outranks background work in
those slots. This preserves the chosen two-second measurement cadence; endpoint
latency, cancellation settlement and shared-egress throttling have **not** proved
that envelope. An eight-second enrichment timeout cannot be admitted across an
imminent protection deadline merely because a queue labels protection high priority.

With the current one-second research enrichment delay, one selected hint arriving
just after a service phase can take almost 3.8 seconds to become available. A
conservative proposed workload has at most one pending hint, at least five seconds
between selected signatures and at most 12/minute. Future market arrivals are not
controllable: exceeding this envelope invalidates the candidate window and closes
new admissions; required trades cannot be discarded to report a complete window.
Held protection retains priority and its reserved capacity.

A two-hint burst is not guaranteed to fit. If both arrive at t=0.001 s, eligibility
begins at t=1.001 s, missing odd slot t=1. Reads at t=3 and t=5 finish by t=3.8 and
t=5.8; the second is 5.799 seconds old, beyond the research five-second usefulness
bound. Average rate alone does not solve this. That research bound is separate
from order expiry and from an unfrozen maximum acceptable exit-evaluation delay.

Quote age **at use** remains two seconds; source age remains 30 seconds. Neither
specifies the maximum gap between completed exit evaluations. That requirement
must be frozen on protection grounds and tested; it must not be loosened to fit
this budget. Endpoint unavailability means unavailable protection, not fictional
marks, fills or an automatic exit. Under a failed Clock witness the existing
two-call path has no budget for active flow/headroom; it is not silently used as
a fully provisioned fallback.

## Smallest informative live measurement — proposal only

[offline-next-measurement.json](../evidence/free-data-20261027/offline-next-measurement.json)
contains exact suballocations against the preserved counters. Neither component
has been run. The completed throttle refusal is not cleared by this proposal.

**First, field/identity validation:** one unused PumpApi connection, at most
30 seconds/four selected signatures, five-second shutdown reserve; proposed new
reservation 48 MiB/35 seconds, socket stop 47 MiB/application stop 46 MiB. This
would total 160 MiB/135 seconds reserved with prior captures, within existing
ceilings. Selection/basic scope gets eight RPC reads, enrichment four, independent
history/finalization six, shutdown headroom two: **20 requests/16 MiB responses**,
with a 4 MiB evidence cap. The question is which actual selected fields match
executed constituent trades and which remain RPC-dependent.

Require a current successful canonical-SOL swap and known exact scope/decimals,
and respect persisted rejected-pool guards. This field-only test need not first
prove a complete strategy window, production pricing or sustained shortlist
capacity. Retain every selected raw payload and actual information-availability
time. Stop the stream if the selected allocation is overrun and label affected
coverage unusable/censored; never omit arrivals to manufacture completeness.
Bounded audit reports only its actual instruction denominator. Missing Buy,
routed, multiple-swap or commitment/correction observations remain unverified.
A 30-second sample cannot establish the required 60-second candidate window.
The earlier80-second broad capture received99,653,847socketbytes (about1.25MB/s).
If sustained, that would be about107.6GB/day or3.23TB/30days before filtering;
this is a conditional traffic projection, not measured continuous usage. Discarding
irrelevant frames saves retention, not incoming network/decoding work. EC2
compatibility and transfer allocation remain unverified.

**Separately, changing-price protection:** public RPC only, hypothetical quantity,
one pool, at most 60 seconds, unchanged two-second research pricing starts. Reserve
31 pricing reads (two cold +29 steady), two actual same-slot block-time reference
reads, five selection reads and two shutdown-headroom reads: **40 requests/16 MiB
responses**, 4 MiB evidence. Decode identical captured bytes with the established
helper for parity; count every actual network call. Measure original quote age,
response tails, completed evaluation gaps, stale/unavailable periods and real
price changes. If prices do not change or no exit threshold is crossed, say which
response observation is absent; replay remains separate.

Both proposed components total 60 requests/32 MiB, leaving 160 requests and
33,281,798 response bytes from the actual remainder, without refunds or resets.
Byte caps include per-start response headroom and are stop ceilings, not a promise
that every possible response fits. Retained evidence stays within 32 MiB.
Spending the sole unused stream on a short field component does **not** authorize
a second combined capture. The eventual combined flow/pricing/integrity/failure
workload still needs its own authorized measurement and must pass before use.
Component success never enables entries or starts acceptance clocks.

## Operational boundary and decision

This offline review corrected selection scheduling and persistent rejection
handling, made the recurring enrichment dependency explicit, and implemented a
small alternative pricing path for evaluation. **The present two-call configuration
cannot serve the stated combined workload at 60/minute.** The one-call alternative
has a feasible, narrow, conditional budget; it has not established endpoint
eligibility, response bounds, complete trade flow or acceptable protection.
There is no verified continuous free production configuration yet.

The last read-only production check remains snapshot 522 at 03:16 UTC: original
account/inception/release, reconciled true, facts 24.283 seconds old at observation,
zero fills/positions, entries disabled. This task made no new network or host-health
check and claims no additional unattended interval. Observer, financial authority,
public viewer and authenticated publishing were not modified. No owner-only
action is needed to complete this offline work; no new live test is requested here.

Build, compile, strict research-runner type checks and324offline regressions pass.
They validate software behavior; they do not complete live-data acceptance.
