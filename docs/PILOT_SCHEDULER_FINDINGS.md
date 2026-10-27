The `98ebbb9` pilot’s enrichment refusal was caused by its local request schedule. It was not a response from Solana RPC. A separate admission-order bug discarded a candidate during a temporary feed backoff.

This review uses the immutable prefix of `/workspace/poe-pilot/runs/pilot-20261027180538359-2e0d1205/events.ndjson` through `1793124723532`: 3,697,742 bytes, SHA-256 `cd8014c9464586e015580c7d6cbe428483ad3493573f31c762f05b6fbbc882ca`. The closed second chapter corroborates the actual starts. Executed source hashes were checked against the run’s recorded `98ebbb985459ac3867de503f00cb8ff9db71efb4` source identity. Exact times, operation identities and hashes are retained in [prefix-analysis.json](../evidence/pilot-scheduler-findings-20261027/prefix-analysis.json).

At `1793124723528`, the third required signature had:

| Fact | Application time, Unix milliseconds |
|---|---:|
| Feed receipt | 1793124722316 |
| Earliest enrichment eligibility | 1793124723316 |
| Enrichment job enqueued | 1793124723528 |
| Caller’s latest permitted start | 1793124726116 |
| Full five-second validation deadline | 1793124727316 |
| Earliest start allowed by the occupied ten-second gate | 1793124729100 |

Eight preparation/control starts occupied the gate: two migration-proof reads, two pool-account reads, one block-time read, two rent reads and the PumpApi upgrade. Two successful enrichment reads then brought it to ten starts in ten seconds. The minute count was 26, below its 60 limit. Only 250ms spacing would have allowed another start at `1793124723719`; the ten-second ceiling was the binding constraint. No held-position pricing or independent-audit job intervened between the first selected hint and this refusal. The refused third request created no physical start and received no provider response.

Setup contention is only part of the capacity result. Fourteen distinct selected signature hints arrived in 1,280ms. Each currently requires its own transaction retrieval. Even with an empty gate and zero response/validation time, the interval from the first hint’s one-second eligibility to the last hint’s five-second deadline was only 5,280ms. A ten-start-per-ten-second configuration cannot complete fourteen requests in that interval. At least four hints would remain infeasible. These are signature hints, not fourteen independently verified trades; two were normalized before the gap. Draining preparation traffic alone cannot make this burst pass.

The other defect occurred earlier. Candidate `Ch7v…Cpump` reached its observation limit at `1793124668730`, imposing feed backoff until `1793124670730`. The next candidate, `4EX3c…zpump`, consumed seven preparation requests and finished preparing at `1793124670313`. Its stream admission then failed at `1793124670320`, just 410ms before backoff expiry. The root loop had already marked that mint tested; retirement consequently excluded it for the rest of the run despite the temporary operational cause. No inference about its economic opportunity follows.

The smallest corrections are to check `candidateRetryAt` before preparation or a tested-mint commitment, and to reserve actual rolling request headroom before opening detailed observation. Deferred proof/seed records must retain their identity and reason; fresh windows begin only when the subsequent socket opens. Required quote/state checks still apply when their data is used. Candidate capacity must include enrichment, audit, recovery and held-position work, rather than count only average requests. A different burst allowance requires its own documented endpoint basis, bounded configuration and proving tests; this trace does not establish that another allowance is reliable.

The existing refusal and window invalidation were appropriate after the workload became infeasible. Do not drop selected signatures, extend five-second validation, backfill missed flow or relabel this as a provider failure. This review made no network calls, changed no runtime source or financial state, and establishes neither strategy performance nor continuous protection capacity.

The subsequent repair proposal was also replayed offline through the real request gate using those fourteen hint-arrival offsets. This is a timing prediction: each case assumes uniform RPC response times, 20ms validation, the original first-dispatch delay and no extra storage, audit, recovery or held-position work. The two actually observed body responses were 52ms and 56ms; later responses are unknown. Counts below stop at the first declared-deadline refusal.

| Local gate and opening policy | 60ms response | 250ms response | 500ms response | 1000ms response |
|---|---:|---:|---:|---:|
| 10/10s, recorded preparation occupancy | 2/14 | 2/14 | 2/14 | 2/14 |
| Explicit 20/10s, recorded preparation occupancy | 12/14 | 12/14 | 7/14 | 3/14 |
| Explicit 20/10s, reserve 15 starts before upgrade | 14/14 | 14/14 | 7/14 | 3/14 |

The reserve policy delayed modeled stream opening by 8,482ms. With that delay and 60ms or 250ms responses, maximum modeled enrichment delays were 3,088ms and 3,538ms. Responses of 500ms or 1000ms remained infeasible despite the larger burst gate. Arrival offsets were moved only inside a separate scheduling model; this does not assert that the later real market would repeat those trades. The recorded starts, refusals and counters remain unchanged. [timing-replay.json](../evidence/pilot-scheduler-findings-20261027/timing-replay.json) retains the inputs and per-case results. A bounded test of the reserved 20/10s configuration is informative; neither this replay nor provider documentation proves its reliability.
