/** OFFLINE coordinated replay. Clock, flow, pool reserves, migration ages and
 * four candidate identities are explicitly synthetic. Actual NativeCandidateRunner
 * audits, V3.1 NativePaper/Trader, SDK pricing and PilotRpc accounting execute
 * against a disposable ledger. No production success or economic edge follows. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { coordinatedNativeReplayFixture } from './helpers/coordinated-native-replay-fixture.js';
import { PilotRpc, PilotRpcUnavailable } from '../src/pilot-rpc.js';
import { NativePaperWorkState } from '../src/native-paper-work.js';
import { NativePaperEntryAdmission, type NativePaperEntryAdmissionToken } from '../src/native-paper-entry-admission.js';
import { NativeProtectionDispatch } from '../src/native-protection-dispatch.js';
import { NativeFinancialHandoff } from '../src/native-financial-handoff.js';
import { NativeOperatingCycles } from '../src/native-operating-cycles.js';
import { NativePaperReportTimings, nativePaperReportingSample, nativePaperReportAdmissionBound } from '../src/native-paper-reporting-timing.js';
import { pilotLowerPriorityAdmission } from '../src/pilot.js';
import { runNativePaper, nativePaperRpcConfiguration, nativePaperRequestOperationBound, nativePaperProtectionReadDeadline, nativePaperSourceWorkAdmission, nativePaperManagementReserve, nativePaperRemainingEntryWork, NativePaperReportingHealth, nativePaperReportingAdmission } from '../src/run-native-paper.js';
test('OFFLINE healthy four-slot V3.1 replay keeps a holding protected while audits, preparation, reporting and exact-size economics progress', async (t) => {
    const owner = new NativePaperWorkState(), entryAdmission = new NativePaperEntryAdmission();
    let entryToken: NativePaperEntryAdmissionToken | null = null, lastCompleted: number | null = null, cycles: NativeOperatingCycles | undefined;
    let handoff: NativeFinancialHandoff;
    let actualEconomicReceipts = 0;
    let sourceAdmission = () => true, sourceWorkAdmission = (_bound: number) => true, riskAdmission = () => true;
    let f: Awaited<ReturnType<typeof coordinatedNativeReplayFixture>>;
    f = await coordinatedNativeReplayFixture(t, true, false, {
        reusePreparedEntryRent: true, maximumDeep: 4,
        sourceAdmission: () => sourceAdmission(), sourceInformationAdmission: () => true, sourceWorkAdmission: bound => sourceWorkAdmission(bound), riskAdmission: () => riskAdmission(),
        withProtectionWork: async (work) => { const restore = owner.enter('protection'); try {
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
    f.warm();
    await f.audit();
    const [owned, mint] = f.retained.map(row => row.proof.quote.mint as string);
    assert.equal((await f.bridge.candidate(owned!, true)).kind, 'evaluated');
    const initialOrder = Object.values(f.ledger.state().pending).find(row => row.mint === owned);
    assert.ok(initialOrder, JSON.stringify({ decisions: f.bridge.trader.decisions(), records: f.records.slice(-6) }));
    f.at = Math.max(f.at + 1500, initialOrder.executeAt);
    await f.bridge.protection();
    assert.ok(f.ledger.state().positions[owned!]);
    f.engine.syncFinancialOwnership();
    for (let n = 0; n < 3; n++)
        f.seedPeer(n);
    for (let n = 0; n < 18 && f.states.size < 4; n++)
        await f.engine.step();
    for (let n = 0; n < 8; n++)
        await f.engine.step();
    assert.equal(f.states.size, 4);
    assert.ok([...f.states.values()].every(state => state.openedAt !== null));
    const began = f.at, initial = structuredClone(f.ledger.state()), initialAudits = f.engine.status().counters.auditedWindows;
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
    let reports = 0, reportDeferrals = 0, lastReport = began - 15000, maxReportMs = 0, lastProtectionStart = began;
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
    try {
        await protect();
        while (f.at < targetWindow + 1000) {
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
            if (sourceAdmission() && f.engine.deadlineView().readyCount > 0 && !lowerView(2125).admitted) {
                await protect();
                continue;
            }
            if (f.at >= targetWindow - 5500 && !f.market.entryPreparationStatus(mint!).ready) {
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
            f.at += 100;
        }
        await protect();
        owner.set('source');
        for (let n = 0; n < 12 && !f.engine.currentAuditCertificate(mint!) && f.at < targetWindow + 2000; n++) {
            if (f.at - lastProtectionStart >= 2000 || sourceAdmission() && !lowerView(2125).admitted)
                await protect();
            owner.set('source');
            await f.engine.step();
            f.at += 50;
        }
        const certificate = f.engine.currentAuditCertificate(mint!)!;
        assert.ok(certificate);
        assert.equal(f.states.size, 4);
        assert.equal(certificate.windowEndAt, targetWindow);
        const originalCertificate = structuredClone(certificate), preparation = f.market.entryPreparationStatus(mint!);
        assert.equal(preparationTurns, 3);
        assert.equal(preparation.ready, true, JSON.stringify({ at: f.at, preparation }));
        const remaining = nativePaperRemainingEntryWork({ at: f.at, owned: true, preparation });
        assert.equal(remaining.maximumAccountedStarts, 3);
        assert.equal(remaining.prepared, true, JSON.stringify({ at: f.at, remaining }));
        const reserve = nativePaperManagementReserve(rpc.usage(), true, true, remaining.maximumAccountedStarts);
        assert.equal(reserve.entryAllowed, true);
        assert.equal(f.engine.financialAdmission(certificate, remaining.decisionWorkMs).admitted, true);
        handoff.observe(f.at, [certificate]);
        handoff.dispatch(certificate, f.at);
        entryToken = entryAdmission.begin({ mint: mint!, at: f.at, windowEndAt: certificate.windowEndAt, deadlineAt: certificate.deadlineAt, maximumAccountedStarts: remaining.maximumAccountedStarts, fullyAdmitted: reserve.entryAllowed });
        assert.ok(entryToken);
        context.entryToken = entryToken;
        context.entryCertificate = certificate;
        owner.set('candidate');
        riskAdmission = () => sourceAdmission() && reporting.entryAllowed;
        const beforeEvaluations = f.bridge.trader.funnel.evaluated, beforeEconomic = f.engine.economicDecisionCount(), beforeRequests = rpc.usage().newUnits, beforeCalls = f.calls.length;
        const result = await f.bridge.candidate(mint!, true);
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
        for (let n = 0; n < 80 && f.engine.certifiedCandidateMints().length < 4 && f.at < targetWindow + 9000; n++) {
            if (f.at - lastProtectionStart >= 2000 || sourceAdmission() && !lowerView(2125).admitted)
                await protect();
            owner.set('source');
            await f.engine.step();
            f.at += 100;
        }
        const certificates = f.engine.certifiedCandidateMints().map(selected => f.engine.currentAuditCertificate(selected)!).filter(Boolean);
        assert.equal(certificates.length, 4, JSON.stringify({ at: f.at, counters: f.engine.status().counters, pending: f.engine.status().candidates.filter(c => !f.engine.currentAuditCertificate(c.mint)).map(c => ({ mint: c.mint, dispatch: c.auditDispatch, lastAssessmentEnd: c.lastAssessmentEnd })), reserve: nativePaperManagementReserve(rpc.usage(), true, true, 3), failures: f.records.filter(row => row.kind === 'native-candidate-window-audit' && row.data.result?.status !== 'verified').map(row => ({ mint: row.data.mint, reason: row.data.result?.reason })) }));
        assert.equal(f.engine.economicDecisionCount() - beforeEconomic, 1, 'an admitted source turn commits the real economic receipt exactly once');
        assert.equal(f.engine.financialOutcomeObservations().pending, 0);
        assert.ok(certificates.every(c => c.windowEndAt === targetWindow && c.deadlineAt === targetWindow + 9999), 'peer audits retain original closed-window deadlines while completed financial work takes its turn');
        const inventory = f.ledger.state();
        assert.equal(inventory.positions[owned!]!.units, initial.positions[owned!]!.units);
        assert.deepEqual(inventory.paperEpoch, initial.paperEpoch);
        assert.equal(inventory.executionCosts, initial.executionCosts, 'a new decision or reservation is not a fill');
        const usage = rpc.usage(), cycleUsage = cycles.usage(f.at), handoffUsage = handoff.usage(f.at);
        assert.equal(usage.newUnits, f.calls.length - initialCalls);
        assert.equal(usage.providerResponses.httpStarts, usage.newUnits);
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
        assert.equal(f.engine.status().counters.decisionDeadlineMisses, 0);
        assert.ok(cycleUsage.observations >= 30);
        assert.equal(cycleUsage.breaches, 0);
        assert.ok(cycleUsage.maxMs <= 4000);
        assert.equal(cycleUsage.decisionReconciliation.invalid, 0);
        assert.equal(cycleUsage.decisionReconciliation.stale, 0);
        assert.ok(reports >= 4);
        assert.ok(maxReportMs > 250);
        assert.equal(handoffUsage.economicDecisions, 1);
        assert.equal(handoffUsage.expiredBeforeDispatch, 0);
        t.diagnostic(JSON.stringify({ scope: 'OFFLINE coordinated V3.1 replay; synthetic bank/Clock/flow/reserves/candidate identities; no live acceptance or market edge', durationMs: f.at - began, observationSlots: 4, audits: f.engine.status().counters.auditedWindows - initialAudits, economicDecisions: f.engine.economicDecisionCount() - initialEconomic, actualEconomicReceipts, preparedTurns: preparationTurns, decisionPhysicalStarts: 3, physicalStarts: usage.newUnits, maximumPhysicalInFlight, maximumStartsPer10Seconds, maximumStartsPerMinute, reports, maximumReportMs: maxReportMs, reportDeferrals, completedProtectionCycles: cycleUsage.observations, maximumCompletedProtectionGapMs: cycleUsage.maxMs, protectionBreaches: cycleUsage.breaches, reconciliationAtDecision: cycleUsage.decisionReconciliation, originalCertificateDeadlinePreserved: true, preparationExpiryPreserved: true, providerNetworkRequests: 0 }));
    }
    finally {
        if (entryToken)
            entryAdmission.close(entryToken);
        rpc.close();
        await f.engine.stop();
    }
});
