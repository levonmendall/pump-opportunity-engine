# One owner action — bounded PumpApi/public-RPC follow-up

Alchemy is excluded from this assignment. No Usage screenshot, Alchemy test,
Helius access, replacement key, wallet funding or infrastructure action is needed.
The observer, original account/inception, Render viewer and financial history
remain unchanged.

**Approval requested for one revised test allowance:**

- **256 MiB cumulative PumpApi receipt**, including all prior captures; this
  raises the existing128MiB cap by128MiB.
- **5 minutes cumulative provider observation/reserved time**, including the
  prior100seconds reserved. This is stricter than the existing30-minute ceiling.
- **One90-second active-pool capture**, plus5seconds shutdown reserve; reserve
  128MiB before opening. Prior112MiB +new128MiB =240MiB reserved, leaving16MiB
  unmetered transport/in-flight headroom. No automatic retry or second empty test.
- **At most240 additional public-RPC reads and64MiB RPC responses** for the
  combined preflight, pricing, enrichment and audit workload. Keep32MiB total
  retained evidence, one socket/IP and no production/financial writes.

Only16MiB remains unreserved under the present byte cap. A complete70-second
window needs about83.75–96.17MiB at the measured rates. Existing reservations are
not reset/refunded, and no new stream has been opened.

After approval, first verify a supported pool's current activity within the
bounded preflight and confirm its enrichment rate fits reserved pricing capacity.
If no suitable pool fits, do not connect. The experiment includes exact-size
hypothetical pricing at a2-second attempt cadence and explicit unknown/stale
periods; it does not weaken the at-use2-second freshness requirement. The current
production client's60/minute limit is unchanged. An isolated aggregate research
limit of150starts/minute/30per10seconds would be enforced separately.

API/data fees remain$0 under the documented credential-free/public paths. Existing
Cloud infrastructure/transfer allocation is unverified; this request does **not**
authorize any new charge, paid service, plan change or EC2 deployment. No funding,
PAPER entries or live trading. Full arithmetic, RPC allocation and stop conditions
are in `evidence/free-data-20261027/active-capture-proposal.json` and
[FREE_DATA_EVALUATION.md](FREE_DATA_EVALUATION.md).
