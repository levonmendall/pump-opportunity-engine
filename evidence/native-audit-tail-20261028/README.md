# Corroborate actual audit-tail packets without backdating information

Base: `90625f53b686578637accf73ebc457f841743ee2`. This isolated repair addresses two source640 diagnostics whose frozen ledger snapshots lacked successful packets that actually arrived while independent history was being fetched. It makes no network, financial, strategy or deployment change.

The original audit notification snapshot, six closed buckets, required target-signature list, independent slot fences, history pages, deadlines and quote rules remain unchanged. A synchronous optional `postSnapshotNotifications(startedAt)` callback may add only actual local packets with `availableAt > startedAt >= target.endAt`, before audit completion. This tail corroborates independently retrieved history; it never ingests or backdates strategy features. The callback is not an RPC request, retry, queue or new allowance.

The runner supplies it only with an exact current mint/pool/openedAt/connectionId/subscriptionId generation, unchanged candidate object, open source admission, connected warm source and no quality loss. `snapshot.connectionId` is an added projection of existing connection state, not a new transport. Session cancellation/expiry blocks the callback. The auditor independently validates schema, source generation, timestamps, hashes, status, corrections, all old history checks and the unchanged8192row union bound. Missing successful activity remains blocking; unknown rows are never assumed nontrades. Completeness flags are only meaningful at final audit availability, **not** proof that late packets existed at the initial snapshot.

New diagnostics retain `notificationSnapshot` (capture time, original/required counts), `postSnapshotTail` (generation, actual refresh time, rows, added signatures/packet timestamps/hashes and matched interior signatures), and `native-flow-audit-post-snapshot-tail`. The profile is separately versioned `native-resumable-executed-flow-audit-tail-v4`. Existing source without the callback retains old behavior. A source lacking exact generation cannot use the callback.

`actual-tail-1.json` and `actual-tail-2.json` are bounded extracted source640 evidence. Original native availability, identity, hash, independently normalized history status, context fences and target times are preserved. The test converts normalized failed status to the explicit `{RecordedIndependentFailure:true}` marker solely to satisfy the RPC-history adapter shape. It does not claim an original raw error body or invent its instruction/error meaning.

- Recorded mWT target: the old snapshot sees3missing successful signatures; adding its3actual post-snapshot packets makes history corroboration valid with unchanged required signatures and one request. All3remain later information.
- Recorded vv target:2actual post-snapshot packets are corroborated; the remaining successful signature is unknown, so the result stays unusable. A protocol boost effect remains distinct from an ordinary buy.
- Synthetic runner tests ingest a genuinely later test buy, verify it remains outside the earlier closed feature window, and refuse changed connection identity or closed admission. These are mechanics tests, not new forward-market or profit evidence.
- Explicit offline stress covers status reversal, hash/correction/unusable data, wrong pool/mint/connection/subscription, pre-snapshot/future/pre-ACK times, input/union bounds, cancellation, deadline crossing and admission closing. Safe conservative refusals remain possible for same-millisecond availability or union-bound pressure.

`build-before-test-types.log` preserves a test-only TypeScript annotation failure; no runtime defect was inferred. The annotations were corrected before final verification. `focused-initial100.log` and `focused-runner103.log` are earlier successful focused runs. The final exact file identity and raw focused/full/build/compile/diff-check receipts are in `verification-identity.json` and `verification-receipts.json`.

Reproduce offline:

```bash
node --import tsx --test test/native-flow-audit-tail.test.ts test/native-flow-audit.test.ts test/native-audit-session.test.ts test/native-flow-audit-batch.test.ts test/native-candidate-runner.test.ts test/pilot-native-flow.test.ts
npm test
npm run build
npm run compile
git diff --check
```

Independent review found no blocking issue. This does not resolve source640's unknown final UNSCOPED packet, guarantee provider timing, or increase its four-page history capacity. The actual Fhs target had6955required signatures, so a fully independent result would need at least7pages of1000under the existing per-signature contract; quiet adaptive paging and this tail repair cannot establish busiest-pool readiness. Parent integration owns that capacity decision and all forward measurement/deployment.
