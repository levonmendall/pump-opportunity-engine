# Source93 local ABORTED mechanism

The new live episode increased held-pricing ABORTED without increasing physical HTTP timeout counts. That is compatible with a real missing-price/protection interval caused locally; it does not prove that the provider failed or that the dashboard misclassified an available mark.

## Actual source signal owners

- `native-paper.ts:51–53`: normal holding context receives the signal created by `PaperTrader.read`.
- `trader.ts:226–231`: that request has its own whole-operation3,000ms controller. It includes budget pacing, discovery and fresh union reads. Its final abort after a successful settled read is harmless; abort before settlement cancels only that context.
- `execution.ts:91–102`: pending-order preparation has a separate controller bounded by the financial action deadline and configured timeout. No pending order was observed in the cited episode, so this path is not established as its cause.
- `pilot-market.ts:137–148,180–186`: candidate SDK preparation and buy quotes own separate controllers. `run-native-paper.ts:290–297` calls protection without passing the candidate signal; protection creates an independent controller. No candidate cancellation leak was found in this map.
- `component-budget.ts:146–158`: pacing happens before the physical timeout is armed. A caller can therefore expire while waiting for rolling capacity with zero provider invocations and zero physical timeout events.
- `component-budget.ts:173–183`: an invoked operation canceled by its outer deadline can be ABORTED instead of PHYSICAL_TIMEOUT if it starts late enough in the whole3s context. True physical timeout records a distinct event/counter. Real in-flight operations remain gated until actual settlement.
- Budget halt/storage failure may also abort an active controller. The current healthy evidence/resource projections do not establish that this happened.

## Reproduced with actual PilotRpc

`test/held-abort-admission-repro.test.ts` runs against exact source93. All responses are synthetic and immediate; no network or financial account is accessed.

1. Twenty valid recent short-window starts force9+s of local pacing. The real3s caller controller aborts before any physical invocation. Error maps to HELD_PRICING_ABORTED; physical starts/timeouts/newunits/cooldown are allzero.
2. The existing latestStartAt option rejects that impossible request immediately with COMPONENT_DISPATCH_EXPIRED, without a3s sleep or a provider request. This is admission classification, not a completed protection success.
3. A valid85-start history respects20/10s,90/minute and minimum spacing. One fresh call leaves exactly4 short/minute starts and source93 permits candidate work. Four following2s financial obligations consume the minute headroom. The next obligation waits5s for the oldest start to expire and is canceled after3s, again without a new provider invocation or HTTP timeout.

The third case proves that fixed4-start headroom is insufficient for known financial obligations before existing starts expire. Planning must account for expiry chronology and future required protection starts rather than merely checking the current free-start count. The parent owns the coherent scheduling repair; this commit does not change admission or deadlines.

The reproduction proves a source mechanism, not the exact origin of the observed00:18 live episode. Its private physical-start/pacing/abort chronology is unavailable. Keep that attribution UNKNOWN until actual events establish it.
