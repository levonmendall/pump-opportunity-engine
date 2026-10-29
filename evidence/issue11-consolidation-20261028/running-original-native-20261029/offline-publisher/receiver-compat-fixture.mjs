// Offline synthetic protocol fixture. No live account files or credentials.
// Run: node /tmp/poe-publisher-offline-diagnostic-20261029/receiver-compat-fixture.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

let unexpectedGlobalFetchCalls = 0;
globalThis.fetch = async () => {
  unexpectedGlobalFetchCalls++;
  throw Error('REAL_FETCH_FORBIDDEN_IN_OFFLINE_FIXTURE');
};

const frozenPublisherPath = '/tmp/poe-native-paper-output-original-issue11-20261029/snapshot-publisher.mjs';
const compiledReceiverPath = '/workspace/poe-render-compat-receiver/dist/src/reporting.js';
const compiledIntelligencePath = '/workspace/poe-render-compat-receiver/dist/src/operating-intelligence.js';
const receiverSourcePath = '/workspace/poe-render-compat-receiver/src/reporting.ts';
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const { SnapshotFilePublisher, ORIGINAL_SNAPSHOT_URL } = await import(frozenPublisherPath);
const { SnapshotCache } = await import(compiledReceiverPath);

const identity = {
  accountId: 'poe-3123e352-4581-455b-85db-acd7e825e99e',
  inceptionAt: '2026-10-26T22:07:36.212Z',
  release: '5e55d8b939de99698ddb311a282461931fcbc957',
  strategy: 'persistent-buying-pilot-v1',
};
const generatedAt = new Date().toISOString();
const syntheticSnapshot = {
  project: 'pump-opportunity-engine', mode: 'PAPER', liveTrading: false, schemaVersion: 1,
  account: { id: identity.accountId, inceptionAt: identity.inceptionAt, initialUsd: 1000 },
  sequence: '1', source: { release: identity.release, strategy: identity.strategy },
  times: { generatedAt, marketAt: null, reconciledAt: null, usefulProgressAt: null },
  status: { runtime: 'running', market: 'warming', entries: 'paused', reconciled: false, blocker: null },
  balances: {
    cashSol: '0', reservedSol: '0', equitySol: null, equityUsd: null, realizedUsd: null,
    unrealizedUsd: null, tradingPnlUsd: null, economicPnlUsd: null, positionCostUsd: 0,
    markedExposureUsd: null, drawdownUsd: null, executionCostsUsd: null,
    operatingCostsUsd: null, passiveSolEquityUsd: null, solPriceUsd: null,
  },
  costLabels: { execution: 'simulated', operating: 'unavailable' },
  positions: [], trades: [], decisions: [], pnl: [],
  history: { windowStartAt: null, downsampled: false, label: 'offline synthetic fixture' },
  funnel: {
    discovered: 0, supported: 0, sufficientlyObserved: 0, evaluated: 0, qualified: 0,
    attempted: 0, paperFilled: 0, exited: 0, reconciled: 0,
  },
  metrics: {
    processingLagMs: null, eventLoopLagMs: null, providerEvents: 0, rpcRequests: 0,
    projectedDailyDataSol: null, budgetRemainingSol: null, budgetStatus: 'unavailable',
    coverage: 'offline synthetic fixture', latency: 'offline synthetic fixture',
  },
};

let mockFetchCalls = 0;
let acknowledgement;
const rawSourceSha256 = '1'.repeat(64);
const cache = new SnapshotCache(identity);
const publisher = new SnapshotFilePublisher({
  // Constructor and offered snapshot are tested; no snapshot file is opened.
  file: '/nonexistent/snapshot.json', identity, secret: 'offline-synthetic-secret-0000',
  fetch: async (url, options) => {
    mockFetchCalls++;
    if (url !== ORIGINAL_SNAPSHOT_URL || options.method !== 'POST') throw Error('UNEXPECTED_MOCK_REQUEST');
    const result = cache.accept(JSON.parse(options.body));
    return new Response(JSON.stringify({ result }), {
      status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
  onAcknowledgement: value => { acknowledgement = value; },
});
publisher.publisher.offer(syntheticSnapshot, rawSourceSha256);
const metrics = await publisher.publisher.publishOnce();
const result = {
  fixtureKind: 'synthetic-offline-frozen-publisher-to-receiver-cache-v1',
  generatedAt, nodeVersion: process.version, nodeExecutable: process.execPath,
  inputs: [frozenPublisherPath, compiledReceiverPath, compiledIntelligencePath, receiverSourcePath]
    .map(path => ({ path, sha256: sha256(path) })),
  identity,
  assertions: {
    mockFetchCalls,
    successes: metrics.successes,
    failures: metrics.failures,
    acknowledgementResult: acknowledgement?.result ?? null,
    rawSourceSha256Matched: acknowledgement?.rawSourceSha256 === rawSourceSha256,
    receiverSequence: cache.read()?.snapshot.sequence ?? null,
    unexpectedGlobalFetchCalls,
  },
  scope: {
    realNetworkUsed: false,
    actualCredentialsRead: false,
    actualFinancialFilesRead: false,
    repositoryFilesModified: false,
    snapshotFixtureSynthetic: true,
  },
};
result.passed = mockFetchCalls === 1 && metrics.successes === 1 && metrics.failures === 0
  && acknowledgement?.result === 'accepted' && acknowledgement?.rawSourceSha256 === rawSourceSha256
  && cache.read()?.snapshot.sequence === '1' && unexpectedGlobalFetchCalls === 0;
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
