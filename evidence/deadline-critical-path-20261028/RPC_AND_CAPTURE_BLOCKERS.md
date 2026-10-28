# RPC, capture and local execution blockers of ready audits

Read-only mapping of frozen `c189a54b7978692ef2f7d098d6b3374aea8deb72`; no implementation, provider requests, account opens or deployment. This is one input to the complete runner/financial deadline map, not a replacement scheduler proposal.

## The shared physical path

`NativeCandidateRunner` selects a logical page → scheduled caller computes admission → `PilotRpc.call` checks method/query/global gates → `PilotRpc.perform/openChapter` acquires the wrapper's sole logical operation → `ComponentBudget.operate` acquires `busy` **before pacing** → durable response reservation → actual invocation → HTTP headers/body/EOF → JSON and envelope validation → operation settles and durable accounting → audit-domain validation → predictive admission. A selected logical job is not a physical start, a complete HTTP body is not a valid audit, and logical cancellation is not physical settlement.

| Blocking mechanism | Exact current implementation | Effect / evidence classification |
| --- | --- | --- |
| Physical HTTP or WS control already in progress | `pilot-rpc.ts:119–127,151–156`; `component-budget.ts:120–124` | All transport domains share one slot. Cannot preempt an invoked operation by changing queue priority. Demonstrated shared design; correlate a particular miss with physical events before attributing cause. |
| A job waiting for pacing already owns wrapper/budget | `component-budget.ts:122–134`; `pilot-rpc.ts:153` | `busy` and wrapper `active` include sleep before physical invocation. A later urgent job cannot enter while that wait is active. Latest-start/admission checks fail closed; they do not provide preemption. |
| Aggregate starts, spacing and inherited starts | `component-budget.ts:96–101,128–138` | The maximum of 250ms spacing, short-window, minute and `notBefore` waits applies. Research PAPER configuration is60/minute and20/10s; no provider entitlement follows. Counters and reservations survive chapter transitions. |
| Per-method getTransaction pacing | `pilot-rpc.ts:103–116,217–220` | Up to8/10s if configured. **Not applied directly to getSignaturesForAddress audits**, but competing verification/enrichment may consume common capacity. Do not blame the method cap for every history delay. |
| Pool-local history timeout cooldown | `pilot-rpc.ts:207–215,221–234` | Same-pool history backoff2/5/10/20/40/60s. Three distinct timed-out queries in10s escalate to global recovery. No retry is started internally. Eligibility changes while a logical audit target is aging. |
| Global HTTP provider recovery | `pilot-rpc.ts:179–203,302–312` | 429/actual overload and applicable transport failures defer HTTP. Retry-After includes a5s reserve; default42965s. Fresh notifications and WS-control domain do not intrinsically inherit HTTP cooldown. Old capture-coupling repair remains necessary and intact. |
| WS-control cooldown / connection recovery | `pilot-rpc.ts:166–167,294–312`; `pilot-native-flow.ts:228–259,270` | Control and HTTP recovery are separate failure domains but still share the actual physical slot/rate budget. A live socket cannot establish a healthy outgoing round trip by incoming notifications alone. |
| Nonpreemptible HTTP headers/body/EOF | `component-transport.ts:32–58` | Physical timeout≤1500ms; headers, first/last chunk, EOF, decode time are separately recorded. Body cancellation is awaited. Existing first run had33physical HTTP timeouts; batch partial-body and single no-header patterns differ. Connection reuse is explicitly uninstrumented. |
| Abort settlement after logical timeout | `component-budget.ts:155–163`; `pilot-rpc.ts:129–132,302–312` | `Promise.race` can reject before physical `operation.finally` decrements `active`. Pending uncertainty and the busy gate remain. All scheduling changes must account for this tail; clearing a logical flag cannot grant another physical slot. |
| Cancelled subscription/unsubscription | `pilot-native-flow.ts:202–211` | Cancellation terminates transport; errors/late ACK cannot complete physical ownership before actual close. ACK parsing/dispatch and wire receipt are distinct. Existing two-lane experiment is isolated/off, not an adopted escape from these guards. |
| Chapter recovery/persistence | `pilot-rpc.ts:129–149`; `component-budget.ts:65–75` | Only after actual settlement, close old budget, append summary, re-read linked baseline, create next budget/lock and persist. These synchronous operations can consume logical deadline slack. No measured per-recovery live latency is supplied by this map. |
| Durable invocation reservation and receipt accounting | `component-budget.ts:88–92,136–158` | JSON encoding, write, fsync, rename and parent fsync are synchronous. Actual invocation is stamped **after** reservation latency and checked again. Each received WS chunk charges its bytes durably; all JS callbacks share that event loop. Correct accounting cannot simply be removed/coalesced as if it were optional telemetry. |
| Derived RPC status persistence | `pilot-rpc.ts:78–99,283–286` | Receipt status coalesces only the derived view with a non-sliding1s timer. Actual counterbooks remain authoritative per receipt. Timer flush can block page dispatch and timeout handlers; its reported source age remains honest. |
| Native notification decode/validation/evidence | `pilot-native-flow.ts:76,85,195`; actual accept path | Chunk accounting, UTF8/JSON decode, supported event validation, feature insertion and synchronous selected-evidence write run on the same event loop. Bound250ms callback processing and5s usefulness are validity limits, not time reserved by the logical audit scheduler. |
| Watchdog safety, CPU/RSS/retention/cutoff | `pilot-native-flow.ts:77–82`; runtime processing reserve | Source expiry, peer-PONG deadline, resource caps or mandatory evidence overflow can invalidate a scope/source. These are real coverage losses, not strategy rejection. They must appear in an end-to-end denominator. |

## Native service ordering is a second scheduler

`PilotNativeFlow.service` (`237–247`) chooses fixed order: peer-PONG → gapped/retiring unsubscribe → union support validation → close/upgrade → pending subscribe → heartbeat. `nextService` (`266–278`) returns the **first due action** in that same order; only future actions are sorted by time. Therefore ready-audit priority at the outer scheduler is insufficient by itself. It must distinguish mandatory peer/liveness work from discretionary replacement support/subscribe work, and use the same view for planning and actual service.

Support refresh is a coherent union over selected candidates and can include newly allocated ones (`243`). It can be requested early (`223`) to obtain the audit's confirmed-bank ceiling or move a support deadline away. ACKs and managed PONGs renew the ten-second heartbeat based on conservative current-connection receipt (`215–220`), so early service changes the subsequent observation phase. Both planned and actual phase changes belong in the audit budget. Failed HTTP refresh preserves healthy notification capture; only actual expiry invalidates it (`227–258`).

Retirements are not free: they release logical slots but leave physical unsubscriptions (`84`, `242`). A replacement must not consume the runway of an already-ready page, yet indefinitely withholding replacement also loses opportunity coverage. A coherent admission policy must price the setup/retirement chain before allocating a slot, rather than only check that a map has room.

## Measured local costs and important unknowns

From first PAPER metadata (`paper-first-readback/artifact/final-status.json`, native-paper-20261028195247298):

- RPC wrapper persistence:1272writes,6761.784ms total,11.158ms maximum.
- Passive receipt calls14953;14786coalesced derived-status receipts;439timer flushes; maximum observed dirty age1020.308ms.
- Native processing last256retained samples:p95 2.946ms/max4.976ms; queue agep95 593ms/max618ms; source event-loop delayp95 25.428ms.
- Source CPU180.253s triggered the resource reserve; **none of the figures above proves its full attribution**. Closed chapter persistence is absent from final status. Repeated local usage/snapshot computation, TLS/framing/copies/GC and reporting need whole-runtime or bounded phase profiling if they are implicated.

These measurements establish nonzero synchronous cost and observed queuing, not that fsync or JSON caused a particular timeout. Twelve prior batch HTTP envelopes stalled after partial HTTP200 bodies; singles' no-header timeouts are a separate phenomenon. No provider saturation or connection-reuse result can be inferred from average request demand.

## Requirements for one coherent contention correction

1. One inventory of ready audit pages, native service actions, financial work and discretionary setup, each with eligibility, actual deadline, bounded physical cost and post-settlement/local-validation allowance. Retain strict quote≤2s, source freshness and original target bucket cutoff.
2. Use the **same action classification** for outer admission and native service execution; an early support/heartbeat request must not unexpectedly dispatch a different discretionary action.
3. Do not let pre-start pacing or an ineligible/cooldown head item monopolize all urgent ready work. Any release/reselection must occur before physical invocation and preserve charged reservations/actual settlement; no second hidden provider budget.
4. Reserve end-to-end runway, not only transport timeout: account for gate/pacing, control/support preparation, HTTP/body, cancellation settlement, domain decoding, audit validation, predictive dispatch and any blocking local work.
5. Backpressure replacement/verification and suspend incomplete candidate windows during exceptional financial/protection recovery. Count lost coverage separately; never mark unfinished targets complete.
6. Record a joined trace from feature-close through validated decision, including selected-but-not-exposed returns and local timer lateness. Maintain independent clocks for logical expiry and actual physical settlement.
7. Validate the complete change set together: simultaneous3/6ready candidates, multi-page busy histories, varied service phase, pending actions/holdings, late ACK/HTTP cancellation, 429/503, delayed sync persistence/CPU, reconnect and sustained bursts. Then run the unchanged strategy against real demand. A quiet forward interval or synthetic schedule alone cannot establish combined capacity.

No implementation is proposed as already sufficient; the parent runner/financial map and current c189 forward traces must select the coherent change set.
