# Original PAPER financial-policy reporting

Final application source: `d627fe7ab24b0932223cadf021928228eaa6eb6a` (reporting commits `9dc15fc` + `d627fe7`, based on the protected `a1c16c7` source). No financial, strategy, scheduling, provider, or host operations were changed.

The existing source snapshot transports three bounded optional groups through `intelligence.financialPolicy`, version `poe-paper-financial-policy-v1`:

- `status.financial.equityRisk` → source-owned 500-bps consumed-cost preview and 1,000-bps daily observed USD-equity drawdown policy. Refundable rent is excluded from consumed cost and separately reserved. Cash-limited preview is before token-specific rent, liquidity, and full entry safeguards; it never grants executability or entry permission.
- `status.usage.market.executionModel` → current-adapter preparation counters and the last fixed phase/reason. A supported landing state is fresh quoted state and matching unsigned intent after a modeled delay; it is not a financial fill or observed blockchain landing. Legacy held-exit protection fallback is separately counted and cannot claim new-model fidelity.
- `status.usage.usd.lastObservation` and fixed failure counts → current-source observation of SOL/USD conversion. Application receive time is explicitly not known oracle publication time. These observations cannot reconstruct earlier unknown outages.

The pure projection reads only allowlisted facts. Unknown versions, malformed amounts, unsupported reasons, future timestamps, and inconsistent complete arithmetic tuples become unknown optional facts without changing account controls, the actual entry blocker, held positions, or financial history. The receiving strict validator rejects malformed public optional objects. Old source snapshots with no policy remain valid and never acquire inferred 5%/10% limits or historical peaks.

Complete integer tuple validation matches the source policy:

- Target microUSD = floor(current equity microUSD × 500 / 10,000).
- Drawdown = max(observed high-water − current equity, 0).
- Drawdown bps = floor(drawdown × 10,000 / high-water), or 0 when high-water is 0.
- Threshold distance = max(floor(high-water × 1,000 / 10,000) − drawdown, 0).

Displayed SOL allowances preserve the source integer conversion; USD is not reconstructed from a floating display exchange rate. Known previous-day peaks and partially known unavailable tuples remain explicitly dated/unknown. A current equity value above the last retained peak is valid, with zero drawdown; the projector never writes a new peak. A historical daily loss latch can remain active after a rebound. The Portfolio card labels remaining allowance as latched while that latch is true, instead of implying reusable headroom.

`verification.json` records 85 focused tests, TypeScript build, and an exact before/after source-byte guard. `initial-9dc15fc/` retains the earlier valid source guard before review-driven arithmetic/fallback refinement. `check-owner-compatibility.mts` and `owner-compatibility.json` verify new and legacy source snapshots through the original owner receiver, preserving identity/source acceptance and a safe-stop blocker. These are synthetic, read-only compatibility fixtures, not trading or market evidence.

The owner receiver must deploy its backward-compatible optional validator before a native source emits this new field. No receiver, service, provider, financial database, live account, or deployment was touched by this work. The source-owned obsolete `$50/$150` active-policy prose must be corrected by the financial integration owner after verified ledger activation; this reporting patch does not launder source meanings based on a strategy name.
