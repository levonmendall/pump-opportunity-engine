# Coherent PAPER entry pricing and current admission telemetry

This is offline correction work following the actual a97799e original-account upgrade and adverse forward interval. No new account/service/ledger/channel, risk limit, strategy threshold, provider limit or financial schema change.

## Demonstrated problems and correction

The a97799e forward interval produced one qualified-but-unfilled candidate. Quote-unavailable is a broad final classification: private RPC/rent/quote traces remain inaccessible to administration UID994, so the precise live failure is NOT attributed to a particular provider or RPC. Code/fixture inspection independently proves unnecessary reads: entry-cost preparation performed three sequential pool/block-time reads plus current rent, then decision and delayed execution repeated the same three-read pattern.

The corrected entry path reuses the already tested supported-pool decoder and coherent same-bank Clock transport for actual-size BUY pricing. Only dependency links are cached; current pool/config/fee/mint/vault/Clock bytes are physically read each time. The exact original SDK BUY arithmetic is extracted unchanged; SELL validation remains intact. Clock evidence remains explicitly distinct from block time. Every decision and modeled execution still obtains a fresh quote; no favorable earlier/later price substitutes for execution-time evidence. Current rent is reread, fees embedded once, gas separate, deposit/slot floors/generation/inventory rechecked, original receipt time retained, <=2s quote and<=30s Clock validity unchanged. Timeout returns unavailable while retaining module ownership until underlying operation settles.

Token2022 controlled fixture: cold preparation+decision7physical reads versus10 before; fresh post-delay execution3 versus5. This is lower measured demand, NOT a guarantee under provider latency. A cold flat lifecycle still needs up to10starts; existing held contexts can bring it to12. Six-start rolling-headroom admission remains only a heuristic and cannot promise that entire sequence or continuous protection. Two slow rent reads after state receipt can still consume validity and correctly refuse. No request limit or timeout was raised.

Another code/fixture defect was corrected: a fully occupied position limit could still perform expensive candidate preparation before the trader's later capacity rejection. The frozen maxPositions limit is now checked before proof/cost/quote work, both in outer admission and bridge. Pending BUY obligations count. Controlled tests verify0unnecessaryreads/pins at capacity, preserved pending orders/ledger, continued held management, and preparation when the approved next stage has a genuinely free slot. This enforces the existing limit earlier; it does not permanently restrict candidate/position architecture.

Bounded detailed quote/cost records are protected financial evidence during candidate/pending/protection work; unrelated provider diagnostics remain rotating. The existing intelligence payload gains an OPTIONAL bounded admission group exposing actual financial projection, supervision, resource/evidence admission, diagnostic pressure/bytes, source recovery and proof state. Unknown facts remainnull, reasons use safe static codes, and old payloads remain valid. No new endpoint/channel or dashboard-side financial calculation. Receiver compatibility must deploy before a source emitting the new group.

## Verification

Full repository1705tests PASS; exact final tested file hashes in final-tested-source.json. Initial full-suite failure is retained: compilation saw a new disposable fixture's optional timestamp type before correction. Corrected full suite then passed; product source remained unchanged. Focused coherent BUY57, native capacity4/related16, evidence hooks6, forward upgrade28 and supervisor27 tests PASS; buildPASS. Independent review found no remaining financial safety blocker in these changes. Logs retained. These are offline fixtures, not forward fills or profitability evidence.

## Original-account upgrade continuation

The next helper is prepared for actual installed a977source/nativea442/manifest e7a0/helper1c99. Original indexed root helpers2b/auditor089/supervisord90/indexfa remain separate and immutable. Prior transition is forward-a977 with packageindex0a98. Fresh live/stopped backups, whole-prefix audits including all newer trades, same inode, native+cgroup settlement, exclusive financial lease, known configuration images, durable possible-start intent and retained financial-capable recovery remain required. No database restoration, initialization, reseed, obsolete-observer rollback or new writer.

Actual new executable/deployment pins will be recorded after committed-source build. These changes are NOT yet installed on EC2. Original service keeps running a977 during development. Root-only installation remains a genuine access boundary, not a request for financial authorization.
