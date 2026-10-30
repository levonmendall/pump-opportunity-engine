# Actual HTTP dispatch observations for the consolidated deadline repair

This change adds bounded metadata to the existing `http-lifecycle-timing` event. It changes no endpoint, agent, request method, request count, retry, parsing, byte accounting, response reservation, deadline or financial logic. The ordinary public endpoint remains `https://api.mainnet.solana.com`.

The unresolved live failure is 23 HTTP operations with no response headers before the existing 1.5-second timeout. Calling a fetch function does not prove its headers reached a socket. An unavailable response cannot be attributed solely to the provider without observing the local dispatcher path.

One invocation-local AsyncLocalStorage token matches an actual Undici request object against the exact endpoint origin/path and POST method. The subsequent send/headers/error events must reference that same request. Concurrent USD requests, requests outside that invocation context, and mismatched request objects are ignored. Each listener captures bounded primitive timestamps/codes only: no recording, filesystem operation, payload/header/address extraction, or escaping exception occurs inside a diagnostics listener. Listener cleanup happens in the HTTP work's actual `finally`, including when the logical timeout returned earlier but physical work remained pending.

The Node `client:sendHeaders` event is a pre-write hook, not proof that bytes were transmitted. Fields use `undiciSendHeadersHookAt` and `undiciSendHeadersHookCount` to preserve that boundary.

Opaque socket IDs come from a process-local WeakMap. `undiciSocketPreviouslyObserved=true` establishes that the same socket object was seen at an earlier instrumented request hook. A first observation does **not** establish a new connection or absence of previous uninstrumented use. Undici request error is not claimed as physical settlement. No origin timestamp, wire-byte measurement, remote CPU attribution or successful audit follows from these events.

Missing events, malformed observations and multiple matching requests/header sends are explicit unavailable/ambiguous metadata. Injected fetch test doubles without actual channels do not acquire fabricated dispatch timestamps. The runtime inherits its normal fetch dispatcher; it does not force connection reuse.

## Verification

`focused-tests.txt`: **93/93** HTTP dispatch, existing transport, component budget and shared RPC tests pass. `build.txt`: TypeScript build passes. The new tests exercise context/request isolation, privacy-sensitive getters, exact socket-object reuse across transport instances, absent channels, ambiguous sends, listener exceptions, allowlisted errors, aborts, and a logical timeout retaining observers until actual HTTP work ends.

A bounded local loopback server and the installed Node fetch produced actual create/send/headers events and socket reuse. This is offline networking to localhost only: no data provider, wallet, account or publisher was contacted. `node-channel-shapes.json` hashes the installed Node24 internal Undici source and records the actual inspected channel-publish shapes; synthetic published-event cases separately exercise failure boundaries. These observations establish instrumentation mechanics, not live provider latency or capacity.

Reproduce:

```bash
node --import tsx --test test/component-http-dispatch-timing.test.ts test/component-transport.test.ts test/component-budget.test.ts test/pilot-rpc.test.ts
npm run build
```

The parent must preserve the scalar fields in its bounded readback allowlist and validate them on the next sustained source-pinned interval together with the complete deadline-path changes. A successful loopback test does not resolve the earlier live failures.

Independent read-only review: GO after explicitly labeling the pre-write hook; reviewer independently reran30 timing/transport cases. No claim of a successful network write is inferred.
