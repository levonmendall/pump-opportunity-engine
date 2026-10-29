# Historical PAPER trade-quality audit — 2026-10-29

The retained original-account reporting establishes **eight modeled fills / four closed round trips**. It establishes protection failures for **AcBX and 8TJ1**. The 8NTU holding has improved reported protection: a 2,555 ms maximum completed-check gap, below the 4,000 ms boundary, with zero reported unavailable checks or breaches. **None of the four entries can yet receive an independent favorable trade-quality classification:** their decision-time normalized flow, independent audit, actual-size execution quotes and native per-action financial proof are not present in these public inputs.

This is an offline audit of retained authenticated public reporting, not a private-ledger audit, new market observation, operational acceptance or real-world execution claim. No RPC/network market requests, private database reads, credentials, financial writes, service commands or account changes were performed.

## Reproduce

From the repository root:

```sh
python3 -m unittest discover -s test -p test_retained_paper_trade_audit.py -v
python3 scripts/audit-retained-paper-trades.py --manifest evidence/trade-quality-20261029/input-manifest.json --output /tmp/poe-retained-trade-scorecard.json
cmp evidence/trade-quality-20261029/scorecard.json /tmp/poe-retained-trade-scorecard.json
```

To reproduce the public-input extraction from the original retained files, use `scripts/freeze-retained-paper-audit.py --repository /path/to/original/repository --output /tmp/poe-retained-public-facts`. The exact file/archive-member hashes and row locators are recorded in [input-manifest.json](input-manifest.json) and [public-facts.ndjson](public-facts.ndjson). The frozen corpus contains 135 unique projected snapshots, not 125 trades. Original duplicate snapshots and repeated historical fill lists are deduplicated. A public decision's array-derived ID can change between snapshots, so decisions are deduplicated by mint/timestamp/stage/reason; repeated IDs do not create extra qualifications.

The tool fails closed on conflicting fill IDs, cross-account data, unmatched/partial closes, within-run protection-counter reversal or a frozen-input digest mismatch. It separates counter baselines and maxima by run and does not infer SOL P&L from USD displays. Seven focused tests cover these failure modes and the actual four-trade corpus. The raw result is [offline-tests.log](offline-tests.log); exact implementation hashes are in [audit-tool-provenance.json](audit-tool-provenance.json).

## Account and source identity

All inputs identify account `poe-3123e352-4581-455b-85db-acd7e825e99e`, original inception `2026-10-26T22:07:36.212Z`, initial virtual capital $1,000. Public projections cannot independently prove that every private historical journal row remains intact. This audit neither initializes nor modifies a ledger.

The audit implementation starts from repository `84bd3f09995fcbd347710cae5c1ddb8c5f517157`. Historical runtime segments relevant to the holdings are:

| Segment | Publishing source release | Configuration SHA-256 | Holding represented |
|---|---|---|---|
| `native-paper-20261029145012717` | `239a00ea9fbc0a25ebcf318631d26618d941c899` | `5e99ebe042521b3917a11b86ef4b46264205b11d38c407cba264a01046a79344` | AcBX, then 8TJ1 before restart |
| `native-paper-20261029161536720` | same `239a00ea…` | `f6ce54d7594e14d87955f211cca21f594b3d3eb52e20a75fa2245290f22a4857` | 8TJ1 retained through configuration restart |
| `native-paper-20261029164842357` | `cdba9d483fdcef105e74e3053a8d4bbf28bdff0c` | `44e06adbddd6bab5e9aa5f70e9c24061f47998ccc9a1ebd2864d9b5aa8e2c8ae` | 8NTU |

Fa24's two fills are preserved in a 13:55:15.861 UTC snapshot from `5e55d8b939de99698ddb311a282461931fcbc957`, hours after the holding. That later snapshot alone does **not** establish its exact execution source/configuration or protection history. All times below are 2026-10-29 UTC.

## Exact retained fills

The values below are public **USD observations**, not native SOL consideration or net trading P&L. The public records explicitly describe durable single modeled PAPER attempts, embedded pool fees, separate gas and no live-fill claim. Native gas/rent/fee decomposition and quote freshness remain unverified. Quantity means integer token atomic units; token decimals are not established by this public projection.

| Token | Side | Time UTC | Fill ID after `paper-fill:` | Quantity | Displayed value USD | Displayed execution cost USD |
|---|---|---|---|---:|---:|---:|
| Fa24 | buy | 09:15:17.693 | `f57e6eff547ba02b388fd8a44502d794` | 400582323928 | 49.698409 | 0.000701 |
| Fa24 | sell | 09:18:01.660 | `4f60a80e3a2a1138b54933655b1b7c13` | 400582323928 | 41.245086 | 0.000701 |
| AcBX | buy | 15:01:47.821 | `783fb910281022ac56bff60190469d36` | 6411268419 | 49.694031 | 0.000711 |
| AcBX | sell | 15:16:50.857 | `6dd8e14067d2b21a203ce5f5f1ecb921` | 6411268419 | 50.035441 | 0.000714 |
| 8TJ1 | buy | 16:08:35.958 | `c5c94babc37540a39bd3cf70c18d4cf2` | 319987598 | 49.690465 | 0.000720 |
| 8TJ1 | sell | 16:23:37.938 | `8c86a04e730c26bd139f4d3e5783a07c` | 319987598 | 49.638680 | 0.000715 |
| 8NTU | buy | 17:20:07.003 | `b48482a338aeb715f088a5ac1b2d5514` | 1028422062926 | 49.694512 | 0.000710 |
| 8NTU | sell | 17:25:39.189 | `a3642f8273dedd56f127555852b6bf13` | 1028422062926 | 42.251924 | 0.000711 |

Full mint identities, durable attempt IDs, exact timestamps, source/run identities and all available fields appear in [scorecard.json](scorecard.json). Full mints avoid conflating tokens that share a display name.

## Trade judgments and protection

| Token | Holding | Confirmed exit signal | Observed protection evidence | Classification |
|---|---:|---|---|---|
| Fa24 | 163.967 s | Unknown in retained public inputs | No held snapshots or per-check proof; later flat zero counters do not establish its earlier holding | **INCOMPLETE OR UNVERIFIED EVIDENCE** |
| AcBX | 903.036 s | Maximum holding time, reserved 15:16:49.656 | 41 unique held snapshots; ≥4 breaches / 14 unavailable checks; observed maximum 13,745 ms | **INADEQUATELY PROTECTED POSITION** |
| 8TJ1 | 901.980 s | Maximum holding time, reserved 16:23:36.775 | 54 held snapshots over two runs; ≥3 attributable breaches / 8 unavailable checks; post-restart maximum 13,500 ms | **INADEQUATELY PROTECTED POSITION** |
| 8NTU | 332.186 s | Net liquidation stop, reserved 17:25:38.055 | 22 held snapshots; reported maximum 2,555 ms, quote age at use ≤72 ms, zero breaches / unavailable checks | **INCOMPLETE OR UNVERIFIED ENTRY EVIDENCE**, with one improved reported protection lifecycle |

The four-second bound refers to completed usable protection evaluations. The target cadence was two seconds. A fresh quote at a check does not prove that another check completed on time. No synthetic or later price data is used to fill an unobserved protection interval.

**Run attribution matters.** Before 8TJ1, its old run already had AcBX's 4 breaches / 14 unavailable checks. By 16:15:34.062 those run counters were 5 / 17: the pre-restart 8TJ1 delta is **1 / 3**, not 5 / 17. The 19,446 ms old-run maximum was already present at 8TJ1's first retained held sample and cannot safely be assigned to 8TJ1. After restart, counters restart at zero and reach 2 / 5, with a directly attributable 13,500 ms maximum. The auditor keeps both run scopes and does not portray the restart as uninterrupted protection. Quantity, mint and original entry time remained present in the new run, and its modeled sale subsequently closed the holding; this is a limited restart-preservation observation, not complete recovery acceptance.

For AcBX, retained held samples end at 15:13:11.551; the next retained flat frame is 15:37:32.064, after its 15:16:50.857 exit. A fourth breach and five more unavailable checks occurred somewhere in that bracket. Their precise timing/provider cause is not established. The maximum 13,745 ms is a demonstrated lower bound from held samples; the post-exit old reporting projection hides the maximum.

### Correlated failure evidence, with limits

The scorecard includes source-scoped `counterIncreaseBrackets` and provider/resource facts at each retained endpoint:

- AcBX's first three breach increments are observed by 15:02:48.330, 15:03:26.482 and 15:08:46.047. In each preceding retained bracket, physical HTTP timeout/error/throttle counters do **not** increase. Starts per rolling minute at those endpoints are 54, 55 and 60. Sampled CPU is approximately 6–8% of one core, with roughly 25 ms event-loop lag.
- 8TJ1's pre-restart breach increment is observed by 16:14:32.530: no timeout/error/throttle increase in that bracket, 52 rolling starts/minute, approximately 6.3% of one core and 23.8 ms event-loop lag.
- Its first post-restart increment is observed by 16:15:53.353, with one physical timeout in the bracket and a fresh provider cooldown. Its later increment, by 16:22:41.402, has no new physical timeout/error/throttle, 60 rolling starts/minute, approximately 5.6% of one core and 23.5 ms event-loop lag.

These facts are inconsistent with attributing **every** protection breach to provider timeouts or saturated CPU. They support investigating shared request admission/pacing and protection scheduling. They do not prove a particular scheduling cause without physical request start/finish, queued priority and per-check completion traces. CPU throttling, disk I/O, complete quote freshness and every reconnection are not established by these public endpoint samples. No new protection implementation is certified by this audit.

For 8NTU, selected-candidate capture is reported disconnected in samples spanning approximately 17:24:46–17:26:47, while broad discovery/watch remain connected and its stop/exit protection path still reports timely completions. This separates candidate capture from financial protection; it does not excuse the coverage gap or prove all current failure modes fixed.

## Accounting observations

Native per-action spend/proceeds, gas, locked rent/refunds and realized SOL journal values are absent from the public trade projection. The auditor therefore never labels a trade a valid SOL winner/loser merely by subtracting displayed USD fill values. Existing prose states a Fa24 loss of 0.084217894 SOL, but the necessary immediate account/native-action proofs were not located in this retained public corpus; that amount is **not independently reproduced here**.

Tightly bracketed flat original-account snapshots provide these exact **account interval** changes, excluding SOL/USD price translation:

| Holding bracket UTC | Cash SOL delta | Equity SOL delta | Meaning |
|---|---:|---:|---|
| AcBX: 15:01:34.032 → 15:37:32.064 | −0.001778870 | +0.001223410 | No other recorded fill in bracket; native action/cost decomposition missing |
| 8TJ1: 16:08:20.381 → 16:23:41.665 | −0.000243840 | +0.002758440 | No other recorded fill in bracket; restart and possible nonfill charges must remain visible |
| 8NTU: 17:19:57.967 → 17:25:47.004 | −0.076863756 | −0.073861476 | No other recorded fill in bracket; negative account interval, not proof of a bad entry |

Cash and equity differ because retained modeled deposits remain account assets. These are sampled balance deltas, not an independently reconciled native journal or exact standalone trade return. For example, cash declines by a further 0.000014000 SOL between the immediate post-8TJ1 flat frame and the pre-8NTU flat frame, without a new reported fill. That is why using a later account balance as a precise fill-level P&L would be unsafe. The cause of that nonfill interval change requires the native journal. Losing economics alone does not justify a bad-entry classification; positive accounting alone does not excuse protection failures.

The attempt-ID timestamp-to-fill differences are Fa24 2,172/1,201 ms, AcBX 1,641/1,201 ms, 8TJ1 1,685/1,163 ms and 8NTU 1,679/1,134 ms for buy/sell. These establish identity-linked modeled attempt timing only. They do not independently establish actual-size quote availability, quote age, post-delay state validity or absence of execution error.

8TJ1 has public qualification decisions at 16:08:24.724 and 16:08:34.262, followed by the latter's fill. The earlier unfilled qualification's technical cause is unknown from these public inputs. The account is flat before entry; no position-capacity explanation is asserted. All qualifications remain strategy assertions until their actual window/audit/quote evidence is exported.

## Independent opportunity sample retained separately

[opportunity-reference-summary.json](opportunity-reference-summary.json) freezes a compact, source-hashed extraction of the existing independent market work. This does not start another provider/indexing process or claim current continuous benchmarking.

The historic denominator is **nine independently indexed current activity leads**, selected without POE's candidate choices, plus a separate earlier control. It is neither an exhaustive historical market census nor nine verified executable winners. Current 24-hour activity introduces selection/survivorship bias. Of the nine leads, three have raw migration-hint mentions, two retained canonical-origin proofs, two deep observations, one an audited predictive assessment and zero predictive-only passes. These are trace-incidence counts, **not winner recall**. Whole-market and executable-winner recall remain unknown.

- **INGUS** (`2mPwr92SEnFKdMPGJYbCkuicCmXHtVFPse2AvFXTpump`): no retained identity/watch/deep/audit trace. Indexed creation is 22:05:09 on October 27, inside the measured research interruption 21:58:08.797–22:08:00.928. Chain migration, historical support and executable profitability remain unproven. This establishes a conditional observation-gap case, not a demonstrated connected-feed miss.
- **FRONGUS** (`2nPPKzFCYDZLqHxJJdFJA1iV2V4ZqV9K6z8qSiYTpump`): finalized migration at October 27 21:13:41; first retained deep observation at 21:28:21.303, 880.303 seconds later. Selected activity exists but no complete audited predictive window. Historical retained pool states support a roughly $50 size-capacity comparison: 492,825,706 lamports input at 21:28:20.516 versus 1,339,328,077 lamports quoted output at 21:43:18.890, with 7,000-lamport modeled gas at each end. The 846,488,371-lamport ex-post quote difference is **not missed trading profit**: no observed post-delay fills, predeclared exit path or qualifying entry proof exists. The later 22:13–22:28 indexed rally lacks a second coherent retained exit state within the maximum hold. A different token also named Frongus (`2BJD…`) is retained as a distinct earlier control, never merged with this mint.
- **WANSULEK** (`8Tgbaw4G7pvnneMoNY5t7597uKEKkFQcnobJzynjpump`): finalized migration October 27 21:43:47, first deep 21:49:28.168, first audited predictive assessment 21:57:25.108. Early incomplete scopes coexist with three later valid failed predictive windows and 98 setup deferrals. Later valid rejection does not explain unobserved earlier activity or establish entire-token rejection correctness.
- **SI** (`5fYBASRkQ7GHypQMShaYRWUyXQ74tbwZ51hBfzPXpump`): two independently bounded pre-rally chain-time windows have ordinary-swap net selling (−824,612,911 and −1,407,871,025 lamports), with five protocol buy-and-burn transactions in each window. The historical baseline could not claim completeness for the mixed semantics. This is an incomplete-evidence case, not a certified valid rejection or demonstrated missed executable profitable trade. Retrospective block times do not recreate forward information availability.

The next continuing benchmark should preserve this sampled-denominator discipline and link independent opportunity identities to discovery/watch/deep/window/qualification/quote/order outcomes. Missing historical support or costs must remain unknown. It must not consume request capacity reserved for position protection or the critical entry-control repair.

## Exact missing protected evidence

[protected-evidence-request.json](protected-evidence-request.json) lists the eight durable attempt action IDs and four narrow time/mint windows needed by the **existing** protected forensic/maintenance mechanism. This request has **not** been executed. It calls for read-only account-identified attempt/order/journal/action facts and matched historical native evidence, without a service restart or copying the whole ledger.

Required facts are: canonical pool and on-chain migration proof; complete 60-second executed-flow features and independent audit; decision-time liquidity and actual-size entry quote; reservation and readiness/risk checks; actual modeled native SOL spend/receive, fees/gas, deposits/refunds and journal results; every held-check completion and quote timestamp; exit decision and actual-size liquidation proof; source/configuration and recovery brackets. Native event kinds and exact action IDs are included in the request. If those records were never retained, that absence must be reported rather than filled using current data or hindsight.

**Assessment: operational protection failures are proven for two holdings; complete historical trade-quality and net SOL certification remain NOT YET PROVEN — SPECIFIC EVIDENCE MISSING.** This audit makes no claim that the current safe-stop/readiness repair is installed or that autonomous PAPER acceptance is complete.
