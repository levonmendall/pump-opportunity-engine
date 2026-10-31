# Deep observation: evidence needed for a decision

This review covers the persistent, four-slot V3.1 PAPER service. The objective is
to spend observation capacity on current market evidence, then obtain the full
financial inputs only when a candidate reaches a trade decision. A current pool
observation is not permission to buy it.

## Findings and changes

| Evidence or work | What consumes it | Decision in this release |
| --- | --- | --- |
| Archived creation transaction / origin-proof record | Historical migration identity and time | Optional for current V3.1 observation. Do not request `getTransaction` as an automatic prerequisite, including after restart. Keep real existing provenance; unknown migration time remains `null`. Legacy age-dependent paths retain their existing requirements. |
| Current canonical pool account | Pool/mint binding and event scope | Required. Read current bytes and verify the actual AMM owner, canonical pool address, creator, index, base mint, WSOL quote mint, LP mint and canonical vault links. |
| Current base mint account | Actual token program and event interpretation | Required. Verify initialized supported layout and modeled extensions. Mint/freeze authorities are deferred to the unchanged financial decoder; they do not themselves prevent passive observation. |
| Same-batch Clock | Actual bank context and source age | Required for support freshness. It is explicitly bank-time evidence, never an invented transaction or migration timestamp. |
| Global program configuration and fee configuration | Disabled financial instructions and exact fee math | Deferred from passive observation. Still freshly validated for entry preparation and executable entry/holding quotes. |
| WSOL mint and token-vault account bytes | Reserves, vault usability and executable quote validation | Deferred from passive observation. Canonical address links are checked from the pool/mint bytes; actual vault ownership, balances, extensions and real/economic reserves are checked before pricing a trade. |
| Rent exemption amounts and account lengths | Entry costs and unsigned construction | Required during entry preparation. The immediate decision quote can reuse the original, still-fresh preparation proof; its timestamp is not renewed. Pending-order landing retains independent fresh rent checks. |
| Actual subscription ACK and generation | Start of a valid observation window | Required. Allocation, a hint or a retained record cannot manufacture earlier coverage. |
| Native trade events and protocol effects | Buy/sell pressure, concentration, price movement and reserve changes | Required from the existing stream. Related features use the same events; they do not each trigger another provider request. Missing values remain unknown. |
| Independent successful-signature census | Detecting events missing from the local stream | Required before an actionable window. Preserve actual history verification, pagination and provider admission. |
| Optional history `blockTime` | Diagnostics only | Missing or malformed values become `null`, without rejecting a valid census. Actual packet times, bank Clock, slots, success and finality remain independently checked. Malformed optional payloads are not copied into retained evidence. |
| A forced support/Clock refresh at each audit boundary | Establishing the audit's lower and upper fences | Avoidable when actual direct-subscription packets already prove both boundaries in the current ACK generation. The authoritative auditor repeats the boundary checks and still validates every required interior signature. Windows without usable notification fences, including many quiet windows, retain the bank-context fallback. |
| Frozen baseline strategy comparison | Local diagnostics | Retained as local comparison. It does not add provider requests or control current V3.1 retirement. |
| Repeated failed readiness receipts | Authenticating financial controls | Validate every receipt, but do not count a failed no-op resume as another control intention. Keep all journal history and actual owner/stop protections. |

The minimum passive account union is one pool and one base mint per candidate,
plus one shared Clock. The financial pool decoder is not weakened. It remains a
separate, mandatory consumer of current fee, mint, vault and reserve bytes.

## Request and account work

These are deterministic request plans verified with captured account fixtures,
not a claim about production latency or future profitability.

| Operation for four candidates | Before | After |
| --- | --- | --- |
| Automatic archived-origin prerequisites in current V3.1 observation | Missing origins entered historical verification and retry paths | Zero automatic origin-transaction requests |
| Routine passive account validation | One request, 20 account keys | One request, 9 account keys: four pools, four base mints and Clock |
| Cold passive account validation without hints | One four-pool address-discovery request, then the 20-account union | One request, the same 9-key passive union |
| Cold full financial support without hints | Discovery request followed by full dependency union | One union request deriving both supported canonical base-vault possibilities; four pools use 24 keys instead of two requests totaling 24 keys |
| Rent immediately after entry preparation | Another one or two rent requests, depending on distinct account lengths | Zero duplicate rent requests when the original proof remains valid; still one fresh exact-size pool/Clock quote |
| Forced support reads for continuously ready, actively trading scopes | Up to six cohort reads per minute at ten-second audit boundaries | Normal support freshness cadence when actual notification fences suffice, approximately 2.4 reads per minute |

The last saving is conditional. Peers without usable fences, expired support, recovery, ambiguous
slots and actual provider conditions can require the normal fallback. It is not
an increased request allowance. Four continuously ready scopes can still require
24 first-page history reads per minute: four scopes times six audit windows.
Adaptive history pages and validated finalized suffix reuse remain in place.
These are logical pool-history queries; an eligible quiet cohort may share a
physical HTTP batch without erasing any query's provider charge.

For the first four pools of the retained startup fixture, serialized result
bodies measured 18,026 bytes on the previous cold path, 15,729 on the previous
warm path, and 5,316 on the passive path. These offline measurements exclude
transport overhead and compression; they are not production throughput results.

The current flat V3.1 decision path reserves four starts instead of seven: one
full preparation batch, at most two rent reads and one fresh exact-size quote.
This prevents the scheduler from demanding capacity for calls already removed.
The existing nine-start envelope for owned exposure is retained because holding
protection may yield between preparation reads.

No endpoint, paid provider, request budget, physical request ownership rule,
Retry-After handling or real provider cooldown is changed by this repair.

## Admission and restart behavior

The durable registry can select a canonical pool hint even when creation time is
unknown. A hint allocates an observation scope; it does not prove the account
exists or is supported. Current pool/mint validation must succeed before the real
subscription ACK and usable window.

The first accepted current identity proof records its actual availability time.
V3.1 requires identity evidence available before the evaluated window, fresh
support, complete audited flow, a matched fresh quote and current ledger
permission. Real historical migration records continue to carry their original
times and slots. Quotes derived from current identity use current-source
provenance and monotonically increasing context floors, not a fabricated
`migrationSlot`.

Restart removes only recognized archived-origin deferrals and obsolete
transaction-enrichment capacity estimates. Unrelated economic deferrals, current
source failures, ownership, pending actions and provider backoff retain their
meaning. The indexed durable selector retains the registry population rather
than introducing an arbitrary lifetime candidate cap.

## Financial readiness repair

The previous authenticated control-history projection counted denied resume
attempts against its 512-record limit. Enough failed readiness checks could make
the projection unavailable forever, even after temporary conditions recovered.

The repair streams and authenticates those receipts without retaining them as
control intentions. It still checks their original payload hashes, readiness
shape, revision/time ordering, result and price evidence. Actual pause/stop
intentions retain the bounded projection. A buried owner pause, malformed
receipt or unknown intention still refuses automatic recovery. A preflight
avoids writing another resume attempt already known to lack control authority.
No balance, journal, action, financial epoch or control record is rewritten.

The sanitized pre-release readback showed the active source's entries paused,
repeated resume records and entry work rejected before any RPC with
`financial-entry-control-authority-unavailable`. That is consistent with the
reproduced projection failure. The redacted export is not a complete live ledger
audit; final recovery must be verified on the deployed source.

## Acceptance and remaining production evidence

Regression coverage includes unknown-origin selection and restart, unsupported
current identity, honest unknown migration times, actual ACK generation, strict
audit completeness, genuine provider cooldown, candidate/held ownership,
monotonic quote slots, fresh exact-size quotes and unchanged financial controls.
Disposable fixtures reproduce recovery after more than 512 denied resumes and
refusal for buried owner controls or corrupted receipts.

The release retains PAPER mode, four deep observation slots, the current 25%
cost stop and minimum trailing distance, the legacy 15% policy, the original
account and financial history, and the existing maximum initial consumed-equity
budget. It does not make an incomplete window actionable or guarantee an entry.

Production acceptance requires the exact new source installed, fresh support for
origin-free candidates, real ACKs, usable audited windows, recovered financial
readiness when its ordinary conditions are met, and explainable entry/exit
results. Offline tests cannot establish that these production outcomes occurred.

## Implementation references

- Passive identity: `src/native-observation-binding.ts`,
  `src/native-observation-identity.ts`, `src/research-clock-pricing.ts`.
- Scope selection and recovery: `src/pilot-watch.ts`, `src/market-registry.ts`,
  `src/native-candidate-runner.ts`, `src/pilot-native-flow.ts`.
- Boundary completeness: `src/native-flow-audit.ts`,
  `src/native-audit-session.ts`.
- Unchanged full financial decoder and prepared cost provenance: `src/pool.ts`,
  `src/pilot-market.ts`.
- Bridge and control authority: `src/native-paper.ts`, `src/ledger.ts`,
  `src/run-native-paper.ts`.
- V3.1 entry identity: `src/liquidity-resilient-momentum-v3-1.ts`,
  `src/trader.ts`.
