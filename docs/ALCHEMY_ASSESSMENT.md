# Existing Alchemy Solana assessment — 2026-10-27

**Access update:** normal isolated GitHub Actions checks now confirm repository
secret MM_SOLANA_READ_RPC_URL in levonmendall/The-Meme-Machine, and protected
host validation confirms Alchemy Solana mainnet HTTPS/v2key path. No key was
exported, no provider request occurred, and main/deployments/EC2 remain untouched.
Existing-key discovery is resolved; authentication and no-charge quota are not.
See PROVIDER_BINDINGS.md/evidence/alchemy-binding-validated.json. The preliminary
binding limitation in the original assessment below is superseded by that receipt.

**A documented narrow stream path exists; fresh complete POE flow and lower total
cost are not yet demonstrated.** This assessment used public primary documents
and the existing nonsecret [binding report](PROVIDER_BINDINGS.md). No Alchemy
API key, account session, provider connection/request, usage allowance, new
subscription, spending, transaction or infrastructure change was used.

The existing reference is `SOLANA_ROI_ALCHEMY_API_KEY` in
`levonmendall/solana-roi-convergence`; an accessible GitHub environment is
`main - solana-roi-convergence`. That is a configuration reference, not proof that
the named secret exists in that scope or that its app has usable POE quota.
The earlier repository/environment secret-name requests returned HTTP403.
Repeating that inventory or replacing the key is not the next step.

## Exact Solana paths

Alchemy documents native Solana PubSub at
`wss://solana-mainnet.streaming.alchemy.com/v2/<EXISTING_APP_KEY>`, with HTTP
reads at `https://solana-mainnet.g.alchemy.com/v2/<EXISTING_APP_KEY>`.
Use one connection with bounded selected-pool subscriptions. The generic
`alchemy_pendingTransactions` and `alchemy_minedTransactions` APIs explicitly
support Ethereum/Arbitrum/Polygon/Optimism, not Solana. No Solana
`transactionSubscribe`/Helius-style `accountInclude` interface was established
from the Solana reference. [Solana index](https://www.alchemy.com/docs/reference/solana-subscription-api-endpoints),
[chain-specific distinction](https://www.alchemy.com/docs/reference/subscription-api).

| Native method | Selected scope and evidence | Commitment and remaining work |
| --- | --- | --- |
| `logsSubscribe` | `{"mentions":["<VERIFIED_POOL>"]}`; signature, error and raw logs | Explicit processed/confirmed/finalized; validate complete IDL/event decoding. |
| `blockSubscribe` | `{"mentionsAccountOrProgram":"<VERIFIED_POOL>"}`; matching transactions in matching blocks | Confirmed/finalized only; full transaction data can avoid one HTTP fetch per incidental log. |
| `accountSubscribe` | One verified pool/vault/mint/config account | Explicit processed/confirmed/finalized; useful current state, insufficient gross trade/buyer flow. |

References: [Alchemy logs](https://www.alchemy.com/docs/reference/logs-subscribe),
[filtered blocks](https://www.alchemy.com/docs/reference/block-subscribe),
[account updates](https://www.alchemy.com/docs/reference/account-subscribe).
Standard [Solana log filtering](https://solana.com/docs/rpc/websocket/logssubscribe)
accepts one mentioned address per subscription; do not assume a list of 12 is
supported. Use only tracked/held verified pool addresses, never `all` or the
whole PumpSwap program as a substitute for the shortlist.

The documented filtered full-transaction request is:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "blockSubscribe",
  "params": [
    {"mentionsAccountOrProgram": "<VERIFIED_POOL>"},
    {"commitment": "confirmed", "encoding": "json", "transactionDetails": "full", "maxSupportedTransactionVersion": 0, "showRewards": false}
  ]
}
```

This is documentation, not a submitted request. The streaming host is mandatory
for `blockSubscribe`; the standard `g.alchemy.com` WebSocket host returns method
not found. No matching transaction means no notification. The documented filter
removes unrelated transactions, rather than requiring a chain-wide block reader.
Handle block errors and unknown transaction versions explicitly; `jsonParsed`
does not establish a managed PumpSwap trade parser. Actual app entitlement and
payload completeness remain untested. Version `0` is the documented request
setting, not proof of coverage for a future higher transaction version; a null
block or unsupported-version error makes the affected evidence unavailable.

The shared subscription overview publishes 100 Free/2,000 other connections,
1,000 subscriptions per connection and 200 outstanding JSON-RPC requests. These
are documentation ceilings, not measured Solana guarantees. POE needs at most
12 selected-pool subscriptions plus bounded protection-state work, not those
maximums. No native PubSub resume cursor or durable replay guarantee was found.
Do not inherit Ethereum SDK backfill promises or Yellowstone's replay behavior.

## Preserve strategy evidence and protection

A selected-pool raw stream could supply the existing 60-second flow rule, but
only after demonstrating actual successful buy/sell instructions, wallet roles,
integer executed quantities, fees and complete instruction/event identity using
the pinned official Pump interfaces. Include routed CPI calls into the selected
pool, distinguish multiple swaps in one signature, and retain later corrections
at their actual availability time. Requested maximum/minimum amounts are not
executed amounts. Raw state differences cannot supply net buying, persistence or
buyer concentration. Different wallet strings do not prove independent buyers.
Account updates may trigger/coalesce necessary current-state reads, but they do
not make separately arriving account values coherent. Retain commitment/slot and
freshness for compatible batched quote inputs, current fees, mint behavior and
effective/signed virtual reserves; raw vault balances alone are insufficient.

Test processed logs against confirmed on-chain outcomes separately from a
confirmed block-stream comparison. PumpPortal documents processed observations;
Helius Parsed Streams documents confirmed-only delivery. A timing difference
across those commitments includes confirmation time. Event counts are neither
paired latency measurements nor proof of complete flow.

On reconnect restore the full desired set, preserve held-position priority and
invalidate affected flow windows. Reconcile a bounded inclusive history overlap
with complete identities, or collect a fresh uninterrupted window. A quiet
selected-pool stream is not a failure, and slot gaps alone do not prove lost
events. Historical repairs must not enter earlier decisions. Keep read-only RPC
pricing/protection available for held positions even when flow is unavailable;
unknown marks block new risk. This assessment changes no entry rule, safety
check, position limit, feature lookback or acceptance prerequisite.

## Total cost, not a count of cheap stream messages

The [Solana-specific CU table](https://www.alchemy.com/docs/reference/compute-unit-costs)
prices native WebSocket delivery at **0.0002 Alchemy CU per byte**. The generic
0.04-CU/byte WebSocket figure is not the Solana row. `getAccountInfo` costs 10 CU,
`getMultipleAccounts` 20 CU per RPC request, and `getTransaction`,
`getSignaturesForAddress`, `getBlock` 40 CU each. JSON-RPC batching does not make
multiple method calls free. These billing CUs are not Solana execution units.

Use the observed method counts and delivered bytes:

`CU = 0.0002 × WS_bytes + 10 × accountInfo_calls + 20 × multipleAccounts_calls + 40 × (transaction_calls + signatures_calls + block_calls) + other_method_CU`.

Count overlap, reconnect traffic, failed billable requests, history checks and
quote/protection reads. A full filtered transaction stream may reduce extra
transaction RPC requests; raw logs may be smaller if their complete event data
can be verified cheaply. Measure both instead of assuming either is cheaper.
For illustration only, one 20-CU batched read every 2 seconds is 864,000 CU/day,
before any streaming or other calls. That is arithmetic, not a proposed poll
cadence or an authorization to relax current freshness requirements.

[Current plans](https://www.alchemy.com/docs/reference/pricing-plans) list
30 million Free CU/month and 300 CU/second; the
[Free-tier support page](https://support.alchemy.com/articles/5827006872-what-is-included-in-the-free-tier)
states the monthly allowance is account-wide. Existing app/other-workload usage
must be subtracted. No remaining allocation or POE availability was verified.
The reference lists PAYG at $0.525/million CU; public pricing rounds to $0.52,
while an older [billing support article](https://support.alchemy.com/articles/2300474614-understanding-alchemy-s-pay-as-you-go-billing-model)
quotes $0.45/$0.40. Verify actual billing terms; none authorizes a charge.
PAYG does not inherit Free's monthly allowance. Solana gRPC is a separate paid
product, and that support article warns it bypasses normal CU/dollar usage caps.
Do not enable it as a free fallback.

The test must also count EC2 CPU/memory, parse/queue completion lag, retained
evidence/disk, bounded decoder/recovery effort, and allocated operating costs.
Price observations at the same actual size and freshness; compare identical
selected tokens and overlapping time. Report cost per usable fully observed
minute and completed decision, not only per delivered transaction. No current
measurement establishes a cheaper complete alternative to PumpPortal.

## Existing access and quota route

An app API key can authenticate node/stream requests but cannot, by itself,
retrieve account/project quota. Alchemy documents
`GET https://admin-api.alchemy.com/v1/usage/summary` with a separate **Usage read**
access key (`ADMIN_USAGE_READ`), or an existing viewer/developer/admin dashboard
session. It returns limits, used/remaining amounts and a data-freshness marker.
No such session/binding is available here. Do not try the app key against it or
create an administrator credential by default. A current sanitized owner Usage
view/export is an adequate alternative. [Admin authentication](https://www.alchemy.com/docs/reference/admin-api/overview),
[usage summary](https://www.alchemy.com/docs/admin-api/usage/get-usage-summary).
Listing apps is unnecessary when the intended app ID is known and would return
API-key fields; do not dump it to obtain harmless metadata.

Subsequent authorized presence/host-only checks resolved the binding:
`MM_SOLANA_READ_RPC_URL` in `levonmendall/The-Meme-Machine` exists and parses as
HTTPS on `solana-mainnet.g.alchemy.com` with a key-bearing path. The earlier ROI
candidate names were absent in tested scopes. See `PROVIDER_BINDINGS.md` and
`evidence/alchemy-binding-validated.json`. No provider request or key export
was needed. A later eligible probe can consume that existing secret directly
inside its owning repository's bounded operator job; outputs/artifacts must
never contain the URL or credential. Authentication and billing remain untested.

Run only pinned new POE probe code, with read-only method/host allowlists,
duration/request/byte/queue limits and sanitized results. Never echo the key,
key-bearing URL, headers, environment, request-error bodies, bundle, or secret
as an artifact. Do not load the legacy trader or reuse its budget controller.
Any later EC2 installation must use the existing private administration route
and protected file permissions, without a chat/GitHub/Render credential copy.
No workflow, secret or account changes were performed by this assessment.

The precise remaining unblock is the intended Alchemy app/account's current
plan, verified remaining shared Free CU, overage/usage-cap state and the POE
allocation. Secret availability and public host validation are complete. The owner requested this
reuse assessment; another provider account or replacement key is not required.
Once access and no-increase allocation are established, test the selected-pool
native stream before considering paid alternatives. If the allocation cannot
maintain complete required windows and held protection, report measured total
requirements and keep new entries closed; do not weaken the rule to fit it.

Current official CU table rechecked 2026-10-27: `getBlockTime` is20CU; a
quote using two `getMultipleAccounts` reads plus one `getBlockTime` costs60CU,
before stream bytes, history checks or any additional methods. No Alchemy
requests were made in the zero incremental cost assignment.
