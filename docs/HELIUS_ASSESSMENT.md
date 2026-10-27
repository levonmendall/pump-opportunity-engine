# Helius Parsed Streams assessment — 2026-10-27

**Documentation and access assessment only. No Helius connection, subscription,
credential use, charge, latency test or provider replacement occurred.** The
managed Cloud metadata reports current observations, enforced networking and no
configured secrets, runtime variables or outbound identities. No POE Helius
credential binding is listed in this metadata; it does not establish whether
the owner has an account elsewhere. No secret files or legacy provider budgets were
searched or reused. See `evidence/helius-access-assessment.json`.

The owner subsequently identified existing Alchemy/Helius keys in previous GitHub
projects. A bounded separate lookup found Alchemy configuration names and a
historical HELIUS_API_KEY reference in solana-roi-convergence. Actual repository/
environment secret presence remains unknown because secret-name metadata returns
403 Resource not accessible by integration. See PROVIDER_BINDINGS.md; no new key
or provider account is requested, and no key/value or shared credits were used.

## Current interface and publication conflicts

The current [overview](https://www.helius.dev/docs/parsed-streams) describes
general availability on **all plans, including Free**, using
`wss://beta.helius-rpc.com/`. Authentication accepts an `x-api-key` header or an
API-key query parameter; a future Node client should prefer the header and
suppress request URLs/headers in diagnostics. The stream delivers **confirmed**
transactions. The older [September launch post](https://www.helius.dev/blog/parsed-events-and-streams)
describes paid-only beta access and the old `fs-beta` subscription endpoint;
the program-catalog footer also still says paid-only. Current interface and
billing references take precedence for planning, while actual entitlement remains
unverified. No paid upgrade is justified by those older statements.

The JSON-RPC methods are `parsedTransactionSubscribe`,
`parsedTransactionUnsubscribe`, and notification `parsedTransactionNotification`.
The subscription accepts `[filter, {commitment: "confirmed", details: "full"}]`;
`processed` is unsupported. `full` retains the transaction and `matchedIndexes`;
`matched` returns matched instructions; `raw` omits decoding. Filters combine
fields with AND, lists with OR, and every account-role entry with AND.
`includeCpi: true` preserves router-invoked PumpSwap instructions;
`includeFailed: false` excludes failed transactions. At least `programs` or
`accounts.include` is required. These are documented behaviors, not observed
responses. [Method reference](https://www.helius.dev/docs/api-reference/parsed-streams/parsedtransactionsubscribe).

## PumpSwap filtering and field questions

The current [PumpSwap catalog](https://www.helius.dev/parsed-data/pump-fun/amm)
lists program `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`, instructions
`buy`, `buy_exact_quote_in`, `buy_v2`, `buy_exact_quote_in_v2`, `sell`, `sell_v2`,
and roles including `pool`, `user`, `base_mint`, `quote_mint`. A proposed bounded
filter would combine that program, the verified current buy/sell names, selected
verified pool addresses in `accounts.include`, and optionally the exact
`quote_mint` role for wrapped SOL. One selected-pool subscription avoids deliberate
overlap. Program membership alone proves neither Pump migration provenance nor a
canonical SOL-quoted pool; existing independent RPC checks remain necessary.

Catalog instruction arguments such as maximum input/minimum output are order
constraints, not executed quantities. Listing IDL `BuyEvent`/`SellEvent` schemas
does not prove that those events appear in a live stream. The proposed adapter
must verify actual per-instruction amounts, user role, fees and token behavior
against the same transactions on RPC before normalizing flow. No values may be
invented for unsupported or undecoded instructions.

The [quickstart](https://www.helius.dev/docs/parsed-streams/quickstart) specifies
`instructionIndex` plus `innerInstructionIndex` for positions; array indexes and
signature alone are insufficient identity. `blockTime` is currently null.
`describeProgram` currently requires a separate `fs-beta.helius-rpc.com`
discovery connection; validate the returned program ID, cache the catalog result
and close that connection. Do not silently substitute the old host for streaming.

The shared [parsed response model](https://www.helius.dev/docs/parsed-events/parsed-response)
has nullable decoding and commonly string-encoded u64 arguments, while transfer
amount fields can be JSON numbers. Reject unsafe numeric precision. Venue swap
amounts exclude external deductions, including Token-2022 transfer fees; they
are not guaranteed wallet receipts. Integer amounts, instruction association and
current extensions require measured validation before strategy qualification.

## Limits, costs and recovery

The [quickstart limits](https://www.helius.dev/docs/parsed-streams/quickstart)
allow 25 subscriptions/connection; 10 client messages/second with burst 20;
64 KiB/client message; 10 programs, 50 instruction names, 100 included accounts
and 20 account roles/filter. Its outbound buffer is 2,048 notifications. The
[plan limits](https://www.helius.dev/docs/billing/rate-limits) allow 5/10/50/50
Parsed Streams connections for Free/Developer/Business/Professional, counted
across the project's keys. These are not the larger LaserStream WSS limits.

[Billing](https://www.helius.dev/docs/billing/credits) assigns **one credit per
delivered matching transaction**, not per decoded swap instruction or byte;
Parsed Events history costs 10 credits/request and ordinary RPC generally one.
One transaction can contain several trades. The
[plans table](https://www.helius.dev/docs/billing/plans) lists Free at $0 with
1 million monthly credits, shared with the project's other usage. Remaining
credits and actual access are unknown. If entirely unused and spent only on this
stream, that allocation mathematically permits at most 1 million deliveries;
it does not demonstrate a viable continuous experiment. At a hypothetical
constant rate `r`, stream demand alone is `86,400 × r` credits/day, plus RPC and
reconciliation. This is a projection formula, not a measured rate or daily quota.

[Additional credits](https://www.helius.dev/docs/billing/additional-credits)
cost $5/million. Paid plans can purchase more automatically; no autoscaling,
prepaid credits, subscription, card charge or legacy allocation is authorized
here. A verified available Free allocation could support a $0 bounded test;
it must not be assumed available or converted into a paid fallback.

[Recovery documentation](https://www.helius.dev/docs/parsed-streams/guides/handling-reconnects)
promises at-most-once delivery with no replay. Reconnect with bounded backoff and
restore every desired filter; old subscription IDs do not survive. Idle
connections can close after 10 minutes; slow consumers close with code 1008.
The server pings every 15 seconds. Persist processed positions/identities and
mark the interrupted interval unavailable. For a sparse filter, a change in
notification slot is not evidence of a gap, and two received slots do not prove
complete boundary-slot delivery. Use inclusive bounded overlap plus complete
identity deduplication when reconciling selected pools, or rewarm fresh windows.
Historical records become available only when retrieved; never backdate them
into an earlier trading decision.

## Comparison that would answer the POE question

| Path | Required evidence | Main limitation |
| --- | --- | --- |
| PumpPortal reference | Selected-token raw frames, billable messages and independently verified trades | Its FAQ documents processed commitment; provisional observations need subsequent checks. |
| RPC polling/account WS | Same pools' current account context and exact-size quotes; request/byte/lag cost | State changes cannot reconstruct every buyer or gross buy/sell flow. |
| RPC logs/signatures plus transactions | Selected-pool event decode, complete instruction identities, confirmed outcomes and bounded history checks | More decoding and RPC work; standard log mentions filters accept one address. |
| Helius Parsed Streams | Same selected pools' matched decoded instructions at confirmed commitment; actual credits and quality | No replay; catalog/amount completeness and entitlement remain untested. |

References: [PumpPortal FAQ](https://pumpportal.fun/FAQ/),
[PumpPortal data pricing](https://pumpportal.fun/data-api/real-time/),
[Solana account subscriptions](https://solana.com/docs/rpc/websocket/accountsubscribe),
[log subscriptions](https://solana.com/docs/rpc/websocket/logssubscribe),
[address signatures](https://solana.com/docs/rpc/http/getsignaturesforaddress),
[transaction retrieval](https://solana.com/docs/rpc/http/gettransaction).

Predeclare a small selected-token set, supported-pool criteria and overlapping
UTC start/end on the same EC2 host. Reserve held-position monitoring first and
keep the shortlist bounded at 12. Start with full payloads to validate the
contract. A short run must preserve at least 60 uninterrupted seconds per selected
token; if event/credit headroom cannot fund that interval, refuse admission and
report the limitation. Do not repeatedly disconnect or shrink coverage while
calling the observation continuous. This assessment authorizes no run or credits.

For each independently matched instruction/event, record signature, program,
pool/mint, top-level and inner/log position where actually available, slot,
commitment and corrections, receive wall/monotonic times and useful feature
completion. Compare paired arrival differences p50/p95/p99, missing/ambiguous
matches, provisional-to-confirmed outcomes, decoding/amount/wallet disagreement,
duplicates and reconnect losses. A raw processed-versus-confirmed arrival
difference includes commitment delay; report it separately from same-commitment
delivery. Do not use event counts, null block times or unmatched populations as
latency proxies. Multi-swap transactions require instruction-level matching;
unresolvable PumpPortal identities must remain ambiguous.

Also measure delivered/billed units before local discard, bytes, actual credit
deltas, RPC calls, processing backlog, completed features, CPU/RSS, interruption
time and cost per usable observation minute. Use a bounded independent on-chain
sample to check each path's selected-scope coverage; neither feed is ground truth.
Only then compare cost/coverage/latency and make a bounded provider decision.

## Exact remaining dependency

No POE-authorized Helius key/project binding or remaining no-charge allocation
was present in the current Cloud metadata. To perform the Helius arm, attach the
existing **POE-authorized** project key through a protected runtime secret/file
binding, and identify its nonsecret project/plan, remaining credits, connection
headroom and autoscaling-off state. The owner must allocate a bounded credit
ceiling to this experiment; none is assumed from PumpPortal's SOL budget.
Do not send the credential in chat or GitHub. If no such existing allocation is
available, Helius remains blocked; continue public RPC, free PumpPortal migrations and the credential-free PumpApi
arm. Paid PumpPortal trade subscriptions are excluded from the current assignment. No paid plan or new account is requested by default.

Update 2026-10-27: authorized presence-only jobs checked specific existing
repository/environment binding names without exporting values or making provider
requests. No usable Helius binding was located in those scopes; this is not an
exhaustive account inventory. Remaining Free credits are unverified, so this
assignment permits zero Helius data credits until access/eligibility are proved.
