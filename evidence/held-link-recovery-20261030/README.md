# Validated dependency-link recovery

Based on installed source93bf0b5. A failed transport read previously discarded the validated address links used by holding protection. The next read then required cold pool discovery plus a fresh full dependency/Clock batch. The repair retains only old committed address metadata after recognized transient transport, cancellation, gate, cooldown or admission refusals. It retains no price, reserve, fee, mark or Clock data and does not retry or bypass provider controls.

Every recovery still reads the entire fresh dependency/Clock union and validates actual position size, slot floors, pool ownership/links, fee state and source ages. Malformed batch/Clock, regressing or stale sources and unknown errors still invalidate all links; actual per-pool contradictions invalidate that pool while unaffected holdings remain independent. Newly discovered links are not committed if admission or final validation fails.

Four meaningful regressions fail against the original class and pass after the repair. Final broader verification passes87 tests plus the TypeScript build. Recovered prices and changed fee/reserve amounts match the independent existing SDK quote path. Two held pools preserve safe warm recovery while contradictory pool links remain refused and require rediscovery.

This is offline evidence only. No provider call, original-account action, deployment or live success is claimed. The primary cooldown/scheduling repair remains separately owned by the parent.
