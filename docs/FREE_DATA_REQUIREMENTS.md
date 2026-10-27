# Zero incremental data cost requirements — 2026-10-27

This is the requirements/eligibility record for branch
`poe-free-data-evaluation-20261027`. It is not the final evaluation or a production
release. Public primary documents were retrieved on 2026-10-27; authenticated
account/quota facts and actual probe results must be recorded separately.
No provider data connection, credential read, account change or charge was made
by this documentation task.

## Boundaries and stop limits

The experiment must add **$0** in data/RPC/provider charges. Do not create an
account, key, trial, plan, permission grant, paid subscription, infrastructure,
funding transfer or automatic top-up. A previously found app key/URL does not
establish that its account is Free or has unused quota. Unknown eligibility means
**no data request**, not a paid fallback. Existing production PAPER state,
credentials, account/inception and financial history remain separate. Entries
and live trading stay disabled; no 24/72-hour acceptance clock begins here.

| Arm | Maximum permitted use after eligibility is proved | Current access state |
| --- | --- | --- |
| A: existing Helius Free candidate flow | `min(20,000, floor(0.02 × verified remaining free credits))` | Blocked: no usable key located in the authorized probed names; remaining Free credits unknown. |
| B: existing Alchemy for position/state reads | `min(250,000, floor(0.02 × verified remaining free CU))` | Blocked: `MM_SOLANA_READ_RPC_URL` binding/Alchemy host found, but plan and remaining quota unknown. |
| B fallback: Solana public RPC | Bounded read-only requests below current public/shared-IP limits | Credential-free public endpoint is a no-billed-account candidate; availability/freshness still require measurement. |
| C: PumpApi broad free stream | At most 128 MiB received in total and 30 minutes/provider; one connection/IP | Official docs establish credential-free, free stream access; useful contract and operational capacity unverified. |

Provider counters cover all experiment sessions/reconnects; they never reset on
reconnect or after a failed attempt. Apply the 30-minute provider duration bound.
Count every received message byte before parsing, selection, duplicate handling
or discard. State which transport/payload layers are measured; retain conservative
frame/in-flight headroom and close before the aggregate byte allowance is at
risk. Bound payloads, queues, CPU/memory and processing lag independently. Receiving
a broad feed and discarding most messages does not remove its resource cost.

All new evidence belongs in `evidence/free-data-20261027/`, capped at **32 MiB in
aggregate**. `provider-eligibility.json` is capped at 1 MiB. Reserve space before
capture; stop new collection if necessary instead of deleting completed evidence
or unrelated/new-project financial history. Keep raw selected samples and summaries
small. Do not download a broad market archive.

## PumpApi: exact free boundary and raw contract

[PumpApi FAQ](https://pumpapi.io/FAQ) says its Data Stream is free and needs no
account, signup or API key. Its separate [fee table](https://pumpapi.io/fees)
also lists the Data Stream as free. No paid trial, funding balance or billing
credential is needed for that documented stream. Trading and auxiliary operations
have separate fees and are outside the experiment. The
[terms](https://pumpapi.io/legal) do not supply an operational SLA or measured
data-accuracy guarantee.

The exact [documented stream](https://pumpapi.io/stream) is
`wss://stream.pumpapi.io/`. Connect with no authentication and send no trading,
wallet, action or subscription payload. It sends all supported venue events;
filtering is local. The FAQ specifies **one connection per IP**, so the lead must
coordinate the sole experiment connection across shared egress/NAT and agents.
Do not open another socket per token or an independent second probe.

Raw inspection fields include `signature`, `action`, `poolId`, `mint`, `quoteMint`,
`pool`, `poolCreatedBy`, `txSigner`, `tokenAmount`, `quoteAmount`, `block`,
`timestamp`, and `breakdown` entries containing `action`, `trader`, `tokenAmount`,
`quoteAmount`. PumpSwap examples use `pool: "pump-amm"`; `poolCreatedBy: "pump"`
is a provider provenance claim requiring independent verification. Samples use
decimal/UI quantities, not proven exact integer trade units.

A transaction can produce multiple same-signature events. Top-level same-pool
trade amounts can be net aggregates; `breakdown` contains the constituent trades.
Do not deduplicate a signature alone, treat `txSigner` as every buyer, or turn a
breakdown array index into an invented instruction identity. No complete
instruction/log identity, commitment/rollback contract or live resume guarantee
was established from these pages. Keep that contract **UNVERIFIED**. The separate
historical replay offering is not proof of automatic socket replay; it is not
needed for this bounded live test.

Provider timestamp, price and marketing latency/throughput claims are not local
availability or capacity measurements. Capture local receive wall/monotonic times,
measure useful completed work, and verify selected pools, quantities and outcomes
through eligible read-only RPC. Never round UI floats into fictional integer fills
or use observed price peaks as executable exits.

## Helius Free and Alchemy: documentation is not account eligibility

Current [Helius overview](https://www.helius.dev/docs/parsed-streams) and
[plans](https://www.helius.dev/docs/billing/plans) list Parsed Streams on Free,
confirmed-only, at one credit/delivered matching transaction. Free lists one
million shared monthly credits. Older paid-only beta descriptions conflict with
these current references. Neither description proves an existing key's plan,
remaining allowance or applicability to POE. With no usable existing binding and
verified remainder, A's executable budget is **zero**. Do not create an account,
request a paid plan or probe an unverified key to find out.

The [Alchemy Solana CU table](https://www.alchemy.com/docs/reference/compute-unit-costs)
prices Solana WS delivery at 0.0002 CU/byte, `getMultipleAccounts` at 20 CU/request,
and transaction/signature retrieval at 40 CU/request. The generic 0.04-CU/byte
figure is not the Solana row. A found, host-validated `MM_SOLANA_READ_RPC_URL`
proves neither Free status nor remaining shared allowance. An app key alone
cannot read account usage: the [Usage API](https://www.alchemy.com/docs/admin-api/usage/get-usage-summary)
requires separate authorized account-level authentication. No such existing
session is available here. Use only an already authorized current usage view or
session if available; do not add permissions or create an administrator key.
B's Alchemy budget therefore remains **zero** until eligibility and the 2% cap
can be established. Do not load another project's paid budget or enable gRPC.

Once a verified Free remainder exists, reserve the full planned work plus
headroom inside the applicable `min(...)` ceiling before admitting tokens.
Include stream delivery, RPC, history/reconciliation and other billable work;
quotas are not counts of candidate tokens. Held-position monitoring has priority.
If a full required observation window cannot fit, refuse admission and report
the limitation; do not shorten the rule or repeatedly reconnect to claim continuity.

## Solana public RPC: bounded fallback

The current [official cluster reference](https://solana.com/docs/references/clusters)
lists `https://api.mainnet.solana.com`, with published shared-IP ceilings of
100 requests/10 seconds, 40 requests/10 seconds for one method, 40 concurrent
connections, 40 new connections/10 seconds and 100 MB/30 seconds. The page warns
these can change, public endpoints are not intended as production infrastructure,
403 can mean blocked access, and 429 requires slowing down and respecting
`Retry-After`. Use limits well below those ceilings and coordinate shared egress;
do not rotate endpoints/IPs to bypass them.

No billing account or funding wallet is selected by ordinary public read-only
RPC queries. This makes them a bounded no-provider-charge candidate, not a promise
of uninterrupted useful capacity. Retain context slots/commitment, current mint
behavior, fees and effective reserves for size-specific quotes. Batched state
reads are not automatically cross-source consistent, and state changes alone do
not reconstruct buyer flow. A null/stale/failed result stays unavailable; it must
not become a zero mark or a fictional protective fill.

## PumpPortal exclusion and honest outputs

[PumpPortal real-time docs](https://pumpportal.fun/data-api/real-time/) and
[fees](https://pumpportal.fun/fees/) make migrations/creation free but selected-token
trades metered at 0.01 SOL/10,000 messages, with an API key and linked 0.02 SOL
wallet floor. **No paid PumpPortal comparison is included.** The existing billing
wallet/recovery bundle is preserved; funding, key installation and a transfer are
not prerequisites for this free-data evaluation. Do not confuse PumpApi with
PumpPortal or supply the latter's wallet-capable key to another service.

Reports must separate official documented access, verified account eligibility,
actual elapsed observation, raw field availability, useful completed features,
matched trade coverage/latency, position quote/protection capability and total
resource cost. Same-token overlapping observations with verified event identity
are necessary for paired latency; counts or unverified timestamps are insufficient.
Missing free eligibility, incomplete flow or an unsuccessful bounded trial is a
reported result, not a reason to exceed limits or enable entries.
