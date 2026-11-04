# POE operating followthrough — 2026-11-04

This successor starts from main `413db7a88dcc51a2499bbd08a45931071316033d`.
H8's exact native build is `a885208fb2cc6cc2548e6e761c22300c1f6d8f54`,
validated in run `41783640756`. H8 validation, native installation and operating
acceptance are separate facts. These additional changes are not part of that
immutable H8 executable.

## Demonstrated remaining defects

1. A rejected candidate's changed vault links, unsupported pool or incompatible
   account layout cleared every candidate's stable rent preparation. Two
   regressions reproduced an unchanged peer going from ready with zero required
   preparation requests to requiring two rent reads. Invalidation now uses the
   existing per-mint preparation owner. Global source invalidation remains
   global. Peers retain original preparation timestamps and expiration, and
   still obtain a fresh executable quote at the actual requested size.
2. A completed technical evaluation recorded a durable changed-evidence gate,
   but retirement also installed a fixed 15- or 30-second revisit delay. New
   verified evidence could reopen the gate and still be blocked by the timer.
   Persistent V3.1 candidates now rely on the current allocation's unready
   durable gate. Global gaps record an individual technical outcome for each
   affected current generation so an older ready gate cannot authorize a retry.
   Unchanged evidence remains suppressed. Provider recovery requirements and
   actual unsubscribe/subscribe settlement retain their existing owners.

Focused validation: 141 financial/provider/protection tests, 352 candidate
coordinator/preparation tests and 99 discovery/migration/slot tests passed.
The new financial and individual-gap regressions failed on the predecessor.
Full immutable-build validation and deployment must be recorded separately.

## Discovery policy and evidence limits

PumpPortal migration notifications and PumpAPI `pump-amm` activity provide broad
PumpSwap identity hints; Pump.fun creation subscriptions remain disabled.
Hints, verified qualification, deep observation and financial entry are distinct
stages. Broad awareness of older pools does not authorize their entry. Deep and
entry eligibility continue to require canonical verified PumpSwap migration age
from 60,000 through 86,400,000 ms. No financial age policy is changed.

Lifetime repromotions are not current-process revisits. Existing allocation,
evaluation, reobservation-readiness and economic-priority events retain those
distinctions. Historical bounded exports do not contain an exhaustive snapshot
of every waiting candidate at every selection, and cannot establish complete
market recall or assign a cause to every historical missing transaction.

PAPER-only execution, the original account/ledger/positions/lifetime equity,
four deep slots, V3.1 economics, two-second protection target, four-second maximum
completed protection gap, reconciliation freshness and natural-flat activation
guards remain unchanged.
