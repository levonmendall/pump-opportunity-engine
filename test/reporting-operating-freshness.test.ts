import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createContext, Script } from 'node:vm';
import { createDashboard } from '../src/dashboard.js';
import { connectionReport } from '../src/dashboard-connectivity.js';
import { projectOperatingIntelligence, ORIGINAL_POE_ACCOUNT, ORIGINAL_POE_INCEPTION } from '../src/operating-intelligence.js';
import { operatingSnapshotFreshness, SnapshotCache, type Snapshot, type ReportingIdentity } from '../src/reporting.js';
import { projectMarketCoverageReporting } from '../src/market-coverage-reporting.js';
import { projectNativeSlotProductivityReporting, NATIVE_SLOT_STATES, NATIVE_SLOT_COUNTS, NATIVE_SLOT_WAITS } from '../src/native-slot-productivity-reporting.js';

const T = Date.parse('2026-10-29T17:00:00.000Z');
const iso = (at: number) => new Date(at).toISOString();
const identity: ReportingIdentity = { accountId: ORIGINAL_POE_ACCOUNT, inceptionAt: ORIGINAL_POE_INCEPTION, release: 'a'.repeat(40), strategy: 'persistent-buying-pilot-v1' };
function sample(): Snapshot {
  return {
    project: 'pump-opportunity-engine', mode: 'PAPER', liveTrading: false, schemaVersion: 1,
    account: { id: identity.accountId, inceptionAt: identity.inceptionAt, initialUsd: 1000 }, sequence: '1',
    source: { release: identity.release, strategy: identity.strategy },
    times: { generatedAt: iso(T), marketAt: iso(T - 1000), reconciledAt: iso(T - 400), usefulProgressAt: iso(T - 1000) },
    status: { runtime: 'running', market: 'observing', entries: 'paused', reconciled: true, blocker: null },
    balances: { cashSol: '10', reservedSol: '0', equitySol: '10', equityUsd: 1000, realizedUsd: 0, unrealizedUsd: 0, tradingPnlUsd: 0, economicPnlUsd: null, positionCostUsd: 0, markedExposureUsd: 0, drawdownUsd: null, executionCostsUsd: null, operatingCostsUsd: null, passiveSolEquityUsd: 1000, solPriceUsd: 100 },
    costLabels: { execution: 'simulated', operating: 'unavailable' }, positions: [], trades: [], decisions: [], pnl: [],
    history: { windowStartAt: null, downsampled: false, label: 'Disposable reporting fixture only' },
    funnel: { discovered: 2, supported: 2, sufficientlyObserved: 0, evaluated: 0, qualified: 0, attempted: 0, paperFilled: 0, exited: 0, reconciled: 0 },
    metrics: { processingLagMs: null, eventLoopLagMs: null, providerEvents: 0, rpcRequests: 0, projectedDailyDataSol: null, budgetRemainingSol: null, budgetStatus: 'unavailable', coverage: 'Not measured', latency: 'Not measured' },
    intelligence: projectOperatingIntelligence({ accountId: identity.accountId, inceptionAt: Date.parse(identity.inceptionAt), generatedAt: T, startedAt: T - 600000, runId: 'reporting-only-fixture', strategyVersion: identity.strategy, configurationSha256: 'b'.repeat(64), persistent: true, positions: {}, pending: {}, usage: { native: { connected: true }, feeds: { discoveryConnected: true, pumpApiConnected: true } } }),
  };
}
const classify = (s: Snapshot, now = T, receivedAt = iso(T)) => operatingSnapshotFreshness(s, receivedAt, now)!;
function selectedSample(kind: 'vacant' | 'replacement' | 'pending' | 'acknowledged' = 'vacant'): Snapshot {
  const s = sample(), i = s.intelligence!, at = T - 1100, startedAt = T - 500000;
  s.status.entries = 'enabled'; s.status.market = 'unavailable'; i.quality.captureConnected = false;
  const occupied = kind === 'pending' || kind === 'acknowledged' ? 1 : 0;
  i.candidates.deepMaximum = 4; i.candidates.deepActive = occupied;
  const scope = { version: 'native-slot-productivity-v1', scope: 'CURRENT_SOURCE_INSTANCE', runId: i.run.id, sourceInstanceId: 'native-runner:' + i.run.id + ':fixture', startedAt, generatedAt: at, configuredSlots: 4 };
  i.slotProductivity = projectNativeSlotProductivityReporting({ slotProductivity: {
    ...scope, stateMs: Object.fromEntries(NATIVE_SLOT_STATES.map(state => [state, 0])),
    slots: Array.from({ length: 4 }, (_, slot) => ({ slot, mint: slot === 0 && occupied ? '11111111111111111111111111111111' : null,
      state: slot === 0 && occupied ? kind === 'pending' ? 'SUBSCRIPTION_WAIT' : 'EVIDENCE_WARMING' : kind === 'vacant' ? 'VACANT' : 'REPLACEMENT_WAIT',
      sinceAt: at - 500, stateAgeMs: 500, allocatedAt: slot === 0 && occupied ? at - 500 : null, openedAt: slot === 0 && kind === 'acknowledged' ? at - 200 : null, windowEndAt: null })),
    counts: Object.fromEntries(NATIVE_SLOT_COUNTS.map(key => [key, 0])), waits: Object.fromEntries(NATIVE_SLOT_WAITS.map(key => [key, { count: 0, sum: 0, mean: null, max: null, p50: null, p95: null }])),
    percentileScope: 'ALL_ACTUAL_STARTS_IN_SOURCE_INSTANCE', limitations: [],
  } }, T);
  i.marketCoverage = projectMarketCoverageReporting({ runId: i.run.id, marketCoverage: { version: 'poe-market-coverage-v1', generatedAt: at,
    pipeline: { ...scope, version: 'native-pipeline-throughput-v1', population: { activeDeep: occupied }, flow: {},
      capacityWitness: { configuredSlots: 4, physicalOccupancy: occupied, sourceReady: true, providerReady: false, localReady: false } },
  } }, T);
  assert.ok(i.slotProductivity); assert.ok(i.marketCoverage?.pipeline);
  return s;
}

for (const kind of ['vacant', 'replacement', 'pending'] as const) test('current selected scope distinguishes ' + kind + ' without changing coverage or permission', () => {
  const s = selectedSample(kind), before = structuredClone(s), expected = kind === 'pending' ? 'awaiting-subscription' : 'idle';
  const cache = new SnapshotCache(identity); cache.accept(s, T); const status = cache.status(T);
  assert.ok('operating' in status); const f = status.operating!;
  assert.equal(f.state, expected); assert.equal(f.market, expected); assert.equal(f.selectedCaptureState, expected); assert.equal(f.selectedCapture, false);
  assert.equal(f.selectedScope!.configuredSlots, 4); assert.equal(f.selectedScope!.acknowledgedSlots, 0);
  assert.equal(f.selectedScope!.assignedSlots, kind === 'pending' ? 1 : 0);
  assert.equal(f.selectedScope!.oldestPendingMs, kind === 'pending' ? 1600 : null);
  assert.equal(f.reasonCodes.includes('SELECTED_CAPTURE_LOST'), false); assert.equal(f.discovery, true); assert.equal(f.watch, true);
  assert.deepEqual(s, before); assert.deepEqual(cache.read()!.snapshot, before);
  assert.equal(s.status.market, 'unavailable'); assert.equal(s.status.entries, 'enabled'); assert.equal(s.mode, 'PAPER'); assert.equal(s.liveTrading, false);
});

test('retiring physical subscriptions do not turn empty or awaiting logical slots into capture loss', () => {
  for (const kind of ['replacement', 'pending'] as const) {
    const s = selectedSample(kind); s.intelligence!.marketCoverage!.pipeline!.capacityWitness!.physicalOccupancy = 4;
    const f = classify(s); assert.equal(f.state, kind === 'pending' ? 'awaiting-subscription' : 'idle'); assert.equal(f.selectedCapture, false);
    assert.equal(f.reasonCodes.includes('SELECTED_CAPTURE_LOST'), false);
  }
});

test('a previously acknowledged assignment still reports actual loss amid empty slots or a new pending subscription', () => {
  const s = selectedSample('acknowledged'), i = s.intelligence!;
  let f = classify(s); assert.equal(f.state, 'unavailable'); assert.equal(f.selectedCaptureState, 'lost'); assert.ok(f.reasonCodes.includes('SELECTED_CAPTURE_LOST'));
  i.slotProductivity!.slots[1] = { ...i.slotProductivity!.slots[0]!, slot: 1, mint: '22222222222222222222222222222222', state: 'SUBSCRIPTION_WAIT', openedAt: null };
  i.candidates.deepActive = 2; i.marketCoverage!.pipeline!.population.activeDeep = 2; i.marketCoverage!.pipeline!.capacityWitness!.physicalOccupancy = 2;
  f = classify(s); assert.equal(f.selectedScope!.acknowledgedSlots, 1); assert.equal(f.selectedScope!.awaitingAcknowledgement, 1);
  assert.equal(f.state, 'unavailable'); assert.ok(f.reasonCodes.includes('SELECTED_CAPTURE_LOST'));
  i.quality.captureConnected = true; assert.equal(classify(s).state, 'observing-with-zero-trades');
  i.quality.captureConnected = null; assert.equal(classify(s).market, 'unknown');
});

const inconsistentScope: [string, (s: Snapshot) => void][] = [
  ['missing slots', s => { delete s.intelligence!.slotProductivity; }],
  ['missing pipeline', s => { delete s.intelligence!.marketCoverage!.pipeline; }],
  ['wrong slot run', s => { s.intelligence!.slotProductivity!.runId = 'previous-run'; }],
  ['wrong pipeline run', s => { s.intelligence!.marketCoverage!.pipeline!.runId = 'previous-run'; }],
  ['wrong source instance', s => { s.intelligence!.slotProductivity!.sourceInstanceId += '-old'; }],
  ['wrong embedded run identity', s => { s.intelligence!.slotProductivity!.sourceInstanceId = s.intelligence!.marketCoverage!.pipeline!.sourceInstanceId = 'native-runner:previous-run:fixture'; }],
  ['different measurement time', s => { s.intelligence!.slotProductivity!.generatedAt = iso(T - 1200); }],
  ['stale slot facts', s => { s.intelligence!.slotProductivity!.generatedAt = s.intelligence!.marketCoverage!.pipeline!.generatedAt = iso(T - 90001); }],
  ['future slot facts', s => { s.intelligence!.slotProductivity!.generatedAt = s.intelligence!.marketCoverage!.pipeline!.generatedAt = iso(T + 1); }],
  ['missing configured slot', s => { s.intelligence!.slotProductivity!.slots.pop(); }],
  ['duplicate slot', s => { s.intelligence!.slotProductivity!.slots[1]!.slot = 0; }],
  ['different configured capacity', s => { s.intelligence!.candidates.deepMaximum = 3; }],
  ['unreported logical occupancy', s => { s.intelligence!.candidates.deepActive = null; }],
  ['conflicting pipeline occupancy', s => { s.intelligence!.marketCoverage!.pipeline!.population.activeDeep = 2; }],
  ['physical occupancy below assigned slots', s => { s.intelligence!.marketCoverage!.pipeline!.capacityWitness!.physicalOccupancy = 0; }],
  ['physical occupancy exceeds capacity', s => { s.intelligence!.marketCoverage!.pipeline!.capacityWitness!.physicalOccupancy = 99; }],
  ['vacant slot retains ACK', s => { s.intelligence!.slotProductivity!.slots[1]!.openedAt = iso(T - 1500); }],
  ['pending slot retains window', s => { s.intelligence!.slotProductivity!.slots[0]!.windowEndAt = iso(T - 1200); }],
  ['pending slot lacks allocation', s => { s.intelligence!.slotProductivity!.slots[0]!.allocatedAt = null; }],
];
for (const [label, mutate] of inconsistentScope) test('optional scope cannot suppress capture failure: ' + label, () => {
  const s = selectedSample('pending'); mutate(s); const f = classify(s);
  assert.equal(f.state, 'unavailable'); assert.equal(f.selectedScope, null); assert.ok(f.reasonCodes.includes('SELECTED_CAPTURE_LOST'));
});

test('subscription delay is measured at source generation and never misreported as losing an ACK', () => {
  const s = selectedSample('pending'), slot = s.intelligence!.slotProductivity!.slots[0]!;
  slot.allocatedAt = iso(T - 90000); assert.equal(classify(s).state, 'awaiting-subscription');
  assert.equal(classify(s, T + 15000).reasonCodes.includes('SELECTED_SUBSCRIPTION_DELAYED'), false);
  slot.allocatedAt = iso(T - 90001); const f = classify(s);
  assert.equal(f.state, 'unavailable'); assert.equal(f.market, 'awaiting-subscription'); assert.ok(f.reasonCodes.includes('SELECTED_SUBSCRIPTION_DELAYED'));
  assert.equal(f.reasonCodes.includes('SELECTED_CAPTURE_LOST'), false);
});

test('idle and pending do not hide feed failure, stale reporting, stopped runtime or financial warnings', () => {
  for (const kind of ['vacant', 'pending'] as const) {
    const s = selectedSample(kind), i = s.intelligence!;
    for (const feed of ['discoveryConnected', 'watchConnected'] as const) for (const value of [false, null]) {
      i.provider[feed] = value; assert.equal(classify(s).state, 'unavailable'); assert.notEqual(classify(s).selectedCaptureState, 'lost'); i.provider[feed] = true;
    }
    assert.equal(classify(s, T + 90001).state, 'stale'); assert.equal(classify(s, T, iso(T - 90001)).state, 'stale');
    s.status.runtime = 'stopped'; assert.equal(classify(s).state, 'unavailable'); s.status.runtime = 'running';
    s.status.entries = 'paused'; s.status.blocker = 'POE_ENTRY_RECONCILIATION_STALE'; s.status.reconciled = false; s.balances.equityUsd = null;
    const f = classify(s); assert.equal(f.entryRestriction, 'POE_ENTRY_RECONCILIATION_STALE');
    assert.ok(f.reasonCodes.includes('RECONCILIATION_NOT_CURRENT')); assert.ok(f.reasonCodes.includes('USD_VALUATION_UNAVAILABLE')); assert.equal(s.status.entries, 'paused');
  }
});

test('financial obligations and active source recovery retain warnings while selected scope remains factual', () => {
  const s = selectedSample('vacant'), i = s.intelligence!;
  s.positions = [{ mint: 'fixture-mint', label: 'fixture', quantity: '1', enteredAt: iso(T - 30000), entryCostUsd: 1, netLiquidationUsd: null, executionCostsUsd: 0, status: 'unavailable' }];
  let f = classify(s); assert.equal(f.selectedCaptureState, 'idle'); assert.equal(f.state, 'unavailable');
  assert.ok(f.reasonCodes.includes('SELECTED_CAPTURE_REQUIRED')); assert.ok(f.reasonCodes.includes('PROTECTION_UNAVAILABLE'));
  s.positions = []; i.pendingOrders = [{ id: 'pending-fixture', mint: 'fixture-mint', side: 'buy', decidedAt: iso(T - 500), executeAt: iso(T + 500), expiresAt: iso(T + 1000), reservedSol: '0', quantityMinimum: '1', reason: 'fixture' }];
  assert.ok(classify(s).reasonCodes.includes('SELECTED_CAPTURE_REQUIRED')); i.pendingOrders = [];
  i.admission = { financialProjectionReady: true, supervisedNewRiskAllowed: false, candidateResourceAdmissionAllowed: true, evidenceAdmissionAllowed: true, evidencePressureReasonCode: null, evidenceDiagnosticBytes: 0, evidenceDiagnosticLimitBytes: 100, evidenceRequiresCriticalRecovery: false, evidenceRefusedRecords: 0, sourceRecoveryGeneration: 1, sourceRecoveryFailures: 5, sourceRecoveryReasonCode: null, sourceRecoveryRetryAt: null, sourceRecoveryClosingSettled: false, sourceRestartRequired: false, proofPreparationState: 'complete' };
  i.quality.qualityGaps = 100; i.provider.httpErrors = 100;
  assert.equal(classify(s).state, 'idle', 'cumulative failures and closing-settled false are not current outages');
  i.admission.sourceRestartRequired = true; f = classify(s); assert.equal(f.state, 'unavailable'); assert.ok(f.reasonCodes.includes('SOURCE_RECOVERY'));
  i.admission.sourceRestartRequired = false; i.admission.evidenceRequiresCriticalRecovery = true; f = classify(s); assert.equal(f.state, 'unavailable'); assert.ok(f.reasonCodes.includes('EVIDENCE_PRESSURE'));
});
const currentEntryMessages = {
  POE_ENTRY_MANUAL_PAUSE: 'The owner paused new entries',
  POE_ENTRY_SAFE_STOP: 'A safe stop is active; existing obligations remain',
  POE_ENTRY_DAILY_LOSS: 'The daily loss protection restricts new entries',
  POE_ENTRY_FINANCIAL_UNCERTAINTY: 'Financial state or an order outcome is unresolved; new entries remain closed',
  POE_ENTRY_EVIDENCE_UNAVAILABLE: 'Required trading evidence is unavailable; new entries remain closed',
  POE_ENTRY_USD_UNAVAILABLE: 'A fresh SOL/USD price is unavailable; new entries remain closed',
  POE_ENTRY_LIQUIDATION_UNAVAILABLE: 'Fresh actual-size liquidation pricing is unavailable',
  POE_ENTRY_RECONCILIATION_REQUIRED: 'Financial reconciliation has not completed for the current account day',
  POE_ENTRY_RECONCILIATION_STALE: 'Financial reconciliation exceeds the two-second entry boundary',
  POE_ENTRY_PROVIDER_UNAVAILABLE: 'Provider access is unavailable or recovering; new entries remain closed',
  POE_ENTRY_SOURCE_UNAVAILABLE: 'Required market observation is unavailable or recovering',
  POE_ENTRY_MONITORING_UNAVAILABLE: 'New-entry monitoring or shared RPC capacity is temporarily reserved; position safeguards remain enforced.',
  POE_ENTRY_READINESS_REQUIRED: 'Fresh complete audited market evidence and financial readiness are required',
  POE_ENTRY_PROTECTION_RECOVERY_REQUIRED: 'New entries remain closed after a position-protection failure; verified protection recovery is required',
  POE_ENTRY_FINANCIAL_PAUSED: 'The ledger entry control is paused; verified recovery is still required',
};

test('modern source freshness is independent of unavailable USD and 2s financial reconciliation validity', () => {
  const s = sample(); s.status.market = 'unavailable'; s.status.reconciled = false;
  s.times.marketAt = null; s.times.reconciledAt = iso(T - 5000); s.balances.equityUsd = null; s.balances.solPriceUsd = null;
  const before = structuredClone(s), cache = new SnapshotCache(identity); cache.accept(s, T);
  const f = cache.status(T); assert.ok('operating' in f);
  assert.equal(f.state, 'entry-paused'); assert.equal(f.operating!.market, 'observing');
  assert.equal(f.operating!.reporting, 'current');
  assert.deepEqual(f.operating!.reasonCodes, ['USD_VALUATION_UNAVAILABLE', 'VALUATION_UNAVAILABLE', 'RECONCILIATION_NOT_CURRENT']);
  assert.deepEqual(cache.read()!.snapshot, before); assert.deepEqual(s, before);
  assert.equal(s.status.entries, 'paused'); assert.equal(s.status.reconciled, false); assert.equal(s.balances.equityUsd, null);
  assert.equal(connectionReport(cache, T).capabilities.discovery, 'reported');
});

test('modern valuation and reconciliation staleness remain warnings without hiding source or publisher staleness', () => {
  const s = sample(); s.times.marketAt = iso(T - 120000); s.times.reconciledAt = iso(T - 120000);
  const f = classify(s); assert.equal(f.state, 'entry-paused');
  assert.ok(f.reasonCodes.includes('VALUATION_STALE')); assert.ok(f.reasonCodes.includes('RECONCILIATION_STALE'));
  assert.equal(classify(s, T + 90000).state, 'entry-paused');
  const stale = classify(s, T + 90001); assert.equal(stale.state, 'stale'); assert.ok(stale.reasonCodes.includes('SOURCE_STALE')); assert.ok(stale.reasonCodes.includes('PUBLISHER_STALE'));
  const oldDelivery = classify(s, T, iso(T - 90001)); assert.equal(oldDelivery.state, 'stale'); assert.deepEqual(oldDelivery.reasonCodes.slice(0, 1), ['PUBLISHER_STALE']);
  const oldSource = sample(); oldSource.times.generatedAt = iso(T - 90001); assert.equal(classify(oldSource).state, 'stale');
  const cache = new SnapshotCache(identity); cache.accept(s, T); assert.equal(cache.accept(s, T + 90001), 'duplicate'); assert.equal(cache.status(T + 90001).state, 'stale');
});

test('actual selected capture loss is unavailable even while broad discovery continues, and null is unknown', () => {
  const s = sample(); s.intelligence!.quality.captureConnected = false;
  assert.equal(classify(s).state, 'unavailable'); assert.equal(classify(s).market, 'unavailable');
  assert.equal(classify(s).discovery, true); assert.ok(classify(s).reasonCodes.includes('SELECTED_CAPTURE_LOST'));
  s.intelligence!.quality.captureConnected = null; assert.equal(classify(s).state, 'unavailable'); assert.equal(classify(s).market, 'unknown');
  s.intelligence!.quality.captureConnected = true; s.intelligence!.provider.discoveryConnected = false; s.intelligence!.provider.watchConnected = false;
  const cache = new SnapshotCache(identity); cache.accept(s, T);
  assert.equal(cache.status(T).state, 'entry-paused'); assert.equal(connectionReport(cache, T).capabilities.discovery, 'unavailable');
  assert.ok(classify(s).reasonCodes.includes('DISCOVERY_LOST')); assert.ok(classify(s).reasonCodes.includes('WATCH_LOST'));
  s.status.market = 'warming'; assert.equal(classify(s).state, 'warming');
  s.status.runtime = 'stopped'; assert.equal(classify(s).state, 'unavailable'); assert.ok(classify(s).reasonCodes.includes('RUNTIME_STOPPED'));
  s.status.runtime = 'unavailable'; assert.ok(classify(s).reasonCodes.includes('RUNTIME_UNAVAILABLE'));
});

test('held protection and evidence pressure are explicit source-time facts, not inferred from browser age or cumulative errors', () => {
  const s = sample(); const i = s.intelligence!;
  s.positions = [{ mint: 'fixture-mint', label: 'fixture', quantity: '1', enteredAt: iso(T - 30000), entryCostUsd: 1, netLiquidationUsd: null, executionCostsUsd: 0, status: 'unavailable' }];
  i.protection = { state: 'monitored', targetCadenceMs: 2000, completedEvaluationBoundaryMs: 4000, lastCompletedAt: iso(T - 1000), maximumCompletedGapMs: 10000, maximumQuoteAgeAtUseMs: 5000, breaches: 50, unavailableChecks: 10 };
  i.provider.httpErrors = 100; i.provider.httpTimeouts = 100;
  assert.equal(classify(s, T + 15000).reasonCodes.includes('PROTECTION_OVERDUE'), false, 'a current source report is not extrapolated to a later browser protection check');
  i.protection.lastCompletedAt = iso(T - 5000); assert.ok(classify(s).reasonCodes.includes('PROTECTION_OVERDUE'));
  i.protection.state = 'degraded'; assert.ok(classify(s).reasonCodes.includes('PROTECTION_DEGRADED'));
  i.protection.state = 'unavailable'; assert.ok(classify(s).reasonCodes.includes('PROTECTION_UNAVAILABLE'));
  i.admission = { financialProjectionReady: true, supervisedNewRiskAllowed: false, candidateResourceAdmissionAllowed: false, evidenceAdmissionAllowed: false, evidencePressureReasonCode: 'DIAGNOSTIC_HEADROOM', evidenceDiagnosticBytes: 100, evidenceDiagnosticLimitBytes: 100, evidenceRequiresCriticalRecovery: true, evidenceRefusedRecords: 1, sourceRecoveryGeneration: 1, sourceRecoveryFailures: 1, sourceRecoveryReasonCode: 'ROLLING_RESOURCE_OR_EVIDENCE_PRESSURE', sourceRecoveryRetryAt: null, sourceRecoveryClosingSettled: false, sourceRestartRequired: false, proofPreparationState: 'complete' };
  for (const code of ['EVIDENCE_PRESSURE', 'RESOURCE_PRESSURE', 'SOURCE_RECOVERY']) assert.ok(classify(s).reasonCodes.includes(code));
});

test('known entry restrictions remain visible and unknown blocker text never enters derived facets', () => {
  const s = sample(); s.status.blocker = 'execution startup: fresh reconciliation/readiness required';
  assert.equal(classify(s).entryRestriction, 'ENTRY_READINESS_REQUIRED');
  s.status.blocker = 'explicit verified runtime readiness'; assert.equal(classify(s).entryRestriction, 'CURRENT_ENTRY_GATE_NOT_SATISFIED');
  s.status.blocker = 'operator paused new entries'; assert.equal(classify(s).entryRestriction, 'OWNER_ENTRY_PAUSE');
  s.status.blocker = 'safe stop requested'; assert.equal(classify(s).entryRestriction, 'SAFE_STOP_REQUESTED');
  s.status.blocker = 'https://provider.invalid/private/DO_NOT_EXPORT';
  const f = classify(s); assert.equal(f.entryRestriction, 'OTHER_SOURCE_RESTRICTION'); assert.equal(JSON.stringify(f).includes('DO_NOT_EXPORT'), false);
  assert.equal(s.status.blocker, 'https://provider.invalid/private/DO_NOT_EXPORT');
  s.status.entries = 'enabled'; assert.equal(classify(s).entryRestriction, null);
});

for (const code of Object.keys(currentEntryMessages)) test('current entry restriction remains precise without changing permission: ' + code, () => {
  const s = sample(); s.status.blocker = code;
  const before = structuredClone(s), f = classify(s);
  assert.equal(f.entryRestriction, code); assert.ok(f.reasonCodes.includes(code));
  assert.equal(f.state, 'entry-paused'); assert.equal(f.reporting, 'current');
  assert.deepEqual(s, before); assert.equal(s.status.entries, 'paused');
  s.status.entries = 'enabled'; assert.equal(classify(s).entryRestriction, null);
});

test('a familiar entry-code prefix cannot export unknown private blocker text', () => {
  const s = sample(); s.status.blocker = 'POE_ENTRY_USD_UNAVAILABLE: https://provider.invalid/DO_NOT_EXPORT';
  const f = classify(s); assert.equal(f.entryRestriction, 'OTHER_SOURCE_RESTRICTION');
  assert.equal(JSON.stringify(f).includes('DO_NOT_EXPORT'), false);
  assert.equal(JSON.stringify(f).includes('provider.invalid'), false);
});

test('legacy sources keep combined market/accounting validity semantics and do not gain inferred capture facts', () => {
  const s = sample(); delete s.intelligence; const cache = new SnapshotCache(identity); s.status.reconciled = false;
  cache.accept(s, T); assert.equal(cache.status(T).state, 'unavailable'); assert.equal('operating' in cache.status(T), false); assert.equal(operatingSnapshotFreshness(s, iso(T), T), null);
  s.sequence = '2'; s.times.marketAt = iso(T - 120000); cache.accept(s, T); assert.equal(cache.status(T).state, 'stale');
});

const replay = JSON.parse(readFileSync(new URL('./fixtures/operating-freshness-20261029.json', import.meta.url), 'utf8'));
function replaySnapshot(row: any): Snapshot {
  const s = sample();
  s.account = row.account; s.source = row.source; s.sequence = row.sequence; s.times = row.times; s.status = row.status;
  Object.assign(s.balances, row.balances); s.positions = row.positions; s.funnel.paperFilled = row.paperFilled;
  const i = s.intelligence!; i.run = row.intelligence.run; i.quality.captureConnected = row.intelligence.quality.captureConnected;
  Object.assign(i.provider, row.intelligence.provider); i.resources.state = row.intelligence.resources.state;
  i.protection = row.intelligence.protection; i.admission = row.intelligence.admission;
  return s;
}
test('57 actual 16:51–17:06 observations separate 39 reconciliation-only false alarms from two real capture losses', () => {
  assert.equal(replay.rows.length, 57); assert.match(replay.provenance.sourceSha256, /^[a-f0-9]{64}$/);
  let corrected = 0, trueLosses = 0;
  for (const row of replay.rows) {
    const s = replaySnapshot(row), before = structuredClone(s), f = classify(s, row.observedAt, row.receiverAt);
    assert.equal(s.source.release, 'cdba9d483fdcef105e74e3053a8d4bbf28bdff0c');
    assert.equal(f.reporting, 'current'); assert.deepEqual(s, before);
    if (row.previousState === 'unavailable' && f.selectedCapture === true) { corrected++; assert.notEqual(f.state, 'unavailable'); assert.ok(f.reasonCodes.includes('RECONCILIATION_NOT_CURRENT')); }
    if (f.selectedCapture === false) { trueLosses++; assert.equal(f.state, 'unavailable'); assert.equal(f.discovery, true); assert.ok(f.reasonCodes.includes('SELECTED_CAPTURE_LOST')); }
  }
  assert.equal(corrected, 39); assert.equal(trueLosses, 2);
});

const selectionReplay = JSON.parse(readFileSync(new URL('./fixtures/selected-capture-20261101.json', import.meta.url), 'utf8'));
function selectionReplaySnapshot(row: any): Snapshot {
  const s = selectedSample(), i = s.intelligence!;
  assert.equal(row.positionCount, 0); s.source = row.source; s.sequence = row.sequence; s.times = row.times; s.status = row.status;
  i.run = row.run; i.admission = row.admission; i.protection = row.protection; i.pendingOrders = row.pendingOrders;
  Object.assign(i.candidates, row.candidates); i.quality.captureConnected = row.captureConnected;
  i.provider.discoveryConnected = row.discoveryConnected; i.provider.watchConnected = row.watchConnected;
  i.slotProductivity = row.slotProductivity; i.marketCoverage!.pipeline = row.pipeline; i.marketCoverage!.generatedAt = row.pipeline.generatedAt;
  return s;
}
test('six deployed admission-repair observations preserve connected capture and correct two ACK waits plus empty-slot turnover', () => {
  assert.equal(selectionReplay.rows.length, 6); let corrected = 0;
  for (const row of selectionReplay.rows) {
    const s = selectionReplaySnapshot(row), before = structuredClone(s), cache = new SnapshotCache({ ...identity, ...s.source });
    cache.accept(s, row.observedAt); const f = operatingSnapshotFreshness(s, row.receivedAt, row.observedAt)!;
    assert.equal(f.selectedCaptureState, row.expectedCaptureState); assert.equal(f.selectedCapture, row.captureConnected);
    assert.equal(f.selectedScope!.configuredSlots, 4); assert.equal(f.reporting, 'current');
    assert.equal(f.reasonCodes.includes('SELECTED_CAPTURE_LOST'), false); assert.notEqual(f.state, 'unavailable');
    if (!row.captureConnected) { corrected++; assert.equal(f.selectedScope!.acknowledgedSlots, 0); }
    assert.deepEqual(s, before); assert.deepEqual(cache.read()!.snapshot, before);
  }
  assert.equal(corrected, 3);
});

test('actual served browser uses shared classifier, preserves true disconnections/read failures/stops, and never makes financial timestamps source freshness', async t => {
  const app = createDashboard({ ...identity, viewerUser: '', viewerPassword: '', publicViewer: true, ingestionSecret: 'disposable-freshness-fixture-secret' });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); });
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const html = await fetch(`http://127.0.0.1:${address.port}/`).then(r => r.text());
  const classifier = html.slice(html.indexOf('const classifyOperatingSnapshot = '), html.indexOf('\nconst byId='));
  const paint = html.slice(html.indexOf('function paintFreshness('), html.indexOf('\nclock();setInterval('));
  assert.ok(classifier.length > 1000); assert.equal(classifier.includes('__name('), false);
  const show = html.slice(html.indexOf('function showSnapshot('), html.indexOf('\nlet refreshInFlight='));
  const signals: string[][] = []; let now = T;
  const context = createContext({ Date: class extends Date { static now() { return now; } }, Math, latest: null, latestReceivedAt: null, readFailure: null, signal: (...args: string[]) => signals.push(args), renderCards() {}, put() {}, renderTable() {}, renderCandidateIntelligence() {}, renderMetrics() {}, plot() {}, money() {}, byId: () => ({ hidden: true }) });
  new Script(classifier + '\n' + paint + '\n' + show).runInContext(context);
  function run(s: Snapshot, receivedAt = iso(now)) {
    context.latest = s as any; context.latestReceivedAt = receivedAt as any;
    new Script('showSnapshot(latest,latestReceivedAt,{state: \"unavailable\"})').runInContext(context); return signals.at(-1)!;
  }
  for (const row of replay.rows) {
    now = row.observedAt; const result = run(replaySnapshot(row), row.receiverAt);
    if (row.intelligence.quality.captureConnected) { assert.match(result[0]!, /^RUNNING · OBSERVING$/); assert.doesNotMatch(result[0]!, /UNAVAILABLE|STALE/); }
    else { assert.match(result[0]!, /SELECTED CAPTURE UNAVAILABLE/); assert.match(result[1]!, /Broad discovery continues/); assert.equal(result[3], 'warning'); }
  }
  now = T;
  for (const kind of ['vacant', 'replacement', 'pending'] as const) {
    const selected = selectedSample(kind), result = run(selected);
    assert.equal(result[0], kind === 'pending' ? 'RUNNING · AWAITING SUBSCRIPTION' : 'RUNNING · NO SELECTED CANDIDATE');
    assert.match(result[1]!, kind === 'pending' ? /awaiting subscription acknowledgement/ : /No candidate currently occupies/);
    assert.equal(result[3], 'connected'); assert.doesNotMatch(result[1]!, /capture is disconnected|capture is unavailable/);
    selected.intelligence!.provider.watchConnected = false; const failed = run(selected);
    assert.match(failed[0]!, /SOURCE UNAVAILABLE/); assert.match(failed[1]!, /Lightweight watch activity is disconnected/); assert.equal(failed[3], 'warning');
    selected.intelligence!.provider.watchConnected = true; selected.status.runtime = 'stopped'; assert.equal(run(selected)[0], 'STOPPED');
  }
  for (const row of selectionReplay.rows) {
    now = row.observedAt; const s = selectionReplaySnapshot(row), result = run(s, row.receivedAt);
    const expected = row.expectedCaptureState === 'connected' ? 'OBSERVING' : row.expectedCaptureState === 'idle' ? 'NO SELECTED CANDIDATE' : 'AWAITING SUBSCRIPTION';
    assert.equal(result[0], 'RUNNING · ' + expected); assert.doesNotMatch(result[0]!, /UNAVAILABLE/);
  }
  now = T;
  for (const [code, message] of Object.entries(currentEntryMessages)) {
    const current = sample(); current.status.blocker = code;
    const result = run(current); assert.equal(result[0], 'RUNNING · OBSERVING');
    assert.ok(result[1]!.includes(message)); assert.doesNotMatch(result[1]!, /another source-reported condition/);
    assert.equal(result[3], 'warning'); assert.equal(current.status.entries, 'paused');
  }
  const unknown = sample(); unknown.status.blocker = 'POE_ENTRY_USD_UNAVAILABLE: DO_NOT_EXPORT';
  const unknownResult = run(unknown); assert.match(unknownResult[1]!, /another source-reported condition/);
  assert.doesNotMatch(unknownResult.join(' '), /DO_NOT_EXPORT/);
  now = T; const s = sample(); s.times.marketAt = iso(T - 120000); s.times.reconciledAt = iso(T - 120000); s.status.reconciled = false;
  let result = run(s); assert.equal(result[0], 'RUNNING · OBSERVING'); assert.match(result[1]!, /Financial valuation timestamp is over 90 seconds old/); assert.doesNotMatch(result[0]!, /STALE/);
  s.times.marketAt = null; s.balances.equityUsd = null; s.balances.solPriceUsd = null; result = run(s); assert.equal(result[0], 'RUNNING · OBSERVING'); assert.match(result[1]!, /USD valuation is unavailable/);
  s.status.runtime = 'stopped'; assert.equal(run(s)[0], 'STOPPED');
  context.readFailure = 'REPORTING_HTTP_503' as any; new Script('paintFreshness()').runInContext(context); result = signals.at(-1)!; assert.match(result[0]!, /Data link interrupted.*STOPPED/); assert.equal(result[3], 'error');
  context.readFailure = null; now = T + 90001; result = run(s, iso(T)); assert.equal(result[0], 'STOPPED · STALE SOURCE SNAPSHOT');
  s.status.runtime = 'running'; assert.equal(run(s, iso(T))[0], 'STALE SOURCE SNAPSHOT');
});

