/** OFFLINE fixture adapted from native-paper-integration and
 * liquidity-resilient-native-runtime. Retained SDK account bytes are replayed
 * in a synthetic common bank with declared 20 SOL reserves, Clock, USD and flow.
 * The holding bootstrap decodes a retimed captured origin; all four candidate
 * identities use an explicitly injected scheduling resolver. This does not
 * verify their natural migration age, live qualification or profitability.
 * The original account identity is used only inside a temporary disposable DB.
 */
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import bs58 from 'bs58';
import { PaperLedger, type UsdPrice } from '../../src/ledger.js';
import { PilotMarket } from '../../src/pilot-market.js';
import { NativePaper } from '../../src/native-paper.js';
import { NativeCandidateRunner } from '../../src/native-candidate-runner.js';
import { FlowWindow, type NormalizedTrade } from '../../src/strategy.js';
import { LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING, type PilotBinding } from '../../src/pilot-contract.js';
import { POE_OPERATING_ACCOUNT } from '../../src/poe-operating-account.js';
import { PAPER_TEN_SOL_EPOCH_AUTHORIZATION, PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION, PAPER_EPOCH_ASSET_SEGREGATION } from '../../src/paper-epoch.js';
import type { PoolWireAccount } from '../../src/pool.js';
import type { ResearchClockObservationSupport } from '../../src/research-clock-pricing.js';
import type { NativeNotification } from '../../src/pilot-native-flow.js';
import { canonicalPumpPoolPda, PUMP_AMM_PROGRAM_ID } from '../../src/sdk.js';
import { decodeMigrationIdentity } from '../../src/migration-identity.js';
const sig = (n: number) => { const b = Buffer.alloc(64); b.writeUInt32LE(n); return bs58.encode(b); };
export async function coordinatedNativeReplayFixture(t: TestContext, capacity = true, technicalReevaluation = false, readiness: {
    sourceAdmission?: () => boolean;
    sourceInformationAdmission?: () => boolean;
    sourceWorkAdmission?: (bound: number) => boolean;
    maximumDeep?: number;
    reusePreparedEntryRent?: boolean;
    beforeEntryPreparationRead?: (input: {
        method: string;
        signal: AbortSignal;
    }) => Promise<void>;
    withProtectionWork?: <T>(work: () => Promise<T>) => Promise<T>;
    withFinancialExecutionWork?: <T>(work: () => Promise<T>) => Promise<T>;
    operatingFinancialReadiness?: boolean;
    quiet?: boolean;
    auditReadiness?: boolean;
    knownRunIds?: string[];
    financialReady?: boolean;
    initialSingle?: boolean;
    riskAdmission?: () => boolean;
    financialAdmission?: (at: number) => boolean;
    afterPreparation?: () => void;
    beforeInitialCompose?: (ledger: PaperLedger, at: number) => void;
    afterRecord?: (kind: string, data: unknown) => void;
} = {}) {
    const retained = ['2026-10-26T19-57-35.882Z', '2026-10-26T19-42-16.130Z'].map(run => { const proof = JSON.parse(readFileSync('evidence/integration-proof-' + run + '.json', 'utf8')), rows = readFileSync('evidence/integration-' + run + '.ndjson', 'utf8').trim().split('\n').map(l => JSON.parse(l)); return { proof, state: rows.find(r => r.kind === 'pool-state').data, origin: rows.find(r => r.kind === 'migration-transaction').data }; });
    const accounts = new Map<string, PoolWireAccount>();
    for (const r of retained)
        for (let i = 0; i < 7; i++)
            if (!accounts.has(r.state.addresses[i]))
                accounts.set(r.state.addresses[i], structuredClone(r.state.value[i]));
    // Both pools get declared synthetic20SOL WSOL reserves to test concurrent
    // mechanics; the historical low-liquidity account bytes remain unchanged.
    for (const r of retained) {
        const address = r.state.addresses[6], wire = structuredClone(accounts.get(address)!), b = Buffer.from(wire.data[0], 'base64');
        b.writeBigUInt64LE(20000000000n, 64);
        wire.lamports = Number(20000000000n + b.readBigUInt64LE(113));
        wire.data[0] = b.toString('base64');
        accounts.set(address, wire);
    }
    let at = Date.parse('2026-10-30T18:00:00Z'), slot = Math.max(...retained.map(r => r.state.context.slot)), outage = false, preparationFailure = false, executionUnavailable = false, sourceFatal: string | null = null;
    const originalNow = Date.now;
    Date.now = () => at;
    let started = at;
    const end = at + 1800000, dir = mkdtempSync(join(tmpdir(), 'poe-OFFLINE-native-paper-')), db = join(dir, 'fixture.sqlite'), account = POE_OPERATING_ACCOUNT.accountId;
    let ledger = new PaperLedger(db, account), closed = false;
    const price = (): UsdPrice => ({ microUsdPerSol: '1000000000', at, source: 'OFFLINE synthetic USD1000/SOL' });
    ledger.initialize({ ...price(), at: POE_OPERATING_ACCOUNT.inceptionAt }, POE_OPERATING_ACCOUNT.inceptionAt);
    ledger.activateEquityRiskPolicy(at);
    ledger.reconcile('fixture-current-day', at, price(), {});
    const backups = join(dir, 'backups');
    mkdirSync(backups, { mode: 0o700 });
    at += 100;
    await ledger.beginAuthorizedTenSolEpoch({ authorization: PAPER_TEN_SOL_EPOCH_AUTHORIZATION, backupDirectory: backups, assetDisposition: PAPER_EPOCH_ASSET_SEGREGATION, price: price() }, () => at);
    at += 100;
    await ledger.beginAuthorizedV3TenSolEpoch({ authorization: PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION, backupDirectory: backups, assetDisposition: PAPER_EPOCH_ASSET_SEGREGATION, price: price() }, () => at);
    at = Math.ceil(at / 10000) * 10000;
    started = at;
    const auditReadiness: Array<{
        mint: string;
        recovered: boolean;
        extraRpc: number;
    }> = [];
    const records: Array<{
        kind: string;
        data: any;
    }> = [], calls: Array<{
        method: string;
        at: number;
        accounts: number;
    }> = [], states = new Map<string, {
        window: FlowWindow | null;
        openedAt: number | null;
        subscription: number;
        pool: string;
        notes: NativeNotification[];
        supportSlot: number;
    }>();
    let engine: NativeCandidateRunner, bridge: NativePaper, market: PilotMarket, subscription = 40, syntheticSequence = 700000;
    const record = (kind: string, data: unknown) => { records.push({ kind, data: structuredClone(data) }); readiness.afterRecord?.(kind, data); };
    const flow = { dataContract: 'confirmed-program-activity-v3-shadow', addCandidate(scope: any) { states.set(scope.mint, { window: null, openedAt: null, subscription: ++subscription, pool: scope.pool, notes: [], supportSlot: slot }); }, removeCandidate(mint: string) { states.delete(mint); }, snapshot(mint: string, when = at) { const s = states.get(mint); if (!s)
            return null; const features = s.window?.features(when) ?? null, lower = s.openedAt === null ? null : { slot: s.supportSlot, availableAt: s.openedAt, bankClockAt: Math.floor(s.openedAt / 1000) * 1000 }, upper = s.openedAt === null ? null : { slot: slot + 1, availableAt: at, bankClockAt: Math.floor(at / 1000) * 1000 }; return { scope: { mint, pool: s.pool }, dataContract: 'confirmed-program-activity-v3-shadow', openedAt: s.openedAt, connectionId: 1, subscription: s.openedAt === null ? null : s.subscription, connected: s.openedAt !== null, sourceSupportFresh: true, hasQualityLoss: false, warm: features?.sufficientlyObserved === true, features, supportContext: upper, openingSupportContext: lower, supportContexts: [...(lower ? [lower] : []), ...(upper ? [upper] : [])], strictV2Unavailable: false }; }, notificationLedger(mint: string) { return structuredClone(states.get(mint)?.notes ?? []); }, requestSupportRefresh() { }, requestHeartbeat() { }, async service() { for (const [mint, s] of states)
            if (s.openedAt === null) {
                const support: ResearchClockObservationSupport = { mint, pool: s.pool, at, sourceSlot: s.supportSlot, evidence: 'OFFLINE synthetic current pool validation before ACK', summary: {} as ResearchClockObservationSupport['summary'] };
                engine.onCurrentPoolValidated(support);
                bridge.currentPoolValidated(support);
                s.openedAt = at;
                s.window = new FlowWindow(mint, at);
                engine.onFlowOpen({ mint, at });
                bridge.opened({ mint, at });
                return { kind: 'subscribe' };
            } return { kind: 'idle' }; }, usage() { return { dataContract: 'confirmed-program-activity-v3-shadow', connected: [...states.values()].some(s => s.openedAt !== null), stopped: false, lastBankClockAt: Math.floor(at / 1000) * 1000, lastFreshSupportAt: at, candidates: states.size, retiring: 0, nextServiceAt: [...states.values()].some(s => s.openedAt === null) ? at : at + 20000, fatal: sourceFatal, physicalTransportsSettled: states.size === 0 }; }, async stop() { states.clear(); } };
    const wireRpc = { async call<T>(method: string, params: unknown[] = []): Promise<T> { assert.ok(['getMultipleAccounts', 'getBlockTime', 'getMinimumBalanceForRentExemption', 'getSignaturesForAddress'].includes(method)); assert.ok(calls.length < 500, 'finite offline request trace'); calls.push({ method, at, accounts: method === 'getMultipleAccounts' ? (params[0] as string[]).length : 0 }); if (outage)
            throw Error('OFFLINE_PRICING_OUTAGE'); if (method === 'getBlockTime')
            return Math.floor(at / 1000) as T; if (method === 'getMinimumBalanceForRentExemption')
            return (1000000 + Number(params[0])) as T; if (method === 'getSignaturesForAddress') {
            const s = [...states.values()].find(s => s.pool === params[0])!;
            return [...s.notes].reverse().map(n => ({ signature: n.signature, slot: n.slot, err: null, blockTime: Math.floor(n.availableAt / 1000), confirmationStatus: 'confirmed' })).concat([{ signature: sig(1), slot: s.supportSlot - 1, err: null, blockTime: Math.floor(started / 1000), confirmationStatus: 'confirmed' }]) as T;
        } const b = Buffer.alloc(40); b.writeBigUInt64LE(BigInt(slot)); b.writeBigInt64LE(BigInt(Math.floor(at / 1000)), 32); return { context: { slot }, value: (params[0] as string[]).map(a => a === SYSVAR_CLOCK_PUBKEY.toBase58() ? { owner: 'Sysvar1111111111111111111111111111111111111', data: [b.toString('base64'), 'base64'], lamports: 1169280, executable: false, rentEpoch: 0 } : structuredClone(accounts.get(a) ?? null)) } as T; }, usage() { return { inFlight: 0, waitingOrOperating: false, cumulativeUnits: calls.length, dispatchWindow: { readyAt: at, physicalBusy: false } }; }, cooldownUntil() { return 0; } };
    let routed: any = wireRpc;
    const rpc = { call: <T>(method: string, params: unknown[] = [], signal?: AbortSignal, options?: unknown) => routed.call(method, params, signal, options) as Promise<T>, usage: () => routed.usage(), cooldownUntil: () => routed.cooldownUntil() };
    let binding: PilotBinding = LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING;
    const compose = (restoredPools?: ReturnType<NativePaper['poolsForRecovery']>) => { market = new PilotMarket({ executionRealism: true, ...(readiness.reusePreparedEntryRent ? { reusePreparedEntryRent: true as const } : {}), ...(readiness.beforeEntryPreparationRead ? { beforeEntryPreparationRead: readiness.beforeEntryPreparationRead } : {}), rpc, inventory: () => ledger.state(), price, now: () => at, recorder: { record }, gas: { baseFeeLamports: '5000', priorityFeeLamports: '2000', evidence: 'OFFLINE explicit7000 modeled gas' } }); const executionQuote = market.executionQuote; Object.defineProperty(market, 'executionQuote', { value: (...args: Parameters<typeof executionQuote>) => executionUnavailable ? Promise.resolve(null) : executionQuote(...args) }); const prepare = market.prepareEntryCosts.bind(market); market.prepareEntryCosts = async (...args) => { if (preparationFailure)
        throw Error('OFFLINE temporary preparation unavailable'); const result = await prepare(...args); readiness.afterPreparation?.(); return result; }; bridge = new NativePaper({ executionRealism: true, withProtectionWork: readiness.withProtectionWork, withFinancialExecutionWork: readiness.withFinancialExecutionWork, operatingFinancialReadiness: readiness.operatingFinancialReadiness, ...(technicalReevaluation ? { onTechnicalReevaluation: (request: any) => engine.requestTechnicalReevaluation(request.mint, request.reason, request.failedWindowEndAt, request.at, request.claimedOnly), onEvaluationComplete: (mint: string, when: number) => engine.finishTechnicalReevaluation(mint, when) } : {}), ledger, market, binding, source: flow as any, certificate: (mint, when) => engine?.currentAuditCertificate(mint, when) ?? null, record, now: () => at, admitNewRisk: () => capacity && (readiness.riskAdmission?.() ?? true) && end - at >= 910000 && 1500 - calls.length >= 490 && !Object.keys(ledger.state().pending).length, admitFinancialReadiness: when => readiness.financialAdmission?.(when) ?? readiness.financialReady !== false, internalShutdownRecovery: when => ledger.internalShutdownRecoveryProof(readiness.knownRunIds ?? [], when), restoredPools }); return market; };
    readiness.beforeInitialCompose?.(ledger, at);
    compose();
    engine = new NativeCandidateRunner({ flow: flow as any, rpc: rpc as any, record, now: () => at, activeStrategy: 'liquidity-resilient-momentum-v3.1', activeAssessment: (mint, features, when) => bridge.candidateAssessment(mint, features, when), activeEvidence: (mint, when) => bridge.candidateEvidence(mint, when), maximumDeep: readiness.maximumDeep ?? 4, admissionOpen: readiness.sourceAdmission, sourceInformationAdmission: readiness.sourceInformationAdmission, sourceWorkAdmission: readiness.sourceWorkAdmission, resolve: async (seed) => { const source = retained[0]!.origin, signature = source.transaction.signatures[0], decoded = decodeMigrationIdentity(source, { signature, commitment: 'finalized', availableAt: at }); assert.ok(decoded.ok); const mint = seed.feedMint!; return { ok: true, identity: { ...decoded.identity, signature: seed.signature, baseMint: mint, pool: canonicalPumpPoolPda(new PublicKey(mint)).toBase58(), chainBlockTime: Math.floor((started - 600000) / 1000), availableAt: at }, evidence: 'OFFLINE_SYNTHETIC_IDENTITY_FOR_COORDINATED_SCHEDULING_ONLY', proof: { source: 'direct-confirmed-creation', seed, originConfirmed: { signature: seed.signature, availableAt: at, transaction: source, commitment: 'confirmed' }, originFinalized: { signature: seed.signature, availableAt: at, transaction: source, commitment: 'finalized' } } } as any; }, onCandidateAllocated: id => bridge.allocated(id), onCandidateRetired: (mint, reason) => bridge.retiredCandidate(mint, reason), onAuditAvailable: readiness.auditReadiness ? certificate => { assert.ok(records.some(r => r.kind === 'native-predictive-assessment' && r.data.mint === certificate.mint && r.data.windowEndAt === certificate.windowEndAt), 'mandatory assessment evidence precedes financial readiness'); const before = calls.length, result = bridge.maintainFlatFinancialReadiness(price(), readiness.financialReady !== false, certificate.mint); auditReadiness.push({ mint: certificate.mint, recovered: result.recovered, extraRpc: calls.length - before }); } : undefined, financialOwnership: mint => bridge.ownership(mint) });
    // Retiming is explicit and confined to in-memory disposable fixture copies;
    // original captured chain timestamps/files are never rewritten or called live.
    for (const [index, r] of retained.entries()) {
        if (index > 0) {
            engine.onMigration({ signature: sig(500000 + index), feedMint: r.proof.quote.mint, receivedAt: at });
            continue;
        }
        const transaction = structuredClone(r.origin);
        transaction.blockTime = Math.floor((started - 600000) / 1000);
        const signature = transaction.transaction.signatures[0];
        engine.importOrigin({ originConfirmed: { signature, availableAt: at, transaction }, originFinalized: { signature, availableAt: at, transaction } });
    }
    t.after(() => { if (!closed)
        ledger.close(); Date.now = originalNow; rmSync(dir, { recursive: true, force: true }); });
    return { retained, records, calls, engine, flow, price, dir, wireRpc, states, get market() { return market; }, seedPeer(n: number) { const mint = new PublicKey(Buffer.alloc(32, 150 + n)).toBase58(); engine.onMigration({ signature: sig(600000 + n), feedMint: mint, receivedAt: at }); return mint; }, emitAll(bucket: number) { for (const [mint, state] of states) {
            if (!state.window)
                continue;
            slot++;
            const trade: NormalizedTrade = { identity: { kind: 'program-log', signature: sig(++syntheticSequence), program: PUMP_AMM_PROGRAM_ID.toBase58(), logIndex: 3, frameOrdinal: 0 }, mint, wallet: bs58.encode(Buffer.alloc(32, 80 + bucket % 6)), side: 'buy', quoteLamports: '1000000', tokenUnits: String(1000000 - bucket % 6 * 20000), receivedAt: at, commitment: 'confirmed', slot };
            state.window.ingest(trade);
            state.notes.push({ subscriptionMint: mint, subscriptionPool: state.pool, subscriptionId: state.subscription, connectionId: 1, signature: trade.identity.signature, slot, receivedAt: at, availableAt: at, success: true, rawHash: 'a'.repeat(64), parsedEvents: 1, eventsAccepted: 1, duplicate: false, correction: false, classification: 'program-event', reason: null, chainBlockTime: null });
            engine.onTrade();
            bridge.trade({ trade, evidence: { trader: trade.wallet, eventBytesSha256: 'a'.repeat(64), userBaseTokenReserveUnits: '0', reserveObservation: { baseReserveUnits: '1000000000000', rawQuoteReserveLamports: '20000000000', virtualQuoteReserveLamports: '0' } } as any, validatedAt: at, dataContract: 'confirmed-program-activity-v3-shadow', transferCrossCheck: 'UNAVAILABLE' });
        } }, route: (rpc: any) => { routed = rpc; }, get bridge() { return bridge; }, get ledger() { return ledger; }, get at() { return at; }, set at(value: number) { at = value; slot++; }, async open() { for (let n = 0; n < 5; n++)
            await engine.step(); assert.equal(states.size, 2); assert.ok([...states.values()].every(s => s.openedAt === started)); }, warm() { for (let n = 0; n < 6; n++) {
            at = started + n * 10000 + 100;
            for (const [mint, s] of states) {
                if (readiness.quiet)
                    continue;
                slot++;
                const trade: NormalizedTrade = { identity: { kind: 'program-log', signature: sig(1000 + n * 10 + s.subscription), program: PUMP_AMM_PROGRAM_ID.toBase58(), logIndex: 3, frameOrdinal: 0 }, mint, wallet: bs58.encode(Buffer.alloc(32, 80 + n)), side: 'buy', quoteLamports: '500000000', tokenUnits: String(1000000 - n * 20000), receivedAt: at, commitment: 'confirmed', slot };
                s.window!.ingest(trade);
                s.notes.push({ subscriptionMint: mint, subscriptionPool: s.pool, subscriptionId: s.subscription, connectionId: 1, signature: trade.identity.signature, slot, receivedAt: at, availableAt: at, success: true, rawHash: 'a'.repeat(64), parsedEvents: 1, eventsAccepted: 1, duplicate: false, correction: false, classification: 'program-event', reason: null, chainBlockTime: null });
                engine.onTrade();
                bridge.trade({ trade, evidence: { trader: trade.wallet, eventBytesSha256: 'a'.repeat(64), userBaseTokenReserveUnits: '0', reserveObservation: { baseReserveUnits: '1000000000000', rawQuoteReserveLamports: '20000000000', virtualQuoteReserveLamports: '0' } } as any, validatedAt: at, dataContract: 'confirmed-program-activity-v3-shadow', transferCrossCheck: 'UNAVAILABLE' });
            }
        } at = started + 60000; slot++; }, async audit() { for (let n = 0; n < 8 && engine.status().counters.auditedWindows < 2; n++)
            await engine.step(); assert.equal(engine.status().counters.auditedWindows, 2); assert.equal(engine.certifiedCandidateMints().length, readiness.quiet ? 0 : 2); } };
}
