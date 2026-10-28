import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDashboard, type DashboardConfig } from '../src/dashboard.js';
import { MAX_SNAPSHOT_BYTES, SnapshotCache, SnapshotPublisher, validateSnapshot, type ReportingIdentity, type Snapshot } from '../src/reporting.js';

const NOW = Date.now();
const iso = (at: number) => new Date(at).toISOString();
const config: DashboardConfig & ReportingIdentity = {
  accountId: 'fixture-reporting-account', inceptionAt: iso(NOW - 600_000), release: 'fixture-release', strategy: 'fixture-rule',
  viewerUser: 'fixture-owner', viewerPassword: 'fixture-viewer-password-unique', ingestionSecret: 'fixture-ingestion-secret-unique',
};
const viewer = 'Basic ' + Buffer.from(`${config.viewerUser}:${config.viewerPassword}`).toString('base64');
const machine = `Bearer ${config.ingestionSecret}`;
function sample(sequence = '1', generated = NOW): Snapshot {
  return {
    project: 'pump-opportunity-engine', mode: 'PAPER', liveTrading: false, schemaVersion: 1,
    account: { id: config.accountId, inceptionAt: config.inceptionAt, initialUsd: 1000 }, sequence,
    source: { release: config.release, strategy: config.strategy },
    times: { generatedAt: iso(generated), marketAt: iso(generated - 1000), reconciledAt: iso(generated - 2000), usefulProgressAt: iso(generated - 1000) },
    status: { runtime: 'running', market: 'observing', entries: 'disabled', reconciled: true, blocker: 'Disposable reporting fixture only' },
    balances: { cashSol: '10', reservedSol: '0.1', equitySol: '10', equityUsd: 1000, realizedUsd: 0, unrealizedUsd: 0, tradingPnlUsd: 0, economicPnlUsd: null, positionCostUsd: 0, markedExposureUsd: 0, drawdownUsd: 0, executionCostsUsd: 0, operatingCostsUsd: null, passiveSolEquityUsd: 1000, solPriceUsd: 100 },
    costLabels: { execution: 'simulated', operating: 'unavailable' },
    positions: [], trades: [], decisions: [], pnl: [],
    history: { windowStartAt: null, downsampled: false, label: 'No fixture history; no implied flat line' },
    funnel: { discovered: 12, supported: 5, sufficientlyObserved: 2, evaluated: 2, qualified: 0, attempted: 0, paperFilled: 0, exited: 0, reconciled: 0 },
    metrics: { processingLagMs: null, eventLoopLagMs: null, providerEvents: 0, rpcRequests: 0, projectedDailyDataSol: null, budgetRemainingSol: null, budgetStatus: 'unavailable', coverage: 'Not measured', latency: 'Not measured' },
  };
}
async function serve(t: { after: (fn: () => Promise<void>) => void }, settings: DashboardConfig = config) {
  const app = createDashboard(settings);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); });
  const url = `http://127.0.0.1:${address.port}`;
  const get = (path: string, auth?: string) => fetch(url + path, { headers: auth ? { authorization: auth } : {} });
  const post = (value: unknown, auth = machine) => fetch(url + '/api/snapshot', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(value) });
  return { ...app, url, get, post };
}

test('cache starts empty, accepts whole snapshots atomically, retains gaps and clones read model', () => {
  const cache = new SnapshotCache(config);
  assert.equal(cache.read(), null); assert.equal(cache.status(NOW).state, 'waiting');
  const s = sample();
  s.pnl = [{ at: iso(NOW - 5000), tradingUsd: -1, economicUsd: null }, { at: iso(NOW - 4000), tradingUsd: null, economicUsd: null }, { at: iso(NOW - 3000), tradingUsd: 2, economicUsd: 1 }];
  assert.equal(cache.accept(s, NOW), 'accepted');
  s.balances.equityUsd = 123;
  assert.equal(cache.read()!.snapshot.balances.equityUsd, 1000);
  const read = cache.read()!; read.snapshot.balances.equityUsd = 44;
  assert.equal(cache.read()!.snapshot.balances.equityUsd, 1000);
  assert.equal(cache.read()!.snapshot.pnl[1]!.tradingUsd, null);
  assert.equal(new SnapshotCache(config).read(), null); // restart/redeploy loses cache, never seeds equity
});

test('identical retries ignore JSON key order without refreshing receiver/source time; regression/conflict rejected', () => {
  const cache = new SnapshotCache(config); const s = sample('10'); cache.accept(s, NOW);
  const reverseKeys = Object.fromEntries(Object.entries(s).reverse());
  assert.equal(cache.accept(reverseKeys, NOW + 20_000), 'duplicate');
  assert.equal(cache.read()!.receivedAt, iso(NOW));
  assert.throws(() => cache.accept(sample('9'), NOW + 1000), /regression/);
  const conflict = sample('10'); conflict.balances.equityUsd = 999;
  assert.throws(() => cache.accept(conflict, NOW + 1000), /conflict/);
  assert.throws(() => cache.accept(sample('11', NOW - 1000), NOW), /generation time regression/);
  assert.equal(cache.read()!.snapshot.sequence, '10');
});

test('wrong account/source, unexpected fields, nonfinite values and inconsistent chronology are rejected', () => {
  const wrong = sample(); wrong.account.id = 'other-account';
  assert.throws(() => validateSnapshot(wrong, config, NOW), /account/);
  const release = sample(); release.source.release = 'unexpected-release';
  assert.throws(() => validateSnapshot(release, config, NOW), /source/);
  assert.throws(() => validateSnapshot({ ...sample(), ingestionSecret: 'forbidden' }, config, NOW), /fields/);
  const bad = sample(); bad.balances.equityUsd = NaN;
  assert.throws(() => validateSnapshot(bad, config, NOW), /finite/);
  const future = sample(); future.decisions = [{ id: 'future', mint: 'fixture-mint', at: iso(NOW + 1), stage: 'evaluated', reason: 'fixture' }];
  assert.throws(() => validateSnapshot(future, config, NOW), /chronology/);
  const old = sample(); old.trades = [{ id: 'old', mint: 'fixture-mint', at: iso(NOW - 700_000), side: 'buy', quantity: '1', valueUsd: 10, executionCostsUsd: 0.1, status: 'fixture', reason: 'fixture' }];
  assert.throws(() => validateSnapshot(old, config, NOW), /chronology/);
  const history = sample(); history.pnl = [{ at: iso(NOW - 100), tradingUsd: 0, economicUsd: null }, { at: iso(NOW - 200), tradingUsd: 1, economicUsd: null }];
  assert.throws(() => validateSnapshot(history, config, NOW), /chronology/);
});

test('fresh publishing heartbeat cannot disguise stale market/accounting, stopped runtime, or unreconciled data', () => {
  const cache = new SnapshotCache(config); const stale = sample();
  stale.times.marketAt = iso(NOW - 120_000); stale.times.reconciledAt = iso(NOW - 120_000);
  cache.accept(stale, NOW); assert.equal(cache.status(NOW).state, 'stale');
  const beat = sample('2', NOW + 1000); beat.times.marketAt = stale.times.marketAt; beat.times.reconciledAt = stale.times.reconciledAt;
  cache.accept(beat, NOW + 1000); assert.equal(cache.status(NOW + 1000).state, 'stale');
  const warming = sample('3', NOW + 2000); warming.status.market = 'warming'; cache.accept(warming, NOW + 2000);
  assert.equal(cache.status(NOW + 2000).state, 'warming'); assert.equal(cache.status(NOW + 100_000).state, 'stale');
  const stopped = sample('4', NOW + 3000); stopped.status.runtime = 'stopped'; cache.accept(stopped, NOW + 3000);
  assert.equal(cache.status(NOW + 3000).state, 'unavailable');
  const unreconciled = sample('5', NOW + 4000); unreconciled.status.reconciled = false; cache.accept(unreconciled, NOW + 4000);
  assert.equal(cache.status(NOW + 4000).state, 'unavailable');
});

test('dashboard separates public liveness, owner viewer and machine-only ingestion', async t => {
  const app = await serve(t);
  assert.equal((await app.get('/healthz')).status, 200);
  assert.equal((await app.get('/status')).status, 401);
  assert.equal((await app.get('/api/snapshot', machine)).status, 401);
  assert.equal((await app.get('/api/snapshot', viewer)).status, 503);
  assert.equal((await app.post(sample(), viewer)).status, 401);
  assert.equal((await app.post(sample(), 'Bearer incorrect')).status, 401);
  assert.equal((await app.post(sample())).status, 200);
  assert.equal((await app.post(sample())).status, 200);
  const read = await (await app.get('/api/snapshot', viewer)).json() as { snapshot: Snapshot };
  assert.equal(read.snapshot.account.id, config.accountId);
  assert.equal(read.snapshot.balances.equityUsd, 1000);
  const status = await (await app.get('/status', viewer)).json() as { state: string };
  assert.equal(status.state, 'observing-with-zero-trades');
  assert.equal((await fetch(app.url + '/reset', { method: 'POST', headers: { authorization: viewer } })).status, 405);
});

test('explicit public dashboard needs no viewer credentials but never permits unauthenticated ingestion', async t => {
  const app = await serve(t, { ...config, viewerUser: '', viewerPassword: '', publicViewer: true });
  assert.equal((await app.get('/')).status, 200);
  assert.equal((await app.get('/status')).status, 200);
  assert.equal((await app.get('/api/snapshot')).status, 503);
  assert.equal((await app.get('/api/export')).status, 503);
  assert.equal((await app.post(sample(), viewer)).status, 401);
  assert.equal((await app.post(sample(), 'Bearer incorrect')).status, 401);
  assert.equal((await app.post(sample())).status, 200);
  assert.equal((await app.get('/api/snapshot')).status, 200);
  assert.equal((await app.get('/api/export')).status, 200);
  assert.equal((await fetch(app.url + '/reset', { method: 'POST' })).status, 405);
  assert.equal((await fetch(app.url + '/api/snapshot', { method: 'PUT' })).status, 405);
  assert.equal((await app.get('/unknown')).status, 404);
  assert.equal((await app.get('/').then(r => r.headers.get('www-authenticate'))), null);
});

test('public viewer never weakens ingestion secret or permits partial source identity', () => {
  assert.throws(() => createDashboard({ ...config, viewerUser: '', viewerPassword: '', publicViewer: true, ingestionSecret: '' }), /ingestion secret/);
  assert.throws(() => createDashboard({ ...config, viewerUser: '', viewerPassword: '', publicViewer: true, inceptionAt: undefined }), /complete source identity/);
});

test('command center UI is accessible and purely cosmetic, not a trading control', async t => {
  const app = await serve(t, { ...config, viewerUser: '', viewerPassword: '', publicViewer: true });
  const resp = await app.get('/');
  assert.equal(resp.status, 200);
  const html = await resp.text();
  assert.match(html, /POE \/\/ Opportunity Command Center/);
  assert.match(html, /role="status"/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /aria-label="Dashboard navigation"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /No authenticated EC2 snapshot has been received/);
  assert.match(html, /NO VERIFIED P&L SERIES/);
  assert.match(html, /Missing samples remain gaps/);
  assert.ok(!html.includes('onerror='));
  assert.ok(!html.includes('onclick='));
  assert.ok(!html.includes('fetch(\'http'));
  assert.equal((await app.get('/api/snapshot')).status, 503);
  assert.equal((await app.post(sample(), 'Bearer not-the-machine-key')).status, 401);
});

test('HTTP rejects wrong account, conflict, regressions, malformed and oversized payloads', async t => {
  const app = await serve(t); await app.post(sample('2'));
  assert.equal((await app.post(sample('1'))).status, 409);
  const conflict = sample('2'); conflict.balances.equityUsd = 998;
  assert.equal((await app.post(conflict)).status, 409);
  const wrong = sample('3'); wrong.account.id = 'wrong';
  assert.equal((await app.post(wrong)).status, 400);
  assert.equal((await app.post({ ...sample('3'), walletSecret: 'not-allowed' })).status, 400);
  assert.equal((await fetch(app.url + '/api/snapshot', { method: 'POST', headers: { authorization: machine, 'content-type': 'application/json' }, body: 'x'.repeat(MAX_SNAPSHOT_BYTES + 1) })).status, 413);
  const tooMany = sample('3'); tooMany.decisions = Array.from({ length: 51 }, (_, i) => ({ id: String(i), mint: 'fixture', at: iso(NOW), stage: 'rejected', reason: 'fixture' }));
  assert.equal((await app.post(tooMany)).status, 400);
  assert.equal(app.cache.read()!.snapshot.sequence, '2');
});

test('bounded exports contain no configuration secrets; HTML uses safe DOM and mobile layout', async t => {
  const app = await serve(t); const s = sample();
  s.positions = [{ mint: 'fixture-mint', label: '<img src=x onerror=alert(1)>', quantity: '1', enteredAt: iso(NOW - 5000), entryCostUsd: 10, netLiquidationUsd: null, executionCostsUsd: 0.1, status: 'fixture' }];
  await app.post(s);
  const exported = await (await app.get('/api/export', viewer)).text();
  assert.ok(exported.includes('<img src=x onerror=alert(1)>')); // data remains text; it is never interpolated into HTML
  assert.ok(!exported.includes(config.ingestionSecret)); assert.ok(!exported.includes(config.viewerPassword));
  const response = await app.get('/', viewer); const html = await response.text();
  assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.match(html, /width=device-width/); assert.match(html, /@media\(max-width:640px\)/); assert.match(html, /textContent/);
  assert.ok(!html.includes('.innerHTML')); assert.ok(!html.includes(config.ingestionSecret)); assert.ok(!html.includes('<img src=x onerror'));
  assert.match(html, /LIVE EXECUTION DISABLED/); assert.match(html, /Zero is the reference line/); assert.match(html, /UTC/);
});

test('publisher does not send on construction; outages retain only latest snapshot and recover independently', async () => {
  const cache = new SnapshotCache(config); const deliveries: string[] = []; let fail = true;
  let delivered!: () => void;
  const completed = new Promise<void>(resolve => { delivered = resolve; });
  const publisher = new SnapshotPublisher({ url: 'https://fixture.example/api/snapshot', secret: config.ingestionSecret, identity: config,
    intervalMs: 10, maxBackoffMs: 30, timeoutMs: 100,
    fetch: async (_url, options) => {
      const value = JSON.parse(options!.body as string) as Snapshot;
      deliveries.push(value.sequence);
      if (fail) { fail = false; publisher.offer(sample('2')); publisher.offer(sample('3')); return new Response('', { status: 503 }); }
      cache.accept(value); delivered(); return new Response('{}', { status: 200 });
    },
  });
  publisher.offer(sample('1')); assert.equal(deliveries.length, 0); assert.equal(publisher.queuedSequence(), '1');
  publisher.start();
  await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('publisher recovery timeout')), 2000))]);
  await publisher.stop();
  assert.deepEqual(deliveries, ['1','3']); assert.equal(cache.read()!.snapshot.sequence, '3');
  assert.equal(publisher.metrics.failures, 1); assert.equal(publisher.metrics.successes, 1); assert.equal(publisher.queuedSequence(), null);
  assert.throws(() => publisher.offer(sample('2')), /regression/);
});

test('publisher timeout is bounded, retains latest, sanitizes errors and never follows redirects', async () => {
  let aborted!: () => void; const sawAbort = new Promise<void>(resolve => { aborted = resolve; });
  const publisher = new SnapshotPublisher({ url: 'https://fixture.example/api/snapshot', secret: config.ingestionSecret, identity: config, intervalMs: 10, timeoutMs: 10, maxBackoffMs: 20,
    fetch: async (_url, options) => {
      assert.equal(options!.redirect, 'error');
      return await new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => { aborted(); reject(new Error('secret=should-never-be-logged')); }));
    },
  });
  publisher.offer(sample()); publisher.start(); await sawAbort; await publisher.stop();
  assert.equal(publisher.queuedSequence(), '1'); assert.equal(publisher.metrics.lastError, 'network_unavailable');
  assert.throws(() => new SnapshotPublisher({ url: 'http://fixture.example', secret: config.ingestionSecret, identity: config }), /HTTPS/);
});

test('unconfigured source is a deployable authenticated waiting page and never adopts a sender identity', async t => {
  const credentials = { viewerUser: config.viewerUser, viewerPassword: config.viewerPassword, ingestionSecret: config.ingestionSecret };
  const app = await serve(t, credentials);
  assert.equal((await app.get('/healthz')).status, 200);
  assert.equal((await app.get('/')).status, 401);
  const response = await app.get('/', viewer); const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Awaiting authoritative data/);
  assert.ok(!html.includes('$1,000')); assert.ok(!html.includes('fixture-reporting-account'));
  assert.match(html, /class="stat top empty"/); assert.match(html, /NO SYNTHETIC BALANCES OR TRADES/);
  assert.deepEqual(await (await app.get('/api/snapshot', viewer)).json(), { state: 'waiting', message: 'Awaiting POE data' });
  const status = await (await app.get('/status', viewer)).json() as { state: string; message: string; sourceConfigured: boolean; generatedAt: string | null };
  assert.equal(status.state, 'waiting'); assert.equal(status.message, 'Awaiting POE data');
  assert.equal(status.sourceConfigured, false); assert.equal(status.generatedAt, null);
  for (const payload of [sample(), {}, null, { account: { id: 'sender-selected-identity' } }]) {
    const rejected = await app.post(payload);
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), { error: 'source-not-configured', message: 'Awaiting POE data' });
  }
  assert.equal(app.cache.identity, null); assert.equal(app.cache.read(), null);
  assert.throws(() => app.cache.accept(sample()), /source-not-configured/);
});

test('partial source identity fails configuration and credentials remain mandatory before source setup', () => {
  const credentials = { viewerUser: config.viewerUser, viewerPassword: config.viewerPassword, ingestionSecret: config.ingestionSecret };
  for (const partial of [{ accountId: config.accountId }, { inceptionAt: config.inceptionAt }, { release: config.release }, { strategy: config.strategy }, { accountId: config.accountId, inceptionAt: config.inceptionAt, release: config.release }]) {
    assert.throws(() => createDashboard({ ...credentials, ...partial }), /complete source identity/);
  }
  assert.throws(() => createDashboard({ ...credentials, viewerPassword: '' }), /credentials required/);
  assert.throws(() => createDashboard({ ...credentials, ingestionSecret: '' }), /ingestion secret required/);
});


test('observer connectivity exposes inactive stages without altering accepted financial data', async t => {
  const observerConfig = {...config, strategy: 'UNIMPLEMENTED_FLOW_BLOCKED', publicViewer: true};
  const app = await serve(t, observerConfig);
  const fixture = sample(); fixture.source.strategy = observerConfig.strategy;
  const before = JSON.stringify(fixture);
  assert.equal((await app.post(fixture)).status, 200);
  const response = await app.get('/api/connections');
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.sourceConfigured, true);
  assert.equal(report.sourceRole, 'discovery-observer');
  assert.equal(report.connection, 'receiving');
  assert.equal(report.capabilities.candidatePipeline, 'not-implemented-in-source');
  assert.equal(report.capabilities.decisionTrace, 'not-implemented-in-source');
  assert.equal(report.experimentalPilot.connected, false);
  assert.equal(report.source.accountId, config.accountId);
  assert.equal(report.source.inceptionAt, config.inceptionAt);
  assert.equal(report.source.sequence, fixture.sequence);
  assert.ok(!JSON.stringify(report).includes(config.ingestionSecret));
  const snapshot = await app.get('/api/snapshot').then(r=>r.json());
  assert.equal(JSON.stringify(snapshot.snapshot), before);
  assert.equal(snapshot.connections.sourceRole, 'discovery-observer');
  assert.equal((await app.post(fixture,'Bearer invalid')).status,401);
});

test('connectivity is read-only, obeys viewer auth, and never invents a source', async t => {
  const privateApp = await serve(t);
  assert.equal((await privateApp.get('/api/connections')).status,401);
  const report = await privateApp.get('/api/connections',viewer).then(r=>r.json());
  assert.equal(report.connection,'awaiting-source');
  assert.equal(report.source,null);
  assert.equal(report.sourceRole,'unknown');
  const result = await fetch(privateApp.url+'/api/connections',{method:'POST',headers:{authorization:viewer}});
  assert.equal(result.status,405);
});

test('connectivity diagnostics age cached source data and do not refresh on duplicate delivery', async () => {
  const { connectionReport } = await import('../src/dashboard-connectivity.js');
  const cache = new SnapshotCache(config); const fixture=sample();
  cache.accept(fixture,NOW);
  cache.accept(fixture,NOW+30_000);
  const report=connectionReport(cache,NOW+91_000);
  assert.equal(report.connection,'stale');
  assert.equal(report.sourceAgeMs,91_000);
  assert.equal(report.receivedAgeMs,91_000);
  assert.equal(report.source?.sequence,fixture.sequence);
  assert.equal(report.capabilities.candidatePipeline,'runtime-reported');
});

test('dashboard explains observer placeholders, supports mobile refresh, and has valid scripts', async t => {
  const app=await serve(t,{...config,publicViewer:true});
  const html=await app.get('/').then(r=>r.text());
  assert.match(html,/Source &amp; pipeline status/);
  assert.match(html,/Not connected to this dashboard/);
  assert.match(html,/NOT ACTIVE/);
  assert.match(html,/EVALUATION ENGINE NOT CONNECTED/);
  assert.match(html,/visibilitychange/);
  assert.match(html,/setInterval\(refresh,15000\)/);
  assert.match(html,/refreshInFlight/);
  assert.match(html,/maximumFractionDigits:decimals/);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,4);
  for(const match of scripts)assert.doesNotThrow(()=>new Function(match[1]!));
  assert.equal((await app.get('/healthz').then(r=>r.json())).connectivityDiagnostics,1);
});
