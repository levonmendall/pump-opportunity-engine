/** OFFLINE coordinated replay. Clock, flow, pool reserves, migration ages and
 * four candidate identities are explicitly synthetic. Actual NativeCandidateRunner
 * audits, V3.1 NativePaper/Trader, SDK pricing and PilotRpc accounting execute
 * against a disposable ledger. No production success or economic edge follows. */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { coordinatedNativeReplayFixture } from './helpers/coordinated-native-replay-fixture.js';
import { PilotRpc, PilotRpcUnavailable } from '../src/pilot-rpc.js';
import { NativePaperWorkState } from '../src/native-paper-work.js';
import { NativePaperEntryAdmission, type NativePaperEntryAdmissionToken } from '../src/native-paper-entry-admission.js';
import { NativeProtectionDispatch } from '../src/native-protection-dispatch.js';
import { NativeFinancialHandoff } from '../src/native-financial-handoff.js';
import { NativeOperatingCycles } from '../src/native-operating-cycles.js';
import { NativePaperProofPreparation } from '../src/native-paper-proof-preparation.js';
import type { NativeQualificationProof } from '../src/native-paper.js';
import { BoundedRotatingRecorder } from '../src/retained-recorder.js';
import { nativeHeldAuditScheduling } from '../src/native-held-audit-scheduling.js';
import { NativePaperReportTimings, nativePaperReportingSample, nativePaperReportAdmissionBound } from '../src/native-paper-reporting-timing.js';
import { pilotLowerPriorityAdmission } from '../src/pilot.js';
import { runNativePaper, nativePaperRpcConfiguration, nativePaperRequestOperationBound, nativePaperProtectionReadDeadline, nativePaperSourceWorkAdmission, nativePaperManagementReserve, nativePaperRemainingEntryWork, NativePaperReportingHealth, nativePaperReportingAdmission } from '../src/run-native-paper.js';
async function coordinatedReplay(t: TestContext, physicalReplacement = false, retainedPeerProofs = false) {
    const owner = new NativePaperWorkState(), entryAdmission = new NativePaperEntryAdmission();
    let entryToken: NativePaperEntryAdmissionToken | null = null, lastCompleted: number | null = null, lastProtectionStart = 0, cycles: NativeOperatingCycles | undefined;
    let handoff: NativeFinancialHandoff;
    let actualEconomicReceipts = 0;
    let proofRecorder: BoundedRotatingRecorder | undefined;
    let proofPins = 0, completedProofReuses = 0, productionProofUses = 0;
    const proofReleases: string[] = [];
    let sourceAdmission = () => true, sourceWorkAdmission = (_bound: number) => true, riskAdmission = () => true;
    let f: Awaited<ReturnType<typeof coordinatedNativeReplayFixture>>;
    f = await coordinatedNativeReplayFixture(t, true, false, {
        reusePreparedEntryRent: true, maximumDeep: 4,
        physicalLifecycle: physicalReplacement, retireEconomicRejection: physicalReplacement, initialSingle: physicalReplacement,
        sourceAdmission: () => sourceAdmission(), sourceInformationAdmission: () => true, sourceWorkAdmission: bound => sourceWorkAdmission(bound), riskAdmission: () => riskAdmission(),
        withProtectionWork: async (work) => { lastProtectionStart = f?.at ?? Date.now(); const restore = owner.enter('protection'); try {
            return await work();
        }
        finally {
            restore();
        } },
        withFinancialExecutionWork: async (work) => { const restore = owner.enter('pending'); try {
            return await work();
        }
        finally {
            restore();
        } },
        afterRecord: (kind, data: any) => {
            if (!f)
                return;
            if (proofRecorder) assert.equal(proofRecorder.record(kind, data), true, 'bounded offline operating evidence remains available');
            if (kind === 'trader-held-evaluation' && data.usable) {
                const held = f.ledger.state().positions[data.mint];
                if (held && held.units === data.units && data.quoteAt <= f.at && f.at - data.quoteAt <= 2000 && data.sourceValidUntil >= f.at) {
                    lastCompleted = f.at;
                    cycles?.completed(data.mint, data.units, f.at, data.quoteAt);
                }
            }
            if (handoff?.observeEconomicDecision(kind, data)) actualEconomicReceipts++;
            if (kind === 'native-opportunity-evaluation' && data.stage === 'execution-economics' && data.technicalFailure === false) {
                cycles?.reconcileAtDecision(data.at, f.ledger.state().daily.reconciledAt);
                f.engine.onFinancialOutcome({ mint: data.mint, kind: 'primary-evaluated', at: data.at, key: String(data.features?.windowEndAt ?? data.at) });
            }
        }
    });
    await f.open();
    await f.warm();
    await f.audit();
    const [owned, mint] = f.retained.map(row => row.proof.quote.mint as string);
    assert.equal((await f.bridge.candidate(owned!, true)).kind, 'evaluated');
    const initialOrder = Object.values(f.ledger.state().pending).find(row => row.mint === owned);
    assert.ok(initialOrder, JSON.stringify({ decisions: f.bridge.trader.decisions(), records: f.records.slice(-6) }));
    f.at = Math.max(f.at + 1500, initialOrder.executeAt);
    await f.bridge.protection();
    assert.ok(f.ledger.state().positions[owned!]);
    f.engine.syncFinancialOwnership();
    if (physicalReplacement) {
        // The financially quoted fixture pool arrives first. Its three peers
        // join in the same synthetic clock turn, before the common full window.
        assert.equal(f.seedRetainedTarget(), mint);
        for (let n = 0; n < 30 && !f.states.get(mint!)?.openedAt; n++) await f.engine.step();
        assert.ok(f.states.get(mint!)?.openedAt);
    }
    for (let n = 0; n < 3; n++)
        f.seedPeer(n);
    for (let n = 0; n < (physicalReplacement ? 100 : 18) && f.states.size < 4; n++)
        await f.engine.step();
    for (let n = 0; n < (physicalReplacement ? 20 : 8); n++)
        await f.engine.step();
    assert.equal(f.states.size, 4);
    assert.ok([...f.states.values()].every(state => state.openedAt !== null));
    const began = f.at, initial = structuredClone(f.ledger.state()), initialAudits = f.engine.status().counters.auditedWindows;
    const initialDeadlineMisses = f.engine.status().counters.decisionDeadlineMisses;
    const initialEconomic = f.engine.economicDecisionCount(), initialCalls = f.calls.length;
    cycles = new NativeOperatingCycles(began, 'offline-coordinated');
    handoff = new NativeFinancialHandoff('offline-coordinated', began, 4, (kind, data) => f.records.push({ kind, data }));
    const events: Array<{
        kind: string;
        data: any;
    }> = [], old = join(f.dir, 'coordinated-prior.json');
    writeFileSync(old, JSON.stringify({ schemaVersion: 1, blockedReason: 'RPC_HTTP_429', calls: 1, bytes: 0, lastObservedAt: began - 120000, starts: [began - 121000], pending: [] }));
    let physicalInFlight = 0, maximumPhysicalInFlight = 0;
    const rpc = new PilotRpc({ directory: join(f.dir, 'coordinated-rpc'), runId: 'offline-coordinated', baselinePaths: [old], priorPhysicalSettled: true, ...nativePaperRpcConfiguration(true), now: () => f.at, monotonic: () => f.at, sleep: async (ms) => { f.at += ms; }, fetcher: (async (_url, init) => {
            physicalInFlight++;
            maximumPhysicalInFlight = Math.max(maximumPhysicalInFlight, physicalInFlight);
            try {
                const q = JSON.parse(String(init?.body)), result = await f.wireRpc.call(q.method, q.params);
                f.at += 80;
                return new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }));
            }
            finally {
                physicalInFlight--;
            }
        }) as typeof fetch, record: (kind, data: any) => { events.push({ kind, data: structuredClone(data) }); handoff.observeTiming(kind, data); if (kind === 'component-physical-start')
            f.engine.onPhysicalOperationStarted({ at: data.at, method: data.kind.method, physicalId: data.id }); } });
    const lowerView = (bound = 1200) => pilotLowerPriorityAdmission({ now: f.at, endAt: Number.MAX_SAFE_INTEGER, held: Object.keys(f.ledger.state().positions).length, lastUsable: lastCompleted, nextPendingAt: f.bridge.trader.nextDueAt(), operationBoundMs: bound });
    const earlyAuditProtection = () => {
        if (!physicalReplacement) return sourceAdmission() && f.engine.deadlineView().readyCount > 0 && !lowerView(2125).admitted;
        const usage = rpc.usage(), inventory = f.ledger.state().positions;
        const cached = f.market.usage().held.cachedPoolSlots;
        return nativeHeldAuditScheduling({
            at: f.at, held: Object.keys(inventory).length, lastProtectionStartedAt: lastProtectionStart, lastProtectionCompletedAt: lastCompleted,
            inventoryProtectionComplete: lastCompleted !== null && f.at - lastCompleted <= 4000,
            nextPendingAt: f.bridge.trader.nextDueAt(), candidateInformationOpen: true,
            currentAuditFinancialRunwayAvailable: lowerView(2125).admitted, deadlineView: f.engine.deadlineView(f.at),
            physical: { available: !usage.closed && !usage.fatal && usage.cooldownUntil <= f.at,
                busy: usage.inFlight !== 0 || usage.waitingOrOperating,
                readyAt: Math.max(usage.rpcDispatchWindow?.readyAt ?? Infinity, usage.historyDispatchWindow?.readyAt ?? Infinity),
                rolling10SecondHeadroom: Math.max(0, usage.requestLimits.maxStartsPer10s - (usage.chapterUsage?.rolling10SecondStarts ?? 0)),
                rollingMinuteHeadroom: Math.max(0, usage.requestLimits.maxStartsPerMinute - (usage.chapterUsage?.rolling60SecondStarts ?? 0)) },
            protectionRequestStarts: Object.keys(inventory).every(mint => Number.isSafeInteger(cached[mint])) ? 1 : null
        }).earlyProtection;
    };
    sourceAdmission = () => !(owner.current === 'candidate' && entryToken && !entryAdmission.valid(entryToken, f.at)) && nativePaperSourceWorkAdmission({ informationOpen: true, owned: true, entryWork: owner.current === 'candidate', entryStartsRemaining: owner.current === 'candidate' && entryToken ? entryAdmission.remaining(entryToken, f.at) : undefined, usage: rpc.usage(), persistent: true });
    sourceWorkAdmission = bound => lowerView(bound).admitted;
    const optionalAdmission = (bound = 1200) => sourceAdmission() && lowerView(bound).admitted && f.engine.discretionaryAdmission(bound).admitted;
    const holder: any = {}, context: any = { __name: (value: unknown) => value, NativeProtectionDispatch, record(kind: string, data: any) { events.push({ kind, data: structuredClone(data) }); handoff.observeTiming(kind, data); }, runId: 'offline-coordinated', requestSequence: 0, entryCertificate: null, sourceEntryPreparation: null, candidateDiagnostic: (run: () => unknown, fallback: unknown) => { try {
            return run();
        }
        catch {
            return fallback;
        } }, lastProtectionStart: 0, holder, currentLedger: f.ledger, workOwner: owner, currentRpc: rpc, service: true, Date: { now: () => f.at }, endAt: Number.MAX_SAFE_INTEGER, stopped: false, entryAdmission, entryToken, manifest: { controlCooldownUntil: 0 }, PilotRpcUnavailable, nativePaperRequestOperationBound, nativePaperProtectionReadDeadline, nativePaperSourceWorkAdmission, nativePaperManagementReserve, lowerView, sourceAdmission: () => sourceAdmission(), sourceInformationAdmission: () => true, optionalAdmission, engine: f.engine, bridge: f.bridge };
    Object.defineProperty(context, 'lastCompleted', { get: () => lastCompleted });
    const runtime = runNativePaper.toString(), start = runtime.search(/const\s+requestOptions\s*=/), tail = runtime.slice(start), end = tail.search(/;\s*const\s+market\s*=/);
    assert.ok(start >= 0 && end > 0);
    runInNewContext(tail.slice(0, end) + ';holder.scheduled=scheduled;holder.dispatch=protectionDispatch;', context, { timeout: 1000 });
    f.route(holder.scheduled);
    const reporting = new NativePaperReportingHealth(), reportTimings = new NativePaperReportTimings(() => f.at);
    reporting.observe(0, true);
    let reports = 0, reportDeferrals = 0, lastReport = began - 15000, maxReportMs = 0;
    lastProtectionStart = began;
    const protect = async () => { lastProtectionStart = f.at; const restore = owner.enter('protection'); try {
        await f.bridge.protection();
    }
    finally {
        restore();
    } assert.equal(Object.keys(f.ledger.state().positions).length, 1); assert.equal(f.ledger.state().positions[owned!]!.units, initial.positions[owned!]!.units); };
    const report = () => {
        const bound = nativePaperReportAdmissionBound({ maximumCompletedMs: maxReportMs, hasCompletedReport: reports > 0, phases: reportTimings.usage(), timingAvailable: reportTimings.timingAvailable })!;
        const native = f.engine.discretionaryAdmission(bound), admission = nativePaperReportingAdmission({ at: f.at, lastReportAt: lastReport, held: 1, nextProtectionAt: lastProtectionStart + 2000, nextPendingAt: f.bridge.trader.nextDueAt(), candidateLatestStartAt: native.latestStartAt, budgetMs: bound });
        if (!native.admitted || !admission.admitted) {
            if (admission.reason !== 'report-not-due')
                reportDeferrals++;
            return;
        }
        const elapsed = reporting.complete(() => {
            const sample = nativePaperReportingSample({ now: () => f.at, timings: reportTimings, candidateStatus: () => { const value = f.engine.status(); f.at += 120; return value; }, maintainCash: () => { f.bridge.maintainOperatingFinancialReadiness(f.price()); }, financialSnapshot: at => ({ state: f.ledger.state(), projection: f.ledger.projection(at, f.price(), f.bridge.valuation().marks) }) });
            assert.ok(sample.at - sample.financial.state.daily.reconciledAt <= 2000, 'report uses current held reconciliation');
            reportTimings.measure('financial-history', () => { f.ledger.exportJournal(50); f.at += 140; });
            reportTimings.measure('publication-checkpoint', () => { writeFileSync(join(f.dir, 'OFFLINE-coordinated-report.json'), JSON.stringify(sample)); f.at += 70; });
        }, () => true, () => f.at);
        maxReportMs = Math.max(maxReportMs, elapsed);
        lastReport = f.at;
        reports++;
        assert.equal(reporting.entryAllowed, true, 'completed valid report remains ready despite a measured performance overrun');
    };
    const targetWindow = Math.ceil(began / 10000) * 10000 + 60000;
    let lastEmission = -1, preparationTurns = 0;
    let replacementMint: string | null = null, retirementAckAt: number | null = null, replacementAckAt: number | null = null;
    let preparedAllocationsBeforeRetirement = 0;
    let originalRetirementDeadlineAt: number | null = null;
    try {
        if (retainedPeerProofs) {
            proofRecorder = new BoundedRotatingRecorder({ directory: join(f.dir, 'OFFLINE-proof-evidence'), segmentBytes: 65536, diagnosticBytes: 16 * 1024 * 1024, minRetentionMs: 300000, minimumDiskReserveBytes: 0, now: () => f.at, monotonic: () => f.at - began });
            assert.equal(proofRecorder.record('OFFLINE-observation-start', { at: began, fourSlots: f.states.size }), true);
        }
        await protect();
        while (f.at < targetWindow + 1000) {
            if (physicalReplacement && replacementMint === null && f.at >= targetWindow - 15000) replacementMint = f.seedPeer(8);
            const bucket = Math.floor((f.at - began) / 10000);
            if (bucket !== lastEmission) {
                f.emitAll(bucket);
                lastEmission = bucket;
            }
            if (f.at - lastProtectionStart >= 2000) {
                await protect();
                continue;
            }
            owner.set('source');
            if (earlyAuditProtection()) {
                await protect();
                continue;
            }
            if (f.at >= targetWindow - (physicalReplacement ? 1000 : 5500) && !f.market.entryPreparationStatus(mint!).ready) {
                if (!lowerView(1700).admitted) {
                    await protect();
                    continue;
                }
                const target = f.engine.financialPreparationTargets().find(row => row.mint === mint);
                assert.ok(target);
                const work = nativePaperRemainingEntryWork({ at: f.at, owned: true, preparation: f.market.entryPreparationStatus(mint!) });
                context.sourceEntryPreparation = { mint, certificate: target.certificate, deadlineAt: target.deadlineAt - work.decisionWorkMs, current: () => f.states.has(mint!), remainingStarts: () => nativePaperRemainingEntryWork({ at: f.at, owned: true, preparation: f.market.entryPreparationStatus(mint!) }).maximumAccountedStarts };
                const calls = f.calls.length;
                try {
                    const prepared = await f.market.prepareEntryCostTurn(mint!, new AbortController().signal);
                    assert.ok(['ready', 'deferred'].includes(prepared.status));
                }
                catch (error) {
                    throw new Error(JSON.stringify({ error: String(error), at: f.at, target, work, lower: lowerView(), last: events.slice(-8) }));
                }
                finally {
                    context.sourceEntryPreparation = null;
                }
                assert.equal(f.calls.length - calls, 1, 'one admitted support operation per turn');
                preparationTurns++;
            }
            await f.engine.step();
            report();
            f.at += physicalReplacement ? 200 : 100;
        }
        if (!physicalReplacement || f.at - lastProtectionStart >= 2000 || earlyAuditProtection()) await protect();
        owner.set('source');
        for (let n = 0; n < (physicalReplacement ? 100 : 12) && !f.engine.currentAuditCertificate(mint!) && f.at < targetWindow + (physicalReplacement ? 6500 : 2000); n++) {
            if (f.at - lastProtectionStart >= 2000 || earlyAuditProtection())
                await protect();
            owner.set('source');
            await f.engine.step();
            f.at += 50;
        }
        const certificate = f.engine.currentAuditCertificate(mint!)!;
        assert.ok(certificate, JSON.stringify({ at: f.at, targetWindow, native: { fatal: f.flow.usage().fatal, nextServiceAt: f.flow.usage().nextServiceAt, nextServiceAction: f.flow.usage().nextServiceAction }, candidates: f.engine.status().candidates.map(c => ({ mint: c.mint, lastAssessmentEnd: c.lastAssessmentEnd, auditDispatch: c.auditDispatch })), failures: f.records.filter(r => r.kind === 'native-candidate-window-audit' || r.kind === 'native-candidate-work-unavailable').slice(-8) }));
        assert.equal(f.states.size, 4);
        assert.equal(certificate.windowEndAt, targetWindow);
        const originalCertificate = structuredClone(certificate);
        let preparation = f.market.entryPreparationStatus(mint!);
        const originalPeerTargets = f.engine.deadlineView().targets.filter(target => target.mint !== mint).map(target => ({ mint: target.mint, eligibleAt: target.eligibleAt, deadlineAt: target.deadlineAt }));
        const originalPeerCertificates = new Map<string, typeof originalCertificate>();
        const retainPeerCertificateWitnesses = () => {
            for (const peer of originalPeerTargets) {
                const current = f.engine.currentAuditCertificate(peer.mint);
                if (current?.windowEndAt === targetWindow) originalPeerCertificates.set(peer.mint, structuredClone(current));
            }
        };
        retainPeerCertificateWitnesses();
        if (physicalReplacement) {
            assert.ok(replacementMint);
            assert.equal(f.states.has(replacementMint), false, 'four acknowledged scopes still occupy every observation slot');
            assert.equal(f.engine.status().candidatePreparation.freshPreparedCount, 0, 'full physical occupancy keeps optional replacement preparation deferred');
            preparedAllocationsBeforeRetirement = f.engine.status().candidatePreparation.counters.allocationsFromPrepared;
        }
        assert.equal(preparationTurns, 3);
        assert.equal(preparation.ready, true, JSON.stringify({ at: f.at, preparation }));
        let remaining = nativePaperRemainingEntryWork({ at: f.at, owned: true, preparation });
        assert.equal(remaining.maximumAccountedStarts, 3);
        assert.equal(remaining.prepared, true, JSON.stringify({ at: f.at, remaining }));
        let reserve = nativePaperManagementReserve(rpc.usage(), true, true, remaining.maximumAccountedStarts);
        if (physicalReplacement) {
            const originalPreparationExpiry = preparation.expiresAt;
            // A ready certificate does not bypass shared rolling headroom. Yield
            // without new optional source work while the holding stays protected.
            for (let n = 0; n < 60 && !reserve.entryAllowed && preparation.expiresAt !== null && f.at + remaining.decisionWorkMs + 125 < Math.min(preparation.expiresAt, certificate.deadlineAt); n++) {
                if (f.at - lastProtectionStart >= 2000) await protect();
                owner.set('source');
                f.at += 100;
                preparation = f.market.entryPreparationStatus(mint!);
                remaining = nativePaperRemainingEntryWork({ at: f.at, owned: true, preparation });
                reserve = nativePaperManagementReserve(rpc.usage(), true, true, remaining.maximumAccountedStarts);
            }
            assert.equal(preparation.expiresAt, originalPreparationExpiry, 'headroom waiting never restamps stable preparation');
            assert.equal(remaining.prepared, true);
        }
        assert.equal(reserve.entryAllowed, true, JSON.stringify({ at: f.at, reserve, preparation }));
        assert.equal(f.engine.financialAdmission(certificate, remaining.decisionWorkMs).admitted, true, JSON.stringify(f.engine.financialAdmission(certificate, remaining.decisionWorkMs)));
        if (retainedPeerProofs) {
            const digest = (value: string) => createHash('sha256').update(value).digest('hex');
            const proofs = new NativePaperProofPreparation(() => f.at, id => { proofReleases.push(id); assert.equal(proofRecorder!.releaseUnusedProof('entry-' + digest(id)), true); });
            const tasks: Promise<void>[] = [];
            const pin = (proof: NativeQualificationProof) => {
                const task = (async () => {
                    proofPins++;
                    const result = await proofRecorder!.pinProvisionalRange('entry-' + digest(proof.proofId), proof.startAt, proof.throughAt, proof.deadlineAt);
                    assert.equal(result.complete, true, result.reason);
                })();
                tasks.push(task);
                return task;
            };
            const settle = async () => { await new Promise<void>(resolve => setImmediate(resolve)); await Promise.all(tasks); await new Promise<void>(resolve => setImmediate(resolve)); };
            const a = f.bridge.qualificationProof(mint!)!;
            assert.ok(a, 'the actual qualified source/strategy certificate supplies proof A');
            assert.equal(proofs.prepare(a, pin), false); await settle(); assert.equal(proofs.ready(a), true);
            const manifestPath = join(f.dir, 'OFFLINE-proof-evidence', 'proof-' + digest('entry-' + digest(a.proofId)), 'manifest.json');
            const originalManifest = readFileSync(manifestPath);
            let b: NativeQualificationProof | null = null;
            for (let n = 0; n < 16 && !b && f.at + remaining.decisionWorkMs + 125 < a.deadlineAt; n++) {
                if (f.at - lastProtectionStart >= 2000 || earlyAuditProtection()) await protect();
                owner.set('source'); await f.engine.step(); report();
                b = f.engine.certifiedCandidateMints().filter(peer => peer !== mint).map(peer => f.bridge.qualificationProof(peer)).find(proof => proof !== null) ?? null;
                f.at += 50;
            }
            assert.ok(b, 'a distinct genuinely audited peer supplies proof B before the original A deadline');
            assert.equal(f.states.size, 4); assert.equal(proofs.prepare(b, pin), false);
            assert.equal(proofs.ready({ ...a, throughAt: f.at }), true, 'pending peer retention cannot evict completed A');
            await settle(); assert.equal(proofs.ready(b), true);
            const currentA = f.bridge.qualificationProof(mint!)!;
            assert.ok(currentA && currentA.throughAt > a.throughAt);
            assert.equal(currentA.proofId, a.proofId); assert.equal(currentA.deadlineAt, a.deadlineAt);
            assert.equal(proofs.prepare(currentA, pin), true); completedProofReuses++;
            assert.equal(proofPins, 2); assert.deepEqual(proofReleases, []); assert.deepEqual(readFileSync(manifestPath), originalManifest);
            // Attach the normal optional constructor callback to this disposable
            // owner after its initial holding bootstrap. The real candidate path
            // must consume the exact retained proof before its final quote.
            const options = (f.bridge as unknown as { options: { pinQualification?: (proof: NativeQualificationProof) => void } }).options;
            options.pinQualification = proof => { assert.equal(proofs.ready(proof), true); assert.equal(proof.proofId, a.proofId); productionProofUses++; };
            if (f.at - lastProtectionStart >= 2000 || !lowerView(remaining.quoteOperationMs).admitted) await protect();
            owner.set('source');
            assert.equal(f.engine.financialAdmission(certificate, remaining.decisionWorkMs).admitted, true, 'peer retention does not renew A to fit its final economic work');
            assert.equal(f.market.entryPreparationStatus(mint!).expiresAt, preparation.expiresAt);
        }
        handoff.observe(f.at, [certificate]);
        handoff.dispatch(certificate, f.at);
        entryToken = entryAdmission.begin({ mint: mint!, at: f.at, windowEndAt: certificate.windowEndAt, deadlineAt: certificate.deadlineAt, maximumAccountedStarts: remaining.maximumAccountedStarts, fullyAdmitted: reserve.entryAllowed });
        assert.ok(entryToken);
        context.entryToken = entryToken;
        context.entryCertificate = certificate;
        owner.set('candidate');
        riskAdmission = () => sourceAdmission() && reporting.entryAllowed;
        const beforeEvaluations = f.bridge.trader.funnel.evaluated, beforeEconomic = f.engine.economicDecisionCount(), beforeRequests = rpc.usage().newUnits, beforeCalls = f.calls.length;
        // A real independent SQLite writer holds only the nonfinancial registry.
        // The financial ledger and exact-size quote remain available. This makes
        // the normal typed before-callback deferral observable without faking
        // either an economic event or the retirement operation.
        if (physicalReplacement) f.holdRegistryWriter();
        let result: Awaited<ReturnType<typeof f.bridge.candidate>>;
        try { result = await f.bridge.candidate(mint!, true); }
        finally { if (physicalReplacement) f.releaseRegistryWriter(); }
        assert.equal(result.kind, 'evaluated', JSON.stringify(f.records.slice(-10)));
        handoff.complete(certificate, f.at, f.bridge.trader.funnel.evaluated - beforeEvaluations);
        assert.equal(actualEconomicReceipts, 1, 'the real matching nontechnical V3.1 event supplies the receipt before optional registry accounting');
        assert.equal(f.engine.economicDecisionCount() - beforeEconomic, 0, 'optional registry accounting is deferred outside the financial turn');
        assert.equal(f.engine.financialOutcomeObservations().pending, 1, 'the real outcome is queued without a synchronous registry write');
        assert.equal(rpc.usage().newUnits - beforeRequests, 3, 'prepared exact-size decision plus two owned contexts consumes the exact shared work budget');
        assert.equal(f.calls.length - beforeCalls, 3);
        assert.equal(entryAdmission.view(entryToken, f.at)?.spent, 3);
        const evaluation = f.records.findLast(row => row.kind === 'native-opportunity-evaluation' && row.data.mint === mint)!.data;
        assert.equal(evaluation.technicalFailure, false);
        assert.ok(BigInt(evaluation.baselineMarket?.buyInputLamports ?? '0') > 0n);
        assert.equal(evaluation.decision.qualified, false);
        assert.equal(evaluation.selectedMarket, null, 'a negative economic decision does not invent a selected execution size');
        assert.ok(f.at <= originalCertificate.deadlineAt);
        assert.deepEqual(certificate, originalCertificate);
        assert.equal(f.market.entryPreparationStatus(mint!).expiresAt, preparation.expiresAt, 'reused preparation never renews its original expiry');
        entryAdmission.close(entryToken);
        entryToken = null;
        context.entryToken = null;
        context.entryCertificate = null;
        assert.deepEqual(f.ledger.state().pending, {}, 'the controlled weak-flow example receives an actual negative economic decision, not an order');
        owner.set('source');
        if (physicalReplacement) {
            assert.equal(f.bridge.schedulingFollowupDiagnostics().pending, 1, 'the real negative decision queues one nonfinancial followup');
            assert.equal(f.flow.usage().candidates, 4);
            assert.equal(f.flow.usage().retiring, 0);
            assert.equal(f.engine.currentAuditCertificate(mint!)?.windowEndAt, originalCertificate.windowEndAt, 'the financial callback does not synchronously retire source state');
            f.physical!.holdNextUnsubscribe();
            assert.equal(f.bridge.drainSchedulingFollowups(), true);
            assert.equal(f.bridge.schedulingFollowupDiagnostics().pending, 0);
            assert.equal(f.engine.currentAuditCertificate(mint!), null);
            assert.equal(f.flow.usage().candidates, 3);
            assert.equal(f.flow.usage().retiring, 1, 'logical retirement retains its actual physical subscription');
            originalRetirementDeadlineAt = f.flow.usage().nativeServiceDeadlines.find((row: { action: string }) => row.action === 'unsubscribe')?.deadlineAt ?? null;
            assert.ok(originalRetirementDeadlineAt !== null && originalRetirementDeadlineAt > f.at);
            assert.equal(f.states.has(replacementMint!), false);
            const beforeUnsubscribe = f.physical!.sent.length;
            let unsubscribe: Promise<unknown> | undefined;
            // Retirement retains its own original native deadline. It is not
            // required to finish inside the already-completed decision window.
            for (let n = 0; n < 250 && !f.physical!.pendingUnsubscribe() && f.at < originalRetirementDeadlineAt - 125; n++) {
                if (f.at - lastProtectionStart >= 2000 || earlyAuditProtection()) await protect();
                owner.set('source');
                let finished = false;
                const turn = f.engine.step().finally(() => { finished = true; });
                for (let microtask = 0; microtask < 60 && !finished && !f.physical!.pendingUnsubscribe(); microtask++) await Promise.resolve();
                if (f.physical!.pendingUnsubscribe()) { unsubscribe = turn; break; }
                await turn;
                retainPeerCertificateWitnesses();
                f.at += 50;
            }
            assert.ok(unsubscribe, JSON.stringify({ at: f.at, originalRetirementDeadlineAt, native: { candidates: f.flow.usage().candidates, retiring: f.flow.usage().retiring, next: f.flow.usage().nextServiceAction, fatal: f.flow.usage().fatal }, reserve: nativePaperManagementReserve(rpc.usage(), true, true, 3), peers: f.engine.status().candidates.map(c => ({ mint: c.mint, lastAssessmentEnd: c.lastAssessmentEnd, auditDispatch: c.auditDispatch?.lastState })) }));
            assert.equal(f.flow.usage().candidates + f.flow.usage().retiring, 4);
            assert.equal(f.flow.usage().retiring, 1);
            assert.equal(rpc.usage().inFlight, 1, 'the successful write callback is still a physically active operation');
            assert.equal(f.states.has(replacementMint!), false);
            assert.equal(f.physical!.sent.slice(beforeUnsubscribe).filter(row => row.request.method === 'logsSubscribe').length, 0, 'no replacement subscription precedes the retirement ACK');
            f.at += 75;
            f.physical!.acknowledgeUnsubscribe();
            await unsubscribe;
            retirementAckAt = f.at;
            assert.ok(retirementAckAt <= originalRetirementDeadlineAt);
            assert.equal(rpc.usage().inFlight, 0);
            assert.equal(f.flow.usage().retiring, 0);
            assert.equal(f.flow.usage().candidates, 3);
            assert.equal(f.states.has(replacementMint!), false, 'ACK frees physical capacity; allocation is still a separate admitted turn');
            assert.equal(f.records.filter(row => row.kind === 'native-candidate-economic-rejection-completed' && row.data.mint === mint).length, 1);
        }
        const expectedCertificates = physicalReplacement ? 3 : 4;
        const replacementWaitUntil = physicalReplacement ? retirementAckAt! + 15000 : targetWindow + 9000;
        for (let n = 0; n < 160 && (physicalReplacement ? !f.states.get(replacementMint!)?.openedAt : f.engine.certifiedCandidateMints().length < expectedCertificates) && f.at < replacementWaitUntil; n++) {
            if (f.at - lastProtectionStart >= 2000 || earlyAuditProtection())
                await protect();
            owner.set('source');
            await f.engine.step();
            retainPeerCertificateWitnesses();
            f.at += 100;
        }
        const certificates = physicalReplacement ? [...originalPeerCertificates.values()] : f.engine.certifiedCandidateMints().map(selected => f.engine.currentAuditCertificate(selected)!).filter(Boolean);
        const expiredPeerWindows = physicalReplacement ? originalPeerTargets.filter(peer => !originalPeerCertificates.has(peer.mint) && f.records.some(row => row.kind === 'native-predictive-window-expired' && row.data.mint === peer.mint && row.data.windowEndAt === targetWindow)).map(peer => peer.mint) : [];
        assert.equal(certificates.length + expiredPeerWindows.length, expectedCertificates, JSON.stringify({ at: f.at, certificates: certificates.length, expiredPeerWindows, counters: f.engine.status().counters, pending: f.engine.status().candidates.filter(c => !f.engine.currentAuditCertificate(c.mint)).map(c => ({ mint: c.mint, dispatch: c.auditDispatch, lastAssessmentEnd: c.lastAssessmentEnd })), reserve: nativePaperManagementReserve(rpc.usage(), true, true, 3) }));
        if (physicalReplacement) {
            const replacement = f.states.get(replacementMint!);
            assert.ok(replacement?.openedAt, JSON.stringify({ at: f.at, preparation: f.engine.status().candidatePreparation, native: f.flow.usage(), last: f.records.slice(-12) }));
            replacementAckAt = replacement.openedAt;
            assert.ok(replacementAckAt >= retirementAckAt!);
            assert.equal(f.flow.usage().candidates, 4);
            assert.equal(f.flow.usage().retiring, 0);
            assert.equal(f.engine.status().candidatePreparation.counters.allocationsFromPrepared, preparedAllocationsBeforeRetirement + 1, 'the normal runner allocates exactly one replacement from its original validated support');
            const prepared = f.records.findLast(row => row.kind === 'native-candidate-preparation' && row.data.mint === replacementMint && row.data.state === 'ready');
            assert.ok(prepared);
            assert.ok(prepared.data.at >= retirementAckAt! && prepared.data.at <= replacementAckAt);
            assert.ok(replacementAckAt - prepared.data.at < 30000, 'preparation is still within its original freshness interval at ACK');
            assert.equal(f.engine.currentAuditCertificate(replacementMint!), null, 'replacement ACK begins a fresh required window and grants no inherited certificate');
            const replacementAck = f.records.findLast(row => row.kind === 'native-flow-subscription-ack' && row.data.mint === replacementMint);
            assert.equal(replacementAck?.data.at, replacementAckAt);
            for (const original of originalPeerTargets) {
                const peer = certificates.find(c => c.mint === original.mint);
                if (peer) assert.equal(peer.deadlineAt, original.deadlineAt);
            }
        }
        assert.equal(f.engine.economicDecisionCount() - beforeEconomic, 1, 'an admitted source turn commits the real economic receipt exactly once');
        assert.equal(f.engine.financialOutcomeObservations().pending, 0);
        assert.ok(certificates.every(c => c.windowEndAt === targetWindow && c.deadlineAt === targetWindow + 9999), 'peer audits retain original closed-window deadlines while completed financial work takes its turn');
        const inventory = f.ledger.state();
        assert.equal(inventory.positions[owned!]!.units, initial.positions[owned!]!.units);
        assert.deepEqual(inventory.paperEpoch, initial.paperEpoch);
        assert.equal(inventory.executionCosts, initial.executionCosts, 'a new decision or reservation is not a fill');
        const usage = rpc.usage(), cycleUsage = cycles.usage(f.at), handoffUsage = handoff.usage(f.at);
        assert.equal(usage.providerResponses.httpStarts, f.calls.length - initialCalls);
        const controlStarts = events.filter(row => row.kind === 'component-physical-start' && row.data.kind.transport === 'ws').length;
        assert.equal(usage.newUnits, usage.providerResponses.httpStarts + controlStarts, 'all HTTP and native control starts share the existing physical budget');
        assert.equal(maximumPhysicalInFlight, 1);
        assert.equal(usage.inFlight, 0);
        assert.equal(handoffUsage.requestTiming.physicalStarts, usage.newUnits);
        assert.equal(handoffUsage.requestTiming.physicalSettlements, usage.newUnits);
        assert.equal(handoffUsage.requestTiming.completeResponses, usage.newUnits);
        assert.equal(handoffUsage.requestTiming.unmatchedSettlements, 0);
        const starts = events.filter(row => row.kind === 'component-physical-start');
        const maximumRollingStarts = (windowMs: number) => Math.max(0, ...starts.map(row => starts.filter(peer => peer.data.at > row.data.at - windowMs && peer.data.at <= row.data.at).length));
        const maximumStartsPer10Seconds = maximumRollingStarts(10000), maximumStartsPerMinute = maximumRollingStarts(60000);
        assert.ok(maximumStartsPer10Seconds <= 20 && maximumStartsPerMinute <= 90, 'all shared physical work remains within the existing provider start limits');
        const plans = new Map(events.filter(row => row.kind === 'native-paper-request-plan').map(row => [row.data.requestId, row.data]));
        for (const row of starts) {
            const plan = plans.get(row.data.callerRequestId);
            assert.ok(plan);
            assert.ok(plan.requestedOperationMs > 0 && plan.requestedOperationMs <= 3000);
            assert.ok(row.data.at <= plan.latestStartAt, 'no physical start inherits an extended caller deadline');
        }
        assert.equal(events.filter(row => row.kind === 'component-physical-timeout').length, 0);
        assert.equal(f.engine.status().counters.decisionDeadlineMisses - initialDeadlineMisses, expiredPeerWindows.length, 'the pressure scenario records genuinely expired peer windows; it never renews an old deadline or counts that expiry as an economic decision');
        assert.ok(cycleUsage.observations >= 30);
        assert.equal(cycleUsage.breaches, 0);
        assert.ok(cycleUsage.maxMs <= 4000);
        assert.equal(cycleUsage.decisionReconciliation.invalid, 0);
        assert.equal(cycleUsage.decisionReconciliation.stale, 0);
        assert.ok(reports >= 4);
        assert.ok(maxReportMs > 250);
        assert.equal(handoffUsage.economicDecisions, 1);
        assert.equal(handoffUsage.expiredBeforeDispatch, 0);
        if (retainedPeerProofs) { assert.equal(completedProofReuses, 1); assert.equal(proofPins, 2); assert.equal(productionProofUses, 1); assert.deepEqual(proofReleases, []); }
        t.diagnostic(JSON.stringify({ scope: 'OFFLINE coordinated V3.1 replay; synthetic bank/Clock/flow/reserves/candidate identities; no live acceptance or market edge', durationMs: f.at - began, observationSlots: 4, audits: f.engine.status().counters.auditedWindows - initialAudits, economicDecisions: f.engine.economicDecisionCount() - initialEconomic, actualEconomicReceipts, preparedTurns: preparationTurns, decisionPhysicalStarts: 3, physicalStarts: usage.newUnits, controlStarts, physicalReplacement, retainedPeerProofs, proofPins, completedProofReuses, productionProofUses, retirementAckAt, originalRetirementDeadlineAt, replacementAckAt, originalPeerCertificates: physicalReplacement ? certificates.length : null, expiredPeerWindows: expiredPeerWindows.length, maximumPhysicalInFlight, maximumStartsPer10Seconds, maximumStartsPerMinute, reports, maximumReportMs: maxReportMs, reportDeferrals, completedProtectionCycles: cycleUsage.observations, maximumCompletedProtectionGapMs: cycleUsage.maxMs, protectionBreaches: cycleUsage.breaches, reconciliationAtDecision: cycleUsage.decisionReconciliation, originalCertificateDeadlinePreserved: true, preparationExpiryPreserved: true, providerNetworkRequests: 0 }));
    }
    finally {
        if (entryToken)
            entryAdmission.close(entryToken);
        owner.set('source');
        await f.engine.stop();
        await proofRecorder?.close();
        rpc.close();
    }
}

test('OFFLINE healthy four-slot V3.1 replay keeps a holding protected while audits, preparation, reporting and exact-size economics progress', async t => coordinatedReplay(t));
test('OFFLINE real negative economics retires only its own scope and four-slot replacement preparation waits for physical unsubscribe ACK while a holding remains protected', async t => coordinatedReplay(t, true));
test('OFFLINE four-slot held replay retains completed proof A through peer B and reuses A for timely exact-size economics', async t => coordinatedReplay(t, false, true));
