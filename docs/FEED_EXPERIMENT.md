# Approved initial feed measurement — not acceptance operation

Owner approved 2026-10-26: at most 0.01 SOL/day, 0.04 SOL total over four days,
also $2.50/day and $10 total, whichever binds first. Maintain 0.02 SOL wallet
floor. No automatic top-ups, extra spending, or claimed four-day capacity.
This is approval for measurement, not evidence of a supplied/funded key.

Attach the separate data-billing key through managed environment **Secrets** as
`POE_PUMPPORTAL_API_KEY`; public billing address is `POE_DATA_WALLET`. Do not use
chat, source control, command-line arguments or Render. On verified EC2, use a
root-owned `/etc/poe/runtime.env` restricted to the poe-runtime group (0640) and
a systemd EnvironmentFile. Do not print environment, key, or WebSocket URL.
Keep the publisher secret separate. The data key is wallet-capable; no treasury
or legacy funds may be present. Verify the owner-supplied key/address relationship
without assuming any arbitrary public address proves which wallet the key bills.

Before network use, inspect environment credential readiness. A separate unfunded
provider wallet/key has now been created in protected storage outside git; it is
not installed in the runtime and metered authentication has NOT been tested.
The implemented free integration intentionally never loads this secret. See
[FUNDING.md](FUNDING.md) for the existing Turnkey funding-source dependency and
the source/destination/amount/fee checks required before transfer approval.

Next bounded experiment (requires attached key and implementation review):

1. Read the approved wallet's public balance with Solana RPC. Stop if the floor
   plus conservative remaining billable-event/charge reserve cannot be protected.
   Obtain fresh SOL/USD for both USD caps; missing valuation prevents admission.
2. Use one WebSocket for migration discovery plus a single verified newly migrated
   token's trade subscription. Redact all connection errors. Confirm an explicit
   subscription response and actual trade messages; an open socket is not auth proof.
3. Start with a 120-second maximum probe and a conservative 1,000-event ceiling,
   with additional headroom for in-flight messages and provider charge granularity.
   Do not disconnect/reconnect to pretend continuous observation. If a full
   60-second feature window cannot fit, report that failure and the measured rate.
4. Record raw field inventory, event identity quality, per-token/aggregate billed
   events, received bytes, unique wallets (not independent buyers), useful complete
   window seconds, receive/slot times where available, duplicates, gaps and RPC use.
   Preserve exactly when confirmations/corrections became available.
5. Project costs from observed rates and compare against owner-visible charge/
   balance changes. Provider message counts are estimates until reconciled. Reserve
   held-position monitoring before admitting candidates in the future runtime.
6. Before 24/72-hour gates, establish measured sustainable coverage and budget,
   including headroom and held positions. If insufficient, request a measured
   minimum daily/total budget and await approval; do not quietly shrink coverage.

At current documentation rates, 10,000 metered events consume 0.01 SOL. This is
only an arithmetic upper bound: event rate, billing granularity and safety
reserves may make useful observation much shorter than a day.

Primary references: [realtime](https://pumpportal.fun/data-api/real-time/),
[fees](https://pumpportal.fun/fees/), [FAQ](https://pumpportal.fun/FAQ/).
