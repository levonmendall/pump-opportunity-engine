# Independent protection / RPC critical path map

Source: installed application 93bf0b5; no runtime, provider or financial action performed.

1. `run-native-paper.ts:332–333`: pending actions precede ordinary protection. Held protection is due every 2,000 ms from the **previous attempt start**, including an attempt refused before a physical call. The loop is serial and awaits every operation. A failed attempt therefore postpones the next opportunity even when it did no physical work.
2. `native-paper.ts:51–53`, `trader.ts:226–231`: whole-inventory context uses the dedicated held pricer but a 3,000 ms whole-operation timeout. Its timer includes pacing, initial link discovery and the fresh union batch. Physical settlement remains separately owned after logical cancellation.
3. `pilot-market.ts:81–86,214–218`: held and discretionary SDK pricers have independent busy locks and slot caches, but share the same PilotRpc physical gate and provider budgets.
4. `research-clock-pricing.ts:134–158`: warm holding pricing takes one fresh Clock/pool/config/mint/vault union batch. Cold pricing takes initial pool discovery plus that union batch. No price is cached. `185` clears all validated dependency links after ANY attempted-read failure; transport/abort/admission failure thus makes the next recovery unnecessarily cold. Actual decoder/link mismatch already invalidates the affected pool independently (`170–176`).
5. `pilot-rpc.ts:130–138,172–210`: one active physical operation. Primary HTTP defaults to a 1,000 ms physical timeout. A primary timeout, transport error, caller abort or RPC -32016 node-lag refusal enters one shared primary exponential cooldown (2, 5, 10, 20, 40, 60 seconds). No financial job class is distinguished from discretionary primary calls.
6. `component-budget.ts:146–158,177–185`: request pacing happens before the physical timeout timer. One operation holds the gate while pacing. Logical timeout does not prove physical settlement: `inFlight` remains nonzero until the actual transport finishes. Required byte uncertainty and reservations remain conservative.
7. `pilot-rpc.ts:212,243–249`: fixed PublicNode history requests have a separate history cooldown; controls have their own cooldown. A single history timeout does not directly impose a primary HTTP cooldown. Actual shared physical occupancy/rate usage can still delay financial work.
8. `component-transport.ts:93–129`: inherited fetch dispatcher remains in use; the code does not instantiate a fresh HTTP agent per call. Existing Undici instrumentation measures request creation, send-headers hook, response headers, body/decode, socket observations and timeout callback lateness. A first observed socket is not proof of a new TCP connection.
9. `pilot.ts:162–169`: discretionary admission reserves 1,200 ms for protection plus setup margins against a 4,000 ms completed-evaluation boundary. That is suitable only for the expected warm one-call holding path, not an arbitrary two-call cold recovery. New ready-audit early protection (`native-held-audit-scheduling.ts`) explicitly requires known warm one-call pricing and retains both rolling quota reserves.

## Deterministic timing conflict from source

With last success at t=0 and next protection start t=2 s, a single physical timeout at t=3 s creates primary cooldown until at least t=5 s. An immediate attempt at t=4 s is refused by cooldown but resets the launcher attempt timestamp; the next normal physical opportunity is t=6 s. Therefore the software policy itself forces a completed gap greater than four seconds even if the provider recovers immediately after the one-second timeout. This does **not** establish which actual timeout or transport delay caused each live gap.

## Focused reproduction recommendations

- Warm a real SDK held fixture, inject one settled physical timeout with no overload/Retry-After, then restore ordinary ~100 ms responses. Record all attempted/physical/completed timestamps through the actual PilotRpc + launcher policy; current behavior must show cooldown and attempt quantization producing >4 s gap.
- Warm validated pool dependency links, fail one read for transport/cancellation, then succeed. Current recovery requires two physical reads; retaining only verified address metadata would permit one while all price/reserve/Clock bytes remain fresh.
- Mutate actual decoded pool dependency links to prove stale links never authorize a mark: refuse the inconsistent pool and rediscover through the unchanged decoder, with unaffected pools independent.
- Preserve tests for late 429/503/Retry-After, un-settled physical requests, byte uncertainty, original pacing/quota, old/future Clock, actual-size marks and independently failed evidence.

## Engineering implications

Separate explicit provider throttling/Retry-After/overload from one settled deadline cancellation or node-context refusal. Do not simply remove cooldowns or raise deadlines. Any prioritized recovery probe must be bounded, respect actual physical settlement and every rolling provider limit, and use remaining protection runway. Reconsider scheduling failed **uninvoked** probes from actual dispatcher readiness rather than consuming a whole ordinary two-second cadence. Retain validated dependency links through failures that provide no contradictory pool state. True outages can exceed four seconds; entries must remain closed then.

No source changes, tests, live repairs or operational success are claimed by this independent map.
