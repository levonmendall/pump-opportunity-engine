# Original-service forward upgrade — staged, not installed

Recorded 2026-10-29 04:35 UTC. Issue #11, PAPER only. One original account, writer, service and authenticated snapshot channel.

## Verified state

The owner screenshot at03:53:50.743UTC confirms111matched source ACKs and111output errors, not11. Reporting supervision permits new risk, while financial entries remain closed and proofPreparation isnull. That screenshot alone does not establish the exact financial readiness blocker.

Three reproduced defects were corrected in frozen financial source `a97799e88e4313ed94d0c6b5d250eeeea5f5fdc5`:

- A candidate-presence read advanced observation time between two same-packet events; old bridge accepted1of2, corrected bridge2of2, preserving original event identity/amounts/availability and slot floors.
- Status generation could advance the real observation clock before a later certificate/decision read reused an older timestamp. The fix samples at actual use; it never clamps/backdates information or extends expiry.
- Receipt export required whole-source-object equality although actual bundle provenance includes six additional verified fields. Status validation already compared the exact commit/SHA pins. Corrected receipt validation retains those pins plus raw snapshot hash, account, ACK and time checks. An independent111-ACK disposable replay produces old111errors/no receipt versus corrected0errors/receipt. This strongly explains the screenshot and actual hostENOENT; it does not prove every source recovery was a clock fault.

Repository1687tests, focused timing15, broader native/trade/execution119, supervisor27, old cutover28, new forward-upgrade25tests and TypeScript build PASS. Full raw outputs are in the parent directory. Bundle builder smoke/import/idempotency/SQLite backup+reopen checks also PASS. No financial schema, strategy, thresholds, risk or execution model changed. The separately installed reporter hotfix is preserved.

## Exact reviewed package

See package-pins.json, index.json, service.json and transport-pins.json for complete exact identities. Native executable5052449bytes/SHA`a44243b03673f29061db4030524b326b4f8929ff2a7bf5b057807ec1d0af049d`; supervisorSHA`1c993f89ec08c2ec6b8dfa05c5657bd2d572636361c8f32bff3febbeae729a79`; driverSHA`b7363a7e7c95ce653591c6fa055c11051dafb8dc419169e4eede54a88de8e8af`; indexSHA`0a98a283f798021cb164048123254046fc560fc32927aabd761c15f93125e44d`. Configuration remains`5e99ebe042521b3917a11b86ef4b46264205b11d38c407cba264a01046a79344`, six deep slots, single-position initial stage, persistent-buying-pilot-v1.

Actual EC2 staging workflow40818127096 at04:30:33.590UTC PASSED all file hashes, exact staged driver's real merged-unit parser, actual UID988/GID982, and same supervisorPID2437741/NRestarts163 before/after. Stage `/var/tmp/poe-original-forward-upgrade`, private owner994. No financial DB opened, secret read, service control, or market/provider request. Admin source`08e1c2f674e216ab6ba28a3239d4e0374458b40e` published on meme-machine-admin main; compressed payload is retained there.

First staging40817837532 failed because an inherited diagnostic1MiB output-file bound truncated the5MiB executable. This was corrected to an8MiB artifact bound and atomic verified staging, not a change to operating resource controls. The exact prior prefix artifact remains at `/var/tmp/poe-original-forward-upgrade-partial-40817837532`; its hash and failure logs are retained. It was never installed or executed.

## Backup, transition, recovery

OWNER_APPLY.txt is the single exact privileged command. It independently descriptor-checks owner/mode/type/size/SHA and executes those same reviewed bytes. It prefers the fixed root-frozen copy on later invocations. Root access is required because the authorized administration runner is UID994 and cannot modify root-owned releases/manifests or control the original unit. No additional trading authorization is requested.

Before any service mutation the helper checks exact host, unit/sandbox, original package/helper/current source pins, original account/inception, same ledger inode and full original36834action/36835journal row prefix. It preserves original root records, input, manifest, accounting baseline and operating-history before-images. It takes and verifies a fresh WAL-aware live backup. After requesting a graceful stop it requires terminal unit/cgroup settlement, exclusive financial-owner lease, fresh same-run native shutdown/transport-settlement evidence, another financial audit and stopped backup/prefix. No account initialization or database restore occurs.

Existing account: poe-3123e352-4581-455b-85db-acd7e825e99e, inception2026-10-26T22:07:36.212Z, ledger `/var/lib/poe/state/ledger.sqlite`. Same `/opt/poe/current`, same poe-runtime.service, credentials and original /api/snapshot. Only input.source changes; strategy/risk/configuration/counters/baselines/current operating history are preserved.

Root-frozen package: `/var/lib/poe-cutover/forward-a97799e88e4313ed94d0c6b5d250eeeea5f5fdc5/`. Before/after/phase records: `/etc/poe/cutovers/forward-a97799e88e4313ed94d0c6b5d250eeeea5f5fdc5/`. Fresh live and stopped backups are retained under `/var/backups/poe/forward-a97799e88e4313ed94d0c6b5d250eeeea5f5fdc5-NN-live/ledger.sqlite` and sibling `-NN/ledger.sqlite`. Public bounded verification result: `/var/lib/poe-public/upgrade-verification.json`.

If installation fails BEFORE any possible new-source start, recovery may restore only known configuration and resume the existing financial-capable5e55source with its reporting hotfix. It never restores a ledger or downgrades to the obsolete observer. Once a new-source start is requested or possible, the durable intent is never cleared: retain the new financial manager and preserve all obligations; rerun the same hash-verified command to resume/verify. Unknown state refuses rather than guessing. Never bootstrap, reseed, delete a lock, or restore an earlier database over possible financial effects. Actual runtime root transition and fresh post-start full-prefix proof remain NOT EXECUTED.

## Live state while staging / next gates

Original old5e55source remains active. At04:35:03.736UTC it reported market observing/deep6,42migration hints,38verified origins,29eligible,23queued,274cumulative predictive assessments/6cumulative passes/267failures,115quality gaps/3audit unavailable/30unusable/2deadline misses. These cumulative counters overlap and span source generations; uniqueEvaluated=0 in the current projection is not a reliable distinct-token success denominator. Do not call predictive passes executable qualifications. Financial funnelqualified/attempts/fills/exits all0; positions0; trading P&L0, reserved0, cash9.961647656SOL. USD993.275888 is passiveSOL valuation, not trading return. Render status remains entriespaused/reconciledfalse; freshness unavailable honestly reflects incomplete financial readiness despite recent market/source times.

Current source run began03:54:10.443UTC after an automatic child restart. Reporting and parent supervision continued; never claim uninterrupted market coverage. Latest sourceRSS288149504B/rollingCPU0.084565ofonecore/eventloop24.82ms/diskavailable289465532416B, normal resource state; no held-protection or sustained acceptance claim. RPC918/37,856,790response bytes is the current child process counter, NOT all-history usage. Native141,826,077B/broadwatch5,278,426,206B have separate persisted accounting scope.14HTTPtimeouts/0reported429/0HTTPerrors and rolling13starts/min atlatest are observed facts, not provider entitlement. Existing infrastructure/transfer costs remain unverified, notzero.

After owner applies: independently read local upgrade result and verify actual a977source, fresh whole-prefix and same financial account. THEN change ONLY nonsecret POE_RUNTIME_RELEASE to a977commit and POE_STRATEGY_VERSION to persistent-buying-pilot-v1 on existing Render srv-daqon53tqb8s73bdceq0 using merge semantics. Monitor the resulting configuration deploy to LIVE and verify at least two source/reporting cycles against local ACK/receipt. Do not prebind while old5e55still runs. Existing dashboard code d415184d541db5f1af0d234be631447fe213255f and live deploy dep-dbhbvi8m7kps73eg0b6g stay unchanged until that binding update.

Then inspect actual readiness/proofPreparation/sourceRecovery and collect versioned forward evidence under real demand. No forced qualification/manual entry-gate bypass and no24-hour acceptance yet. Complete natural PAPER lifecycle/protection/multiple positions/recovery/accounting/reporting gates separately. Source remains persistent across finite verification windows.

Historical financial/evidence/accounting records and all negative results are preserved. Historical8959sourceunits/1,016,377,544accountedB/519,831,552uncertainB plus33auxiliary are historical preparation, not current total or lifetime prohibition. No refund/reset. No real transaction capability or spending change.
