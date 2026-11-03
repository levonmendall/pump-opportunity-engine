# PumpSwap migration-age admission

Owner-approved market scope: verified canonical PumpSwap migration age from 60,000 through 86,400,000 milliseconds, both boundaries inclusive. Mint-creation time, discovery time and refreshed pool/activity time cannot substitute for the migration timestamp.

The upstream qualifier obtains and retains the migration proof. Deep slots carry an immutable eligibility/expiry interval and use a local clock comparison, with no age-history requests. Mint-creation transaction lookup is not an active dependency of persistent V3.1 admission. Missing migration proof defers that candidate only.

PumpSwap-only scope, four observation slots, V3.1 economics, actual-size executable prices, source/audit freshness and PAPER-only execution remain unchanged. Existing holdings keep their exit policy after age expiry. Financial account and history are not reset.

The dashboard current-UTC-hour count measures newly admitted registry identities, not all on-chain launches. Runtime diagnostics separately identify migration verification pending/eligible counts.
