# Owner checklist — offline design review complete

**No owner-only action or additional budget is requested.** Alchemy/Helius,
wallet funding, credentials, infrastructure and production changes are outside
this work. No live measurement was run or automatically scheduled.

Selection pacing and persistent rejection handling are implemented and tested
offline. Current two-call pricing plus per-transaction flow enrichment cannot
fit 60 RPC/minute. A research-only one-call Clock-batch path has a conditional
one-candidate/one-held-pool budget; it needs component and combined live validation
before any production use. See [FREE_DATA_EVALUATION.md](FREE_DATA_EVALUATION.md).

A specific next measurement is prepared as a proposal only: a 30-second field sample,
then separate RPC-only changing-price validation. Neither this document nor the
existing unused allowance authorizes execution or clearing the completed429.

Authoritative counters remain 20/240 requests and 272,634/67,108,864 bytes;
220 requests/66,836,230 bytes remain. Preserve all grants, reservations and evidence.
Observer/account/inception, financial history and dashboard remain untouched.
PAPER entries/live trading disabled; no acceptance clock.
