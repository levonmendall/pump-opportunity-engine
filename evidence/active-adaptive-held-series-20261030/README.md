# Active Adaptive Momentum v2: executable holding signals

This continues the original service's authorized v2 implementation from source5675961. It creates no account, service, provider request, financial writer or reporting interface. The original EC2 source567 is already active v2; this follow-up component is **not installed until a subsequent exact source-pinned deployment is verified**.

## Capability audit

Existing active v2 supports complete independently audited 60-second entry windows, liquidity-normalized demand scoring, broader verified migration ages, independently qualified re-entry, two holding slots, four deep slots, a 15% cost stop, persistent executable SOL high-water tracking, and profit trailing without a fixed positive take-profit or unconditional profitable 15-minute exit. Early/older age cohorts route evaluation; older age alone does not prove consolidation or reacceleration. Wallet-address participation does not prove independent beneficial ownership.

The actual Trader did not supply the already implemented optional volatility, momentum or liquidity-deterioration inputs. Its profit trailing therefore always used the 15% fallback. This change supplies **descriptive measured volatility from existing executable holding marks**. Momentum-flow deterioration, liquidity withdrawal/stability, beneficial-owner independence and net expected continuation value remain unknown unless independently evidenced; this change does not manufacture those capabilities.

Dynamic position sizing and portfolio risk allocation remain the explicit $50 entry/$150 aggregate legacy fallback. The code has a pure stress projection, but the active acquisition path does not yet provide validated size-dependent adverse liquidation scenarios or a demonstrated portfolio loss budget. Changing these dollar limits from a signal score alone would manufacture economic risk evidence. This limitation is technical input availability and protection, not a shadow-profitability certification or minimum-trade-count promotion requirement. Further holding capacity also remains two, independently of four observation slots.

## Implemented correction

`AdaptiveHeldSeries` retains a bounded 60-second series of fresh, distinct, same-unit net-liquidation SOL marks per round trip. It computes the sample standard deviation of signed consecutive returns in basis points using **only prior quotes**. Three prior quotes are the mathematical two-return minimum, not a profitability sample target. It does not annualize, forecast, use displayed chart prices or include passive SOL/USD movement. Actual observed interval range and sample provenance times accompany the decision record.

The existing pure adaptive exit receives the measured input. Its absolute 15% cost stop remains unchanged. Profit-trailing width changes only at a new high-water, and even then cannot lower the preceding modeled executable trailing boundary. A current reversal cannot increase its own allowance, including on the next evaluation. That boundary is a modeled strategy trigger, not a guarantee of an achievable exit price.

An unavailable, stale, conflicting, future, wrong-size or regressing source resets only that holding's optional series. A protection gap over the existing four-second boundary, changed round trip or quantity, and process restart return to the existing 15% fallback using the **durable ledger high-water**. This can tighten protection and trigger an exit that a wider pre-restart trail would have retained. The sampler is intentionally not financial state; adding durable trail-width state would require a separately reviewed accounting change. Samples from another position or completed round trip are never reused.

The Trader adds no request, subscription, persistence operation or diagnostic record. Existing mandatory `trader-context` and `trader-held-evaluation` records retain the acquired marks and decision inputs. Fresh SOL observations remain usable during an honest USD-quote failure, while original financial entry permission still closes. The source, accounting, duplicate-order, pending-exit and current execution-quote safeguards are unchanged.

The read-only `adaptiveHoldingDiagnostics()` projection returns copied fixed fields for current V2 holdings, internally bound to the exact round trip and quantity. It preserves original quote/evaluation times. Missing, stale, future, malformed or expired source evidence reports unavailable with no active-width claim. Calling this projection cannot acquire prices, evaluate protection, record a completion, refresh timestamps or alter financial state. The parent integrates its bounded output into the existing native source and Render notes; there is no second reporting system.

## Validation

Focused tests exercise measured active hold/exit behavior, current and later crash handling, a nondecreasing boundary, unchanged cost stops, two positions, unavailable USD, restart fallback, duplicate/conflicting observations, freshness/source gaps, quantity/cycle separation and bounded retention. The independent review separately probes 10,000 seeded observations. Exact-source full-suite/build results are retained separately.

The synthetic local cost measurement in `offline-cost.json` observed 3,600 checks for two holdings over a simulated hour: 31.49ms total wall time, 0.0873ms p99 and 0.6532ms maximum call; 62 quotes retained. This is **not an EC2 resource measurement or operational acceptance**, and the heap delta was not controlled for GC. No profitability or live protection improvement is claimed by these offline checks.
