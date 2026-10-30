# Observation design and bounded comparison

Current priority: measure the existing Alchemy service before considering any
paid Helius plan. MM_SOLANA_READ_RPC_URL is now confirmed in The-Meme-Machine's
repository scope and its public Alchemy host validated without a provider call;
no replacement credential is needed. Quota/overage verification remains pending.
Alchemy's targeted logs/filtered block path is assessed in ALCHEMY_ASSESSMENT.md;
actual complete flow, response and lower total cost are not proved by docs.

Status: investigation/development only. No continuous paid subscription is
committed, no provider changed, no live execution, no acceptance clock. The
healthy installed C2 observer/account/inception remain untouched.

## Information requirements of the unchanged provisional rule

| Use | Required information | Suitable source; current limit |
|---|---|---|
| Discovery | Actual migration, mint/signature and receipt context | Keep free PumpPortal migrations; verify canonical pool by RPC |
| Entry qualification | Receive-time buy/sell amounts, wallet participation/concentration, activity persistence, trade-price structure, complete event identity and uninterrupted closed60s window | Selected-token trade feed needed; pool reserve changes alone cannot supply these fields |
| Entry execution | Supported current pool, exact order-size impact/fees, current USD and gas/rent/account model | Tested read-only RPC/SDK quote path; unknown costs/state block entry |
| Holding | Actual units, conservative net SOL liquidation, entry cost, elapsed time; USD for portfolio risk | Full-size RPC quotes plus ledger/clock; current stop15%, profit30%, maxhold15min use no flow feature |
| Flow-dependent exit | Whatever flow inputs that specific version requires | A future such rule must retain a verified trade feed; RPC polling is not an equivalent replacement |

No predictive feature, threshold, lookback, delay, expiry or exit rule has been
removed to lower cost. Current strategy remains UNFROZEN. Different wallets are
not independent buyers. RPC pool changes include swaps, liquidity changes and
other activity; neither reserve deltas nor notification counts prove trades.

Current holdings require no continuous paid flow after a tested RPC handoff.
src/observation.ts gives held RPC management priority and excludes held/traded
mints from candidate streams. It can retain an already-existing held stream
only during an explicit initial handoff, at most5s from durable fill time; restart
cannot renew that deadline. This is a transition bound, not a holding-time change.
An unavailable RPC mark stays critical/unknown and blocks new admissions; a paid
stream does not cure it. No new held subscription is created as a fake fallback.

Budget loss requires short durable entry pause/cancellation before retirement;
unresolved actions must be quarantined, never discarded. Failed financial writes
cannot extend paid traffic beyond authorization. The pure plan exposes those
requirements; successful cancellation ordering is tested with the real disposable
ledger. Storage-failure/quarantine plus actual upstream hard-stop wiring remains
production work. PaperTrader.deactivateFlow invalidates only a selected window,
refuses an unexpired pending BUY and preserves held RPC management; it does not
send an unsubscribe or pretend upstream billing has stopped.

## Three paths to compare

| Path | Can qualify unchanged entry rule? | Can price/protect held size? | Cost/quality still to verify |
|---|---|---|---|
| PumpPortal selected trades | Reference candidate feed, subject to actual field/identity proof | Trades are not a full-size liquidation quote; use RPC | Processed/provisional arrivals, duplicates/gaps, billed messages, actual charges |
| RPC batched reads | No: no buyer identity or complete trade sequence | Yes for supported state via existing SDK, if freshness/capacity/failure tests pass | HTTP calls/bytes, state age, coherent quotes, throttling and protection response |
| RPC account subscriptions + reconciliation | No: notifications are state changes, not parsed trades | Potential trigger for the same coherent RPC quote; do not combine mismatched partial accounts | Exact-account notifications, reconciliation overhead, reconnect gaps, quote delay and total traffic |
| Helius Parsed Streams | Possible after supported PumpSwap parsing/identity/quantity verification | Parsed transactions still need actual-size RPC pricing | Confirmed availability, transaction billing/credits, filters/coverage/entitlement; see HELIUS_ASSESSMENT.md |

The RPC market adapter is development code; no functioning installed protection
is replaced. It retains confirmed context, original batch receipt and block time,
rejects >2s-old quote receipts and >30s-old chain block context, subtracts explicit
simulated gas once for marks, and blocks buys with unknown rent/account plans.
These are distinct freshness facts, not a claim of2s chain-to-application latency.
One position read currently costs3RPC calls; three holdings cost9. Sustained
cadence at the shared60-starts/min cap remains to measure before enabling entries.

The2s quote-age bound applies when a decision/fill uses a quote; it does not by
itself prescribe continuous2s polling. A holding-check cadence and maximum
protection-response delay still need explicit freezing and load/failure tests.
The probe's continuous-fresh-cache fraction describes cache availability, not
an observed stop failure. It cannot select a cheaper cadence without a matched
response requirement and actual changing-state/trigger observations.

## Matched experiment; no assumed provider equivalence

Use one or at most two verified canonical SOL pools from the declared age/token
scope. Record the same tokens over the intersection of each source's actual
acknowledged, usable observation windows; retain startup/outage exclusions.
Keep one migration socket and selected filters, never broad blockchain ingestion.
The first funded reference probe stays at120s maximum, one selected token,
1000potential billed events plus100headroom. A ceiling hit before a complete
60s closed window is a measured failure, not permission to stitch reconnects.

Use the existing Recorder format for observations, state/quotes, decisions and
corrections. Retain slot/context and original synchronized receive time, with
monotonic durations. Match underlying trades using verified signature plus event/
instruction identity, not signature alone or delivery counts. A transaction may
contain multiple swaps; extract relevant canonical-pool actions without double
counting. If a provider lacks an adequate identity/quantity contract, report that
limitation instead of inventing indices or fetching every transaction.

PumpPortal's processed observations are provisional; Helius Parsed Streams are
confirmed. Preserve each source's original availability and later corrections.
Compare same-event receipt differences with commitment labels; they include
confirmation delay and are not pure transport latency. Bounded independent
confirmed RPC samples establish only sampled completeness and confirmation
availability bounds. A first successful poll is not the precise confirmation
instant. Missing events are missing/censored, never removed from the denominator.

Report matched underlying-event coverage, duplicates/corrections/gaps, receipt
distributions, notification-to-coherent-quote delay, original quote age and slot,
and actual size-specific quote differences. Replay the same rule/config and
decision times using information available to each source at that time. A
pool-only path lacking required flow reports unavailable qualification, not an
equivalent strategy with those features removed. Do not let later confirmations
or future prices enter earlier decisions.

For exits, use the same declared hypothetical units/cost/time and existing stop/
profit/time rules over overlapping real observations. Measure trigger availability
to usable actual-size quote and earliest modeled attempt. No observed trigger
means exit-response evidence is unavailable; synthetic fault tests remain labeled.
Never replace working protection until freshness, reconnect, outage and response
requirements pass at the intended position load.

Count actual delivered feed billing units separately from parsed swaps, RPC starts,
account notifications, reconciliation calls/bytes and compute/egress. Convert costs
using timestamped USD; distinguish documented estimates, measured usage, billed
charges and allocated hosting. Public-RPC/no-plan-increase is not proof that
operating costs are zero. Include funding network fee and provider reserve as
fee versus capital respectively; do not charge principal as an expense.

## Decision boundary

The lowest-change candidate is selective paid flow for entry qualification plus
the same verified RPC path for held pricing/protection; current holding rules do
not require paid flow throughout the holding period. Polling versus change-driven
RPC and a Helius replacement remain comparisons, not selected winners.
No measured three-way savings or entry/exit equivalence is claimed yet. PumpPortal
reference access awaits durable recovery/explicit funding; Helius requires an
available authorized binding/allocation. Bounded public RPC paired evidence can
proceed independently. Expand only after information quality, sustainable rates,
charges and protective response justify it within unchanged spending limits.

Actual public-RPC paired evidence is in RPC_OBSERVATION.md. The tested slow
cadences failed continuous freshness and observed no relevant state change;
they cannot replace protection or establish a cost winner. The owner has pointed
to existing GitHub Alchemy/Helius keys; configuration references were found but
secret metadata is403-blocked (PROVIDER_BINDINGS.md). Existing-key location and
quota confirmation, rather than creating another provider/key by default, is the
next access step.

If a verified unused Free Helius allocation is available, a concrete first arm
would be at most120s, one selected pool/subscription and1100delivered-transaction
credits including100headroom, $0/day and$0total, with overage/automatic purchase
disabled and no paid fallback. Independent RPC sampling remains separately
bounded on the existing public endpoint. This is a proposed allocation, not
authority to consume another project's quota. Each source's billing units remain
separate;1100Helius transactions are not assumed equivalent to1100PumpPortal
trade/control messages or1100underlying swaps.

For Alchemy first: propose one pool for at most120s,40bounded HTTP reads and one
filtered subscription,1000notifications/5MB locally received,10000CU plus1000CU
in-flight reserve from verified unused no-charge allocation, $0/day/$0total.
At documented rates5MB of Solana WS is about1000CU and40calls at40CU each1600CU,
before other method/control/recovery costs. These are ceilings/estimates, not
actual billing proof or permission to exceed shared allocation. Stop and compare
actual usage before expansion; no paid fallback or gRPC service.
