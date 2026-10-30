# Second corrected forward interval — actual failure attribution

**Decision: measured repair gains, but this configuration is inadequate for reliable busy six-slot continuous qualification.** It is a useful candidate-only interval, not PAPER execution or acceptance. No financial ledger was opened.

Source`71896104f07faa2b193b90d3d3133a8e29236f35`, bundle`80071522cc6943b5ff743f3106904641bf4e21cac5ffdd6c96b8ee7566dd91e3`, administration run40735836963. Actual source start **17:27:13.245 UTC**, logical cutoff **17:42:03.245**, stop request **17:42:03.246**, final status **17:42:03.575**,2026-10-28. The label172800 is not its actual start timestamp. The verified124-file archive is22,036,792bytes with SHA256`d34137bfcdeb0bb33af05ddd6838d6f9d2a3ff2a0d09d559d701ed3983f52a5b`. Source/application/publisher transports settled; raw evidence remains private. Adjacent analysis JSON records source/configuration, event-file hashes, exact target outcomes and timing.

## Repairs genuinely exercised

- **23 same-filter subscription rebindings succeeded.** Zero ID-reuse control refusals and zero shared teardowns from previously retired same-pool IDs. Two ambiguous generation packets correctly invalidated only their own candidate.
- **17 candidate-history timeouts were query-isolated**; no query outage escalation occurred. Peer candidates received valid decisions after isolated failures. Actual provider429/503 was not observed, so that recovery behavior remains offline-tested rather than a live pass.
- **A real post-snapshot tail repaired corroboration:** the4Ytm5 target ending17:30:00 matched two actual late diagnostic packets to independent interior history and verified. Target features and availability were not backdated.
- **Multipage history worked under activity:**2oN2Zx target ending17:36:10 verified2,054 required signatures over three pages in2,507ms. Another busy target(G4oPDx) completed two pages but failed genuinely unknown history coverage. Neither case establishes that a four-page bound covers arbitrary transaction rates.
- Derived status writes fell from14,569/98.63seconds in the prior906 interval to1,384/9.61seconds here, despite information records increasing8,839→47,066. Authoritative charge/settlement persistence was unchanged. This is measured nonmatched-market evidence, not a controlled benchmark of total CPU.

## Result and timing

47 audited ordinary-flow shadow assessments across21 unique tokens:44 failures,3`not-rejected`.28 windows were zero-trade,19 nonzero-trade. The three passes were **overlapping windows of the same4Ytm5 token**, all entry-age eligible, at17:29:42.590,17:29:54.921 and17:30:02.206. They contained27/31/36 trades,11/12/12 buyers and+7.62/+10.77/+13.69SOL curve net buying. These are not three unique opportunities, executable qualifications, orders or profits.

Six ACKed scopes overlapped for764.795seconds of the890-second logical interval(longest69.441seconds).47,066 information records included21,399 successful and25,667 failed packets; native normalized ordinary trades numbered5,273. Peak received information records were2,439/10seconds and8,202/minute. These are native packet records, not RPC starts. Receipt-to-availability median472ms,p951,404ms,max3,500ms; receipt timestamps retain the transport's documented conservative batch semantics.

73 audit results:47verified,18unavailable,8unusable;74 sessions opened, with one additional cancelled diagnostic retained. **16 actual decision misses =12 timed-out audit targets +4 targets with no audit session.**23 initial fence-warming windows are separately reported. The one unavailable boundary-ambiguity result did not enter the expiry count because its candidate retired before that census. A failure count is not a strategy rejection or proof that an executable opportunity was lost.

The four undispatched targets ended17:30:50(two scopes),17:32:40(one) and17:40:30(one). They received two successful ceiling-refresh reads in each bucket, followed by no audit start despite physical/rate headroom. Per-step admission/wait reasons were not retained, so **the exact local wait cause is unresolved**. The trace does not establish that those four misses were caused by provider saturation, replacement setup or unsubscribe occupancy. Replacement-ready deferrals occurred19times.

## The32 gap callbacks

| Cause | Callbacks | Meaning |
|---|---:|---|
|Unsupported successful swap labels|8|Candidate-local data support refusal; cannot waive successful unknown trade semantics.|
|Independent history signatures absent|8|Unknown successful activity remains blocking.|
|Notification ledger8192 cap|1|Actual busy-candidate current-window pressure.|
|Shared transaction cache16384 cap|5|One global resource bound affected otherwise independent candidates.|
|Rebound generation ambiguity|2|Candidate-local conservative refusal, not a transport-wide ID-reuse failure.|
|Support-refresh physical timeout|5|One demonstrably avoidable shared interruption while prior support remained fresh.|
|Logical information cutoff|3|Expected truthful shutdown information refusals.|

There was one pre-cutoff disconnect, at17:37:17.120, caused by the support-refresh path below. It was **not** a WebSocket control timeout or an HTTP-cooldown-only refusal. All44 physical timeouts in this run were HTTP:42 history calls,one migration`getTransaction`,one support`getMultipleAccounts`.

### Proven fresh-support coupling to repair next

Support operation6678 began17:37:15.845, received HTTP200 headers17:37:16.786 and9,718partial body bytes, then hit its1,000ms timeout after1,241ms actual elapsed(callback241ms late). The generic service catch gapped five candidates17:37:17.116–.117 and terminated their healthy notification transport.

**All five still had valid prior coherent support**, validated17:36:55.276–.285 with bank Clock17:36:54. At failure, source age was23.117seconds under the existing30-second rule, leaving **6.883seconds** of legitimate freshness. Recovery support completed at17:37:19.809, before that original17:37:24expiry. The code handled refused HTTP cooldown admission as deferred but treated an actual recoverable support-request failure as a reason to gap everything.

The small justified correction is to preserve healthy capture and still-valid prior support through bounded HTTP retry/backoff. This does not label the failed refresh successful, advance source time, satisfy a new audit ceiling or extend freshness. Actual source expiration or structural account/decoder/fee invalidity must still invalidate affected scopes; unresolved physical work must retain the original shared gate and uncertainty.

### High-volume resource containment remains inadequate

Mega reached8,192 retained notification rows on a current-window fence and was refused candidate-locally at17:32:14.262. At17:33:55–59, the **global16,384-entry/180-second transaction cache** caused five separate scope failures, including newly allocated peers. One cross-pool transaction delivered through two candidate subscriptions hit the same exhausted cache. The source stayed alive, but one pool's historical cache pressure still poisoned other candidate admission.

This is local memory/retention demand, not demonstrated provider throttling. Required current-window or correction evidence must not be silently evicted. Correctness-preserving ownership/reclamation, compact records and admission isolation should be evaluated before raising a memory limit. The process was already close to its384MiB ceiling.

## Audits and missing information

The18 unavailable audits comprise17physical timeouts and1strict slot ambiguity. Of the17 isolated audit timeouts,12 received no headers/body; **five busy queries received HTTP200 and185–241KB partial bodies before abort**. Thus body transfer against the1.5-second deadline is now an actual busy-page bottleneck, whereas the twelve quiet no-header stalls remain a distinct latency failure. No JSON decode cost explains those aborts.

Completed result pages:48×100 rows and10×1000 rows(58pages; one further raw history page belonged to a cancelled session). Small-page elapsed median187ms,p95523ms,max571ms;1000-row elapsed median948ms,max1,385ms, with median787ms after headers and max JSON decode0.97ms. No actual page-limit refusal was recorded. Required signature counts of5,144 and4,538 in timed-out busy targets nonetheless exceed four1000-row pages mathematically; those targets need a different feasible audit workload even though this run first failed at page one.

The eight unusable audits contain **105 distinct missing history rows:95successful,10failed**. No matching validated/refusal/retired information record was found anywhere in this run.85successes are concentrated in the G4oPDx target(slots462561540/542); the others affect6EK,4Ytm and2oN2. These are **unknown successful pool-address transactions**, not yet individually adjudicated swaps; do not claim all95 were executed trades. They also are not explained by the old stale audit snapshot in retained evidence. A failed-only packet census cannot excuse successful unknown activity. The prior906 historical checks already proved real missing buys and sells can occur, so waiving this requirement is unsafe.

## Provider/resource/cost measurements

673 physical starts settled673 times; peak66/minute and20/10seconds.363 observed HTTP headers were200;37 HTTP operations ended before headers. No429/503 was observed. Global provider saturation or90/minute entitlement is not established. The113 history requests include both candidate audits and migration/origin work; isolated audit timeouts must not be conflated with every history timeout.

New conservative RPC/related accounting175,272,692bytes; cumulative6,869units,641,422,025accounted bytes and289,013,760uncertain bytes retained. Root owns the append-only settlement linkage. PumpApi broad receipt960,988,997bytes and native socket70,893,333bytes are independent transport counts; broad data was filtered locally rather than archived. Existing transfer/storage costs remain separate from API fees.

Source's final resource projection reports392,208,384bytes RSS; the independent supervisor observed **392,941,568bytes(374.74MiB)**, leaving roughly9.26MiB below384MiB. Publisher max100,900,864bytes is separate. CPU265.09seconds over890seconds; event-loop maximum716.70ms. The18 selected event segments retained150,067,575bytes. Longer-run memory/storage sustainability is not established by this interval.

The next repair is fresh-support HTTP-failure containment, followed by ownership-aware transaction-cache/high-volume retention. Do not increase slot count or proceed to24-hour acceptance on this configuration. No positions, fills, financial results or natural exit behavior were exercised. The three positive feature assessments demonstrate useful recognition; autonomous financial execution and protection remain separate readiness claims.
