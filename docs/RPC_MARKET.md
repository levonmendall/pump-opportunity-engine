# Read-only RPC pricing and protection adapter

`RpcMarket` connects the existing pinned canonical PumpSwap pricing helpers to
`PaperTrader`'s quote/context interfaces. This is local integration work; the
installed observer is unchanged. It does not enable entries, load wallet/provider
keys, subscribe to paid flow, sign, simulate transactions or submit transactions.
Candidate flow verification and rule freezing remain separate entry prerequisites.

Construct one shared `ReadOnlyRpc(endpoint, fetch, {profile:'runtime'})` and pass
it into one adapter. Register at most15 supported candidate/held mint identities
with their verified migration slot and evidence. Registration alone is no pool
verification: each quote rereads and verifies the canonical pool through the
existing official SDK path. Never instantiate a new RPC client per quote to
reset the shared rate budget. The default integration profile retains its
100-request lifetime cap.

The explicit runtime profile allows at most60 started calls per rolling60seconds
and1 physical request by default (configurable up to3). It has no retry or waiting
queue. Rate/concurrency refusal means unavailable data, and the caller must yield
until its normal management cadence. RPC request bodies/responses are bounded;
requests use HTTPS, refuse redirects and retain the PAPER method allowlist.
Latency samples retain only the most recent128 operations. An aborted transport
that ignores cancellation retains its physical slot until it settles; repeated
calls cannot grow an uncanceled request backlog. The market adapter similarly
permits only one context or quote preparation and a bounded total deadline.

## Exact sizes, time and evidence

Buy proposals use `quotePool` and full-size sells use `quotePositionSell`; a held
exit never substitutes the corresponding hypothetical buy/sell size. No quote
cache crosses a modeled execution delay. Every proposal and first attempt must
request new state; execution still rejects quotes predating `executeAt`.

Each supported read uses three RPC calls: pool links, the coherent
pool/config/mint/vault account batch, then its block time. Subsequent reads retain
a nonregressing confirmed slot floor per mint. This is a bound on consistency,
not a guarantee that distinct pools or USD and SOL prices are atomic.

`quote.at` and `mark.at` are the original full-batch receive time, never validation
or publication time. They must remain at most2seconds old after every further
await and recorder operation. The helper separately requires the underlying block
time within30seconds and the adapter rejects future block timestamps. This does
not claim a2second commitment/chain-publication latency. Original requested,
received, validated, slot, commitment and block times remain in selected evidence.
An expired/stale/unsupported/missing pool produces unavailable output, not a
fresh zero. Earlier held marks that age out while later pools are read are omitted.

## Explicit simulated execution costs and refundable deposits

Supply base network fee, priority fee and assumption evidence explicitly. A sell
quote's SOL proceeds already include SDK pool deductions and exclude network
costs. The ledger charges configured gas once at the PAPER attempt. A liquidation
mark subtracts that same explicit gas once from exact-size proceeds. Proceeds
that cannot cover it are unavailable rather than a zero mark. Account deposits
stay in the ledger's separate locked assets; no refund is invented.

The adapter exposes `gasLamports`; the caller must use that identical amount in
`TraderOptions.costs.gasLamports`. This adapter cannot configure the ledger or
verify that another coordinator was given identical assumptions.

Buy quotes additionally require an explicit, recent simulated account-inventory
plan identifying whether both base/quote ATAs already exist. Unknown means no
buy quote. For missing accounts, current RPC rent is requested for the verified
account byte requirements (165 legacy, currently170 supported Token-2022 ATA),
coalescing identical byte sizes within that proposal. The sum must exactly equal
the configured `entryDepositLamports` and the caller must reserve that same amount
in the trader. Unknown rent or a heterogeneous fixed-deposit mismatch blocks
entries. The current trader has one fixed deposit assumption, so heterogeneous
requirements require a later explicit per-order-cost integration or a matching
restricted account plan; the adapter never substitutes a fixed165-byte rent.
The plan describes PAPER inventory, not an unevidenced real wallet ATA.

## Held positions when paid flow is off

`context(positions, signal)` reads at most3 actual held quantities first. It uses
no flow feature. Supported RPC exits and SOL marks therefore remain possible
while paid flow is disabled or disconnected. A separately supplied synchronous
USD snapshot is accepted only with positive value, source and age at most10seconds;
it makes no provider request. Missing USD stays null and does not erase a supported
SOL exit. Missing marks continue to block equity-based new risk in the ledger.

The outer runtime must schedule position management and yield on rate exhaustion;
this adapter provides no supervisor, scheduler or acceptance clock. Nine pool RPC
calls for three positions plus optional rent are already a material share of the
60/minute ceiling. Tested bounds are not proof of sustained public-RPC service
quality, complete pool coverage or deployed readiness. The new adapter remains
disconnected from production until root integration, field/rule/cost verification,
and applicable gates pass.

Replay tests use retained real pool bytes with explicitly synthetic availability
times and no account or forward-performance contamination. Current public-RPC
quote-only evidence, if present, records no PAPER fill or natural trade.
