# Overnight continuation checkpoint — 2026-10-27 UTC

Owner explicitly authorized bounded multi-stage overnight research; no production
changes, trading, wallet operations, spending, Alchemy/Helius or paid feeds.
Review branch: poe-free-data-evaluation-20261027; remote checkpoint f4105b5.
Unrelated docs/FUNDING.md and operator/funding/ work must be preserved/excluded.

Starting linked usage verified:24units/377,058measured RPC bytes, no pending
reservation; original20-unit429 book and closed4-unit chapter remain unchanged.
PumpApi prior112MiB/100s reservations (actual106,994,938bytes); do not refund.
Ceilings240units/64MiB RPC-related; PumpApi256MiB/300s reserved; evidence32MiB.

Completed offline work: purpose-specific basic preparation needs0history reads and does not
require recent swaps; fresh full Clock/state/size/SDK checks mandatory. Separate
objective labels preserve basic results through later missing activity/failure.
Purpose-specific tests and433full-suite tests passed before final2reviewfixes;
focused review fixes also pass. ResearchHeldMarket now batches holdings/reuses
post-delay state; opt-in lazyquotes preservespredictiveconditions+slotfloors.
No production import of researchheldadapter; flowquality stillunverified. Next: live quiet-pool
Clock/pricing first, then multi-holding and active matched flow where possible.
Live01-basic PASSED:5HTTP/20,097bytes,2freshquotes on Dtc pool;40-byte Clock
owner/context exact,SDK parity exact,age8/5ms,independent getBlockTime recorded.
Live02-multi PASSED:5HTTP/29,383bytes,3distinctsupportedpools in16-accountunion,
2rounds/6quotes same-byteSDKparity,age17/8ms. All were quiet, no protectionclaim.
Linked cumulative34units/426,538bytes; no pending uncertainty/new429. 03-discovery currently holds the one authorized free migration-only connection (<=10min/5MiB,
stopafter3validhints), currently ACK only/no hints. Its2controlunits/236bytes are provisional on top of
the34unit closed total. Do not start another listener; parent session73167 is active.
After it ends, include its finalbook in all later baselinechains.
Then bounded activepool/feed work if suitable. Never reopen prior completed chapters.

Agents: component_budget prepares linked baseline reader; component_preflight owns
trader quote-deferral work only; component_parity owns isolated held-market batch
adapter/integration tests; component_review independent review only. Root owns
research runner and live network. One writer/dispatcher for research counters.

Production untouched this run; no fresh health claim. Original account/inception,
EC2 observer, Render and financial history preserved. PAPER/live entries disabled;
no acceptance clock. Update this checkpoint after each actual evidence milestone.
