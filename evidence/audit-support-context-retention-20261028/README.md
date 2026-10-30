# Historical audit fence retention

The first native PAPER source6d recorded three9tVNg targets (20:11:10,20:11:30,20:11:40 UTC) as eligible/audit-selected, then returned to lower-fence warming without opening a history session. Exact selected metadata and original line hashes are in `actual-incidents.json`. The trace does not contain a full per-read live memory census, so it cannot by itself identify every evicted tuple.

The software mechanism is reproduced offline: the original filter retained180s by time but then truncated to16 raw support reads. Repeated ceiling/runway refreshes erased a quiet candidate's actual post-ACK context from60s earlier. A target could have that lower fence at eligibility, lose it during its required upper-ceiling refresh, and then start zero audit requests. `before-selected-ceiling.txt` preserves that failure. This is local evidence-retention loss, not a provider-capacity conclusion or a relaxed completeness rule.

The adapter now retains the actual earliest/latest context in each10-second availability bucket over the same180-second horizon, at most38 context tuples per scope. Equal-availability ties preserve the last observed tuple at the earliest timestamp. No slot, Clock, availability timestamp, source expiry, quote age, successful-flow requirement or strategy threshold is synthesized or changed. These are historical confirmed-bank range fences, not current pool prices and not independently retrieved block timestamps. Existing current support must remain fresh; invalid/missing/stale support still blocks qualification; a new subscription ACK resets the history.

Eight focused tests cover dense bounded retention, exact-boundary/tie semantics and immutability, three simultaneous quiet adapter scopes, stale/failed/invalid support, actual reconnect/retirement resets, a real adapter-to-runner independent audit/rejection, and the exact eligibility-to-ceiling-refresh race.206 related regressions and TypeScript build passed. Independent review ran148 broader checks and the final8 focused checks, both passing. Fixtures are explicitly offline; they do not prove new provider responses, live trading, profitable execution or a repaired forward interval.

Commands:

```bash
node --import tsx --test test/native-support-context-retention.test.ts test/native-candidate-runner.test.ts test/pilot-native-flow.test.ts test/native-flow-audit.test.ts test/native-audit-session.test.ts test/native-control-recovery.test.ts test/native-flow-heartbeat.test.ts
npm run build
```

`before-initial-slot-fixture.txt` is an earlier development reproduction; the exact-boundary race with corrected current-slot fixture is the primary before/after comparison. All old forward failures remain unchanged. New forward evidence must show actual retained lower/upper audit contexts and completed assessment availability; additional legitimate audits may consume requests that the broken path never started.
