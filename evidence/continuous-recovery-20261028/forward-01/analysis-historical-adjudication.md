# Later historical adjudication — six missing supported swaps established

**Final diagnostic result: all six previously unknown successful rows were supported executed swaps. Three original target windows had genuine executed-flow loss; one other unusable audit was the separate stale-tail snapshot case.** The initial refusal and corrected continuation are retained as separate segments below.

This is a **new, later diagnostic**, not a correction of original forward availability. The original41 assessments/16 deadline misses/4 unusable audits remain unchanged.

The lead ran the prepared bounded six-target historical diagnosis from source`85e1495bb13e5b6cbde6783fc5f712f0f763a8b4`, run`historical-adjudication-20261028170300`. It made3 physical public-RPC calls, completed2 transactions, then stopped at the first RPC-32015 response. The other3 signatures were not requested;4 original unknown-success targets remain unresolved. The three consumed operations are linked append-only:217 books,6,192 cumulative units,466,090,450 accounted response bytes,196,739,072 uncertain bytes retained. Physical settlement was confirmed. The third response was HTTP200/242bytes containing RPC-32015; provider error text was not retained. No automatic retry, financial-ledger access, source-window repair, PAPER execution or balance reset occurred.

Both completed transactions were **actual supported successful BuyExactQuoteIn swaps**, not failed-only packets or incidental pool touches:

| Signature prefix | Slot | Chain block time | Curve SOL lamports | User quote lamports | Token integer units |
|---|---:|---|---:|---:|---:|
|59BVuGZh…|462545154|16:32:34 UTC|2,318,984|2,345,653|1,068,771,311|
|2g7JspaS…|462545154|16:32:34 UTC|2,352,480|2,379,535|1,084,234,220|

Each passed the existing full mapper's executed base/user-quote transfer checks, exact supported instruction layout, event identities, amount/fee validation and program-user attribution. Their users were different addresses; that does not establish independent people. The combined missing curve amount was0.004671464 SOL. Their exact identities, traders, fees, mapping evidence, original and later timestamps, and private raw-file hashes are preserved in the adjacent JSON. Full raw transactions remain in the private research directory rather than being copied into the repository.

Both legacy transaction messages contained the canonical pool in their static account keys(index2); neither used loaded addresses. The pool`3MSeAyD6yj7PaCzurFnbBueKN6YSTKm9gqGAbNZxFV8K`/mint`6EKmRQYzAXh5t6t1XNe2chYqmdSHgd32uA7xki9upump` was ACKed onconnection2 at16:32:21.416. The audit target was16:32:30–16:33:30 and both slots lay strictly inside audit fences462545126–462545419. Neighboring selected notifications at slot462545153 and462545156 were retained on the same connection. The two signatures appear in the original selected event segments only in the later independent history page and audit result, never as a received packet, validated event, refusal or retired packet. Retirement occurred only after the audit exposed the missing information, at16:33:37.440.

Therefore these two were **genuinely absent required executed-flow evidence**. It would be incorrect to waive them as an unnecessarily strict failed-transaction census, late-ACK interval, ALT-only filtering concern or boundary ambiguity. Their actual historical retrieval availability was around17:02:58–17:03:00, not16:32:34. They must not be backdated into the earlier features or turned into a retroactively qualified decision.

The exact loss point remains **unknown**. The retained record establishes no local gap before these two signatures, but does not retain every raw transport packet. It cannot prove whether the provider omitted the notifications, the subscribed confirmed branch differed, or an unrecorded transport/application path lost them. The independent audit correctly prevented qualification from incomplete information. Their small amounts alone do not prove that the candidate would have passed, filled or profited.

The third failure warrants a narrow transaction-version diagnosis: the historical request set`maxSupportedTransactionVersion:0`, while the existing full mapper accepts legacy,0 and1. RPC-32015 is consistent with an unsupported-version response, but the provider error text was not retained, so this cause is not established here. A separately labeled bounded continuation may resolve the four remaining historical targets after verifying the appropriate request contract. It must retain the three consumed calls and leave the original forward windows unusable.

An additional **offline transaction-log replay** passed both historical payloads through the current native program mapper: one ordinary buy each, zero protocol effects, exact side/trader/integer quantities/user-and-curve amounts/fee parity with the full mapper. No source receipt time was invented and no flow admission occurred. These two payload shapes are supported by the native decoder; their absence is not explained by an unsupported Buy label. The small replay script/output and hashes are retained beside this report.

## Separately bounded corrected-version continuation

The lead then ran`historical-adjudication-20261028171000` from the same source`85e1495bb13e5b6cbde6783fc5f712f0f763a8b4`, using`maxSupportedTransactionVersion:1`, consistent with the existing full mapper. All four remaining targets completed successfully. The earlier RPC-32015 was caused by the diagnostic's version0 request cap excluding a real version1 transaction; it was not evidence that the public provider could not supply the transaction. The initial three calls remain charged and the negative result is retained.

| Mint prefix | Signature prefix | Version / actual scoped shape | Slot / chain block time | Curve SOL lamports | User quote lamports | Token integer units |
|---|---|---|---|---:|---:|---:|
|AdTkz2|3THNRiLT…|v1 routedSellV2|462545546 /16:33:57|948,117|936,737|1,362,464,459|
|AdTkz2|RRC5hUtH…|v0 directSell|462545546 /16:33:57|566,193,854|559,399,527|809,496,641,868|
|AdTkz2|5ZFjHmRY…|v0 directSell|462545546 /16:33:57|373,438,636|368,957,370|529,424,911,310|
|5JapmL|5DW1RTcy…|v1 routedSellV2|462546626 /16:37:47|1,977,274,332|1,952,558,402|19,207,767,727,273|

Both version1 transactions actually contain`message.transactionConfig` with compute-unit limit, optional heap size, loaded-account-data-size limit and priority fee. Both have empty loaded-address lists. All four contain the target pool in static account keys; the two version0 transactions also have no loaded addresses. The5Jap routed transaction's **fee payer differs from its program-event trader**; attribution came from the established executed program role and transfer checks. Each transaction has one mapped PumpSwap trade for the target pool. The5Jap transaction has further routed swap activity, but this is not proof of multiple target-pool swaps or complete ecosystem variant coverage.

The four later transaction-log replays each produced exactly one ordinary sell, zero protocol effects, and exact economic parity with the established full mapper. **The program-log mapper hash is identical to frozen906** (`27a5c53359ce9cc412bfa07af7581a232de640384e461122a981c9695db1e6f0`). These packets would not have failed that decoder because of a SellV2/routing/version label. The v1 format did affect only the later full-transaction diagnostic's initial request cap.

AdTk was ACKed onconnection2 at16:33:48.769, before its16:33:50–16:34:50 target. All three missing swaps at slot462545546 were strictly inside fences462545502–462545799. The same connection retained AdTk packets at slots545 and547, but none at546. Its candidate was retired only when the audit exposed the missing rows, at16:34:53.149.

5Jap was ACKed onconnection3 at16:36:41.679, before its16:36:50–16:37:50 target. The missing swap at slot462546626 was strictly inside fences462546353–462546643. Its candidate was retired only after the audit exposed the missing row, at16:37:52.280. There was no earlier recorded candidate-local gap in either generation. None of the three affected slots154/546/626 has a retained selected packet for any pool; without independently proving other selected-pool activity in those slots this does **not** prove a source-wide skipped block.

The demonstrated information losses matter: the AdTk window omitted0.940580607SOL of executed curve sells, and the5Jap window omitted1.977274332SOL of executed curve sells. Waiving them could overstate net buying. The6EK window omitted the separately documented0.004671464SOL buys. These amounts belong to different pools/windows and must not be added into a fictitious portfolio return. The missing events do not establish a profitable or qualifying trade, and their later availability does not repair an earlier decision.

The two diagnostic segments consumed **7 physical requests total**,85,799 additional accounted response bytes, and no new uncertainty. Append-only accounting now contains218books,6,196 cumulative units,466,149,333 accounted response bytes and196,739,072 uncertain bytes retained. All operations settled and were linked. The one independently confirmed failed row that had never been captured remains unrequested; it cannot change executed flow and needs no additional query merely to count failed diagnostics.

**Remaining cause:** real executed-flow gaps are proven for three original windows, but the exact provider-delivery versus transport/application loss point remains unknown. Full wire delivery was not retained, and neither later RPC availability nor parser parity establishes earlier receipt. The fourth unusable result remains the previously proven late diagnostic-tail snapshot issue. All original unusable outcomes remain unchanged. Continue fail-closed audit admission and capture the minimum bounded receipt/dispatch provenance needed to localize any recurrence, rather than waive successful missing trades or claim the entire source was reliable.
