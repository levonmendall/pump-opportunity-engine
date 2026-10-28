# Native protocol-control recovery repair

The actual forward source63f4/run40704936322 stopped itself after433.623seconds.
Sequence2219 records one opcode8 library close outside a managed operation at
14:27:40.994UTC, while getTransaction5029 occupied the shared gate. The next record
is WS_ERR_INVALID_CLOSE_CODE; connection5 then closes1006. The pinned ws8.22
receiver error handler calls close(1002) BEFORE its public error event. That
implicit protocol response bypassed the caller's dispatcher, and the source
correctly refused to continue with an unaccounted physical operation.

The original failed run and its actual extra unit remain unchanged. Root must
append that unit conservatively when linking its settled books; this repair
cannot erase a past send, provider charge or reservation. The selected actual
trigger records and exact pre-repair source are retained here.

## Small correction

The existing sender interposition now suppresses an unmatched automatic control
BEFORE invoking original sendFrame/socket.write. It records an attempted,
not-sent control, calls the library callback with an error once, and terminates
only that unusable transport. Existing disconnect, backoff, gap invalidation and
fresh-subscription warming remain required. It dispatches no background provider
operation, manufactures no historical request start, and changes no budget schema,
provider allowance, financial state or historical evidence.

Explicitly scheduled close/ping/pong remain on the existing one-flight shared
gate and remain counted. Matching additionally binds the exact connection, so a
late old-connection library call cannot consume another connection's operation.
The existing unmanaged-unit source safety guard remains in place. Recording
failure still fails closed. `protocolFrames` is a conservative managed sender
invocation-attempt count, not independent proof of successful wire delivery.

A bounded `native-flow-control-refused` record now preserves the safe internal
reason before generic ComponentBudget normalization, with method, mint/pool,
connection/opid, typed returned-subscription shape, active/retired-ID match,
support/cancellation state and numeric RPC error code. It retains no raw provider
message/result and does not weaken ACK, freshness or retirement validation.
The known prior generic ACK failures remain unexplained until new diagnostics
are observed forward; no provider/saturation cause is invented here.

## Offline evidence

`native-control-recovery.test.ts` exercises the REAL pinned ws parser and sender
over an in-memory Duplex: no listener, endpoint, network, wallet or ledger.
Three tests failed before repair because real unbudgeted close bytes were written.
They now pass, including invalid-close processing while another operation stays
occupied. A fourth real-ws test proves the ordinary managed close handshake still
writes one counted frame and settles. Existing native tests additionally cover
fresh ACK/reconnect, explicit ping/pong, retired-ID safety and old-connection
isolation. New malformed/reused ACK and numeric RPC-error tests prove diagnostics
remain bounded and existing refusals remain enforced.

Raw logs retain the initial3/3 negative result, the first118/118 focused pass,
and a later120/122 test-drafting failure (two ACK fixtures accidentally used the
one-candidate cap). Only those fixtures were corrected to request two candidates.
Final focused verification:122/122. Full repository verification:1208/1208;
`npm run build` and `npm run compile` passed. All source/test hashes, exit codes,
timing, raw-output hashes and independent read-only review are retained. No
forward market run or financial readiness is claimed by these offline results.

Reproduce from this worktree with installed pinned dependencies:

```sh
node --import tsx --test test/native-control-recovery.test.ts test/pilot-native-flow.test.ts test/native-candidate-runner.test.ts test/pilot-rpc.test.ts test/component-budget.test.ts
npm test
npm run build
npm run compile
```
