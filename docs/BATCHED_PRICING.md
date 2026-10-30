# Isolated multi-position RPC pricing comparison

This review-branch adapter changes no production runtime, strategy or account.
`quotePositionsSell` in `src/pool.ts` accepts one to three unique hypothetical
holdings and shares the established single-pool decoder and SDK sell calculation.
The installed observer still uses neither this adapter nor autonomous entries.

Each successful cycle performs **three actual JSON-RPC requests**:

1. One confirmed `getMultipleAccounts` for the selected canonical pool accounts,
   verifying identity and obtaining their vault links.
2. One confirmed `getMultipleAccounts` for the deduplicated pool, global config,
   fee config, mint, native mint and vault dependencies, at a context no older
   than the first read or any supplied migration/verification slot.
3. One `getBlockTime` for that complete dependency batch, enforcing the existing
   30-second state-age limit.

The decoder checks canonical migrated SOL pool identity, account owners,
Token-2022 extension compatibility, vault ownership/initialization, signed
virtual reserves, retained fee buckets, fee configuration and integer SDK
rounding. It compares vault links across the two reads. Missing or unsupported
pools become explicit per-pool unavailability; shared context/network errors
abort the cycle. Evidence storage errors propagate and stop collection. A
minimum slot is a lower bound; it is not proof that separately obtained USD or
trade-flow facts are atomic with the batch.

Every quote retains the original complete batch receipt time. Callers must still
apply the existing **2-second at-use quote-age** requirement. Batch completion or
later block-time validation does not refresh that receipt time. Network/priority
fees, refundable account deposits, USD and financial accounting remain separate.
The adapter has no cache, financial writer, stream state, wallet or transaction
construction. It does not reconstruct candidate buying flow.

## Actual bounded public-RPC result

On 2026-10-27 at **01:34:41.927–01:34:42.824 UTC**, the nonroot Cloud test ran
three immediate rounds for two actual supported pools. The CRp…pump token was
selected as the next successfully verified migration; 2su…pump was a previously
captured supported pool. The latter had passed the rule's 120-minute candidate
age and was used only as a hypothetical holding. Both notional quantities came
from retained integration quote sizes. No position or authoritative account was
created.

[Summary](../evidence/free-data-20261027/batch-live-2026-10-27T01-34-41.927Z.json)
and [selected dependency records](../evidence/free-data-20261027/batch-live-2026-10-27T01-34-41.927Z.ndjson)
retain the exact source digest, dirty development state, slots and size inputs.

- **9 requests**, consisting of 6 account batches and 3 block-time reads;
  **38,298 response bytes**; zero provider credentials or incremental API charges.
- **6/6 hypothetical size quotes** available. Each matched the established
  single-pool helper on the **same captured bytes** during offline replay.
- Cycle times: **209.3, 216.4 and 432.0 ms**; p50 216.4 ms and nearest-rank p95
  432.0 ms, with only three samples. Source age at returned availability was
  **59–78 ms** (p50 72 ms). The three confirmed slots were 461886046–461886048.
- CPU: **300.2 ms** for the 897.4-ms test. Sampled RSS was 144.6 MB during rounds
  and 147.8 MB at completion. This is a brief Cloud sample, not EC2 compatibility
  or steady-state capacity evidence.
- No quote output changed across the three immediate rounds. Changed-state
  delivery latency, outage protection and long-duration freshness are untested
  by this probe. No natural trade, fill or performance is claimed.

The process used a 30-second abort, 35-second outer timeout, 20-second CPU limit,
128-MiB Node heap, 256-MiB sampled RSS stop, 64 file descriptors, 4-MiB maximum
file size, 9-call cap, 2-MB individual RPC response cap and 8-MiB aggregate RPC
response allowance. Completed batch evidence is under 64 KiB. It did not run on
EC2 or touch the observer.

## Request savings and limits

The established helper needs three requests **per position**. Shared batching
therefore reduces a two-position cycle from 6 to 3 requests and a three-position
cycle from 9 to 3. The three-position reduction is proved on explicitly synthetic
same-context assembled fixtures, not a forward three-pool observation. An actual
single dependency batch provides coherence that assembling independent historical
captures does not.

For illustration, at a **hypothetical 5-second cadence**, three separately quoted
holdings would require 108 requests/minute; one shared batch would require 36.
The existing local RPC profile is capped at 60 requests/minute, so the former
cannot fit even before discovery/recovery. A 25% reserve would leave 9 of the
45 non-reserved requests/minute after the shared holding cycle. At a 2-second
cadence, even shared batching needs 90/minute and does not fit. **Neither cadence
is a frozen strategy requirement or authorized monitoring change.** A protection
schedule and reserve/admission policy need explicit testing before integration.

If eligible Alchemy access is later established, account batches alone cost
40 CU/shared cycle versus 40 CU/position cycle under the documented 20-CU method
price. Block-time, notifications, verification, failures and safety reserve must
be added at their verified method prices; this is not a total billing estimate.
At 5-second continuous duty, the two account reads alone project to 691,200
CU/day or 20,736,000 CU/30 days. At one hour/day, they project to 28,800 CU/day or
864,000 CU/30 days. These arithmetic examples do not establish account eligibility,
remaining allowance, a usable monitoring cadence or continuous free operation.

## Reproduction

Offline, with no provider access:

```sh
node --import tsx --test test/batch-market.test.ts test/pool.test.ts test/rpc-market.test.ts
node --import tsx scripts/free-data-quote-replay.ts
```

The replay reports its captured source time and preserves chronological
information availability. Its notional exit cases are synthetic regression
scenarios, not financial outcomes.

Only after reserving the assignment's remaining public-RPC/evidence allowance,
the bounded live command is:

```sh
timeout --signal=TERM --kill-after=2 35 prlimit --cpu=20 --fsize=4194304 --nofile=64 -- node --max-old-space-size=128 --use-env-proxy --import tsx scripts/batched-pricing-probe.ts
```

Each invocation is another nine-request allowance, not an unlimited benchmark.
Do not rerun it to imply elapsed acceptance or deploy it from this review branch.
