# Coherent d7 forward result and planning-clock correction

This review uses the independently hash-verified settled archive for source
`d7eab54491c361d7c2d5a31e0543e36bf88fd847`, run
`native-paper-20261028223428977`. It makes no provider request or financial change.
The original forward outcome remains unchanged.

**The target-audit scheduling path completed its physical work on time in this
three-scope sample.** All41 directly linked audit pages completed JSON and settled
before their original deadlines.32 verified predictive failures covered21 distinct
tokens; the busiest valid window contained513 trades. Across all40 targets there
were25 tokens,7 unusable audits and1 unavailable audit. These are different
populations; they are not40 complete windows or32 independent tokens.

The longest first-ready→first-physical interval was2587ms. The latest verified
audit availability was3176ms after its bucket closed, leaving at least6823ms of
its original deadline. Ceiling validation and native-control preparation are
part of this interval; it cannot all be labeled scheduler overhead.

## Provider failures were origin-verification work

Six actual physical timeouts occurred, all under the **1200ms migration-origin
read limit**, not the1500ms target-audit limit:

- Five primary-provider `getTransaction` reads returned no headers/body before
  cancellation. Their signatures and exact source-line references are retained
  in `actual-d7-result.json`. This proves a response absence within the bound,
  without isolating the remote/backend/network cause.
- History request8657 was origin proof read2, not an audit page. PublicNode sent
  HTTP200 headers at963ms and130676 body bytes before the1200ms timeout. Body EOF
  and JSON were unavailable; actual settlement followed the timer by25ms. The
  partial response is not a successful history result.

PublicNode therefore had49 history requests: **48 complete JSON bodies and one
partial HTTP200 body**. All41 target-audit pages were among the complete bodies;
the other8 history requests belonged to origin work. No429/503 was observed.
The six HTTP failures did not produce recorded native socket/control/integrity
incidents. That is useful failure-containment evidence, not proof that no market
notification was missing: the seven unusable audits demonstrate unresolved gaps.

One two-page audit retrieved1100 rows, but failed completeness because a
successful signature was absent from capture. **Zero fully verified multipage
windows** were established. Transport paging and complete-window validation must
be reported separately.

## The one expiration was unavailable information

Curp's target ending22:39:50UTC completed its audit at22:39:53.137, **6862ms before
the deadline**. Its range-covered history omitted one captured signature made of
64 `1` characters, yielding `NATIVE_AUDIT_CAPTURED_TARGET_NOT_IN_HISTORY`.
That encoding canonically represents64 zero bytes. Existing checks establish
base58/decoded length, not cryptographic validity, provenance or economic role.
The retained metadata does not justify dismissing it as harmless or fake.

The later expiration is the same unavailable target. It records no validated
predictive decision by the next bucket; it is not an additional lost opportunity
or demonstrated late dispatch. Seven other unusable audits contain10 unmatched
successful signatures. Their economic relevance requires separate bounded
adjudication.196 independently failed missing diagnostic occurrences were already
permitted in7 verified windows; those occurrences are not a unique-transaction
count across overlapping windows.

## A separate exact-time planning defect was reproduced and fixed

The frozen source compared a readiness result floored at a **newer** clock with
an **older** decision timestamp. One millisecond of local computation could make
a healthy query appear to be future work. Of34 retained history/query wait labels,
none had an active history-provider cooldown, and no query-timeout backoff was
created.27 showed shared views already ready at the event timestamp;7 included
ordinary shared pacing. These labels cannot establish exclusive provider cause.
They do not prove this defect caused every approximately two-second first-page
wait, which also includes actual ceiling/native preparation.

Code commit `53eb5f4b82b0b52a4c3d0735be96be4df00d96c2` passes an explicit frozen
planning timestamp through the existing calendar, individual selection, quiet
batch and PAPER wrapper. Real provider/query deadlines still use current wall
and monotonic evidence. Actual requests still recheck physical settlement,
current cooldowns, deadlines and the shared budget. No rate, timeout, strategy or
evidence rule was relaxed. Native `methodReadyAt` usage was inspected: actual
transaction admission compares its own single current timestamp, and the legacy
pilot's final dispatch compares against a fresh post-read timestamp; neither
requires this native history fix.

The six added clock/cooldown regressions all fail on exact frozen d7, pass with
the fix, and pass independently.141 focused tests and TypeScript build pass.
Raw original failures, corrected output, independent output and file hashes are
retained. The generic joined analyzer now labels reported waits as observations,
requiring separate actual-cooldown evidence before assigning provider cause.

Reproduce this exact offline causal review:

```bash
python3 -B -I evidence/coherent-forward-cause-review-20261028/review.py \
  --input /path/to/verified-d7-artifact \
  --output /path/to/new-d7-cause-review.json
python3 -B -I evidence/joint-deadline-forward-20261028/test_analyze.py
```

This sample establishes no natural held-position protection, six-slot worst-case
capacity, independent whole-market recall, profitable trade or unattended
acceptance. No qualification/order/position occurred. Resource consumption and
the cumulative CPU-reserve stop are reported separately by the lead's verified
resource timeline analysis.
