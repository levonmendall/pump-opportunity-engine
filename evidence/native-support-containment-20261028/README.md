# Fresh support refresh failure containment

Implemented against immutable base71896104f07faa2b193b90d3d3133a8e29236f35. This is an offline correction, not a forward pass or PAPER acceptance.

The retained second forward run failed support refresh6678 at17:37:17.094 and gapped five healthy scopes. Their prior coherent support had bank Clock17:36:54 and actual expiry17:37:24, leaving6.883seconds at the gap callbacks. Recovery completed17:37:19.809. The generic catch therefore destroyed a valid observation interval before its existing data-validity deadline.

`PilotNativeFlow` now defers only explicitly recognized recoverable HTTP support-request failures. Existing HTTP cooldown and2/5/10/20/40/60-second bounded service backoff apply; no background task starts a request. Prior source/verification timestamps and ACK/window remain unchanged while they are actually valid. Failed refreshes never supply a newer audit ceiling or quote. Actual source/validation expiry gaps the affected scope; subsequent usable observation requires its actual new ACK and full window. Structural account/mint/fee/decoder refusals and resource/accounting failures retain fail-closed behavior. Unsettled HTTP work retains the shared physical gate and all uncertainty.

The final exact-hash verification passed81 focused tests and TypeScript build. It covers five-scope trace-shaped support timing, explicit retimed synthetic packet admission, bounded recovery, real provider retry floors, independent native controls, actual expiry and fresh rearm, structural refusals, and real `PilotRpc` integration with unfinished physical requests and late HTTP200/503 responses. A late response is never admitted as fresh support. A long provider backoff may outlive support validity; that state is exposed as unusable rather than extended.

Initial failed test assertions remain in the retained raw logs. The fixture originally replayed an old trade's program clock into the later support timeline; the existing program-clock safety check correctly refused it, so the fixture explicitly retimes that one field and labels it synthetic. Expired/suspended scopes require explicit rearm. The integration fixture also initially assumed an unsettled/open chapter was already immutable and that heartbeat must precede an already-due supported-state recovery; both assertions were corrected without weakening production checks.

No market requests, real ledger/database access, deployment, original observer changes, financial fills or strategy changes were performed here. All existing financial/quote-age requirements are unchanged. The next frozen forward interval must demonstrate the failure is contained under real HTTP refresh demand. Global transaction-cache pressure and the unresolved audit-wait/missing-data findings are separate work.

Reproduce:

```sh
node --import tsx --test --test-concurrency=2 test/pilot-native-flow.test.ts test/native-settled-recovery.test.ts
npm run build
```

`verification.json` records exact source hashes, commands, timestamps, exit codes and raw output hashes.

## Caller-cancellation review

The current candidate runner passes its global run-controller signal to native service; the3-second support service admission does not create a separate job AbortSignal. The retained1.249-second request settlement is therefore covered by the original repair. A further offline regression covers an independently cancelled1.2-second caller job: the failed HTTP operation may settle at1.249seconds while source-owned capture and prior support remain valid. Job cancellation now leaves capture intact without dispatching an automatic retry. Source stop and the actual information cutoff still prevent deferred recovery; existing source expiry and all accounting/physical-settlement rules remain unchanged.

The revised exact source passed84 focused tests and the TypeScript build. Three added tests exercise job cancellation, actual owner cutoff, and owner stop while HTTP is pending. Original81-test evidence remains unchanged; revised raw logs and hashes are in `cancellation-review-verification.json`. These are offline mechanics, not a new live interval.
