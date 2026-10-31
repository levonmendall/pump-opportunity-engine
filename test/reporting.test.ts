import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Script, createContext } from 'node:vm';
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

test('receiver equity timeline records only authentic Portfolio Overview USD equity, not P&L-derived or invented points',()=>{
  const cache=new SnapshotCache(config);
  const at=Math.ceil(NOW/60_000)*60_000+1000;
  const first=sample('1',at);
  first.balances.equityUsd=982.25;
  first.balances.tradingPnlUsd=-400;
  first.pnl=[{at:config.inceptionAt,tradingUsd:-400,economicUsd:100}];
  assert.equal(cache.accept(first,at+500),'accepted');
  assert.equal(cache.accept(structuredClone(first),at+1000),'duplicate');
  assert.deepEqual(cache.equityHistory().points,[{at:iso(at),equityUsd:982.25}]);
  const second=sample('2',at+15000);second.balances.equityUsd=983.5;
  assert.equal(cache.accept(second,at+15_500),'accepted');
  assert.deepEqual(cache.equityHistory().points,[{at:iso(at+15000),equityUsd:983.5}],'latest real equity within the same minute replaces earlier sample');
  const unknown=sample('3',at+65000);unknown.balances.equityUsd=null;
  assert.equal(cache.accept(unknown,at+65_500),'accepted');
  assert.equal(cache.equityHistory().points.length,1,'unknown valuation is not interpreted as zero or the previous price');
  const third=sample('4',at+76000);third.balances.equityUsd=980.75;
  assert.equal(cache.accept(third,at+76_500),'accepted');
  const history=cache.equityHistory();
  assert.equal(history.accountId,config.accountId);
  assert.equal(history.source,'accepted-authoritative-portfolio-equity');
  assert.equal(history.retention,'receiver-memory-only');
  assert.equal(history.bucketMs,60_000);
  assert.deepEqual(history.points,[{at:iso(at+15000),equityUsd:983.5},{at:iso(at+76000),equityUsd:980.75}]);
  history.points[0]!.equityUsd=0;
  assert.equal(cache.equityHistory().points[0]!.equityUsd,983.5,'public read model is a defensive copy');
  assert.equal(new SnapshotCache(config).equityHistory().points.length,0,'receiver restart never fabricates prior equity history');
});

test('equity history uses the same authenticated source and remains separate from immutable snapshot/export content',async t=>{
  const app=await serve(t);
  assert.equal((await app.get('/api/snapshot')).status,401);
  const first=sample('10',NOW-70_000);first.balances.equityUsd=974.12;first.balances.tradingPnlUsd=-32;
  const second=sample('11',NOW-5000);second.balances.equityUsd=991.06;second.balances.tradingPnlUsd=-29;
  assert.equal((await app.post(first)).status,200);
  assert.equal((await app.post(second)).status,200);
  const fetched=await app.get('/api/snapshot',viewer);
  assert.equal(fetched.status,200);
  const value=await fetched.json() as {snapshot:Snapshot;equityHistory:{accountId:string;source:string;points:Array<{at:string;equityUsd:number}>}};
  assert.equal(value.snapshot.balances.equityUsd,991.06);
  assert.equal(value.snapshot.balances.tradingPnlUsd,-29,'P&L remains independent');
  assert.equal(value.equityHistory.accountId,config.accountId);
  assert.equal(value.equityHistory.source,'accepted-authoritative-portfolio-equity');
  assert.deepEqual(value.equityHistory.points,[
    {at:first.times.generatedAt,equityUsd:974.12},{at:second.times.generatedAt,equityUsd:991.06},
  ]);
  assert.equal(value.snapshot.pnl.length,0,'financial snapshot is never rewritten to contain equity history');
  assert.equal((await app.get('/api/export',viewer)).status,200);
  assert.equal((await app.post(sample('12'),'Bearer incorrect')).status,401,'unauthorized sender cannot add equity points');
  assert.equal(app.cache.equityHistory().points.length,2);
});

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
  assert.match(html, /RECORDING PORTFOLIO EQUITY/);
  assert.match(html, /Recorded from accepted Portfolio Equity reports/);
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
  assert.match(html, /LIVE EXECUTION DISABLED/); assert.match(html, /Recorded from accepted Portfolio Equity reports/); assert.match(html, /UTC/);
});

test('original positions and PAPER trades render safe token-chart links with no external requests', async t => {
  const app = await serve(t);
  const html = await app.get('/', viewer).then(r => r.text());
  const start = html.indexOf('function dexScreenerUrl('), end = html.indexOf('\nfunction renderFunnel(', start);
  assert.ok(start > 0 && end > start, 'link helper and table renderer exist in authoritative dashboard');
  assert.match(html, /s\.positions\.map\(p=>p\.mint\),0\)/);
  assert.match(html, /s\.trades\.map\(t=>t\.mint\),1(?:,|\))/);
  assert.doesNotMatch(html, /fetch\(['"]https:\/\/dexscreener/);
  class Cell {
    readonly children: Cell[] = [];
    textContent = '';
    className = '';
    href = '';
    target = '';
    rel = '';
    readonly attributes: Record<string, string> = {};
    constructor(readonly tag: string) {}
    append(...nodes: Cell[]) { this.children.push(...nodes); }
    replaceChildren() { this.children.length = 0; }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    all(tag: string): Cell[] { return [...(this.tag === tag ? [this] : []), ...this.children.flatMap(child => child.all(tag))]; }
  }
  const roots = new Map([['positions', new Cell('div')], ['trades', new Cell('div')], ['decisions', new Cell('div')]]);
  const byId = (id: string) => roots.get(id)!;
  const add = (parent: Cell, tag: string, text?: string, css?: string) => {
    const cell = new Cell(tag);
    if(text !== undefined)cell.textContent = String(text);
    if(css)cell.className = css;
    parent.append(cell);
    return cell;
  };
  const renderers = new Function('byId','add',html.slice(start, end)+';return {renderTable,dexScreenerUrl};')(byId,add) as {
    dexScreenerUrl: (mint: unknown) => string | null;
    renderTable: (id: string, headers: string[], rows: string[][], emptyTitle: string, emptyBody: string, mints?: string[], column?: number) => void;
  };
  const mint='qoRXadwqYw98Qe2TmQPrMJZzYXYM2vyA5NrTFDcpump';
  const href='https://dexscreener.com/solana/'+mint;
  assert.equal(renderers.dexScreenerUrl(mint),href);
  for(const fake of ['', 'fixture-mint', '<img src=x onerror=alert(1)>', 'https://evil.example/path', '11111111111111111111111111111111/evil', 'O'.repeat(44), 42])
    assert.equal(renderers.dexScreenerUrl(fake), null, 'invalid mint yields no link');
  renderers.renderTable('positions',['Token','Cost'],[[mint+' / 123','50'],['<script>alert(1)</script>','40']], 'EMPTY','No positions',[mint,'<script>alert(1)</script>'],0);
  const positionAnchors=roots.get('positions')!.all('a');
  assert.equal(positionAnchors.length,1);
  assert.equal(positionAnchors[0]!.href,href);
  assert.equal(positionAnchors[0]!.textContent,'View on DEX Screener ↗');
  assert.equal(positionAnchors[0]!.target,'_blank');
  assert.equal(positionAnchors[0]!.rel,'noopener noreferrer');
  assert.match(positionAnchors[0]!.attributes['aria-label']!,/opens a new tab/);
  assert.ok(roots.get('positions')!.all('td').some(c=>c.textContent.includes('<script>')),'unsafe labels remain text, never HTML');
  renderers.renderTable('trades',['Time','Mint','Value'],[['12:00',mint+' / 123','$50']], 'EMPTY','No trades',[mint],1);
  assert.equal(roots.get('trades')!.all('a')[0]!.href,href);
  renderers.renderTable('decisions',['Mint'],[[mint]],'EMPTY','No decisions');
  assert.equal(roots.get('decisions')!.all('a').length,0,'other tables gain no unsolicited links');
  renderers.renderTable('positions',['Token'],[],'EMPTY','No positions',[],0);
  assert.equal(roots.get('positions')!.all('a').length,0,'stale links disappear on refresh');
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
  assert.equal((await app.get('/api/connections')).status,404,'obsolete diagnostics route is retired');
  const {connectionReport}=await import('../src/dashboard-connectivity.js');
  const report=connectionReport(app.cache);
  assert.equal(report.sourceConfigured, true);
  assert.equal(report.sourceRole, 'discovery-observer');
  assert.equal(report.connection, 'receiving');
  assert.equal(report.capabilities.candidatePipeline, 'not-implemented-in-source');
  assert.equal(report.capabilities.decisionTrace, 'not-implemented-in-source');
  assert.equal(report.experimentalPilot.connected, false);
  assert.ok(report.source);
  assert.equal(report.source.accountId, config.accountId);
  assert.equal(report.source.inceptionAt, config.inceptionAt);
  assert.equal(report.source.sequence, fixture.sequence);
  assert.ok(!JSON.stringify(report).includes(config.ingestionSecret));
  const snapshot = await app.get('/api/snapshot').then(r=>r.json());
  assert.equal(JSON.stringify(snapshot.snapshot), before);
  assert.equal(snapshot.connections,undefined,'one original snapshot supplies the dashboard');
  assert.equal((await app.post(fixture,'Bearer invalid')).status,401);
});

test('connectivity is read-only, obeys viewer auth, and never invents a source', async t => {
  const privateApp = await serve(t);
  assert.equal((await privateApp.get('/api/connections')).status,401);
  assert.equal((await privateApp.get('/api/connections',viewer)).status,404);
  const {connectionReport}=await import('../src/dashboard-connectivity.js');
  const report=connectionReport(privateApp.cache);
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
  assert.match(html,/Runtime, source &amp; reporting health/);
  assert.doesNotMatch(html,/id="pilot-telemetry-panel"/);assert.doesNotMatch(html,/id="experimental-portfolio"/);
  assert.match(html,/NOT ACTIVE/);
  assert.match(html,/EVALUATION ENGINE NOT CONNECTED/);
  assert.match(html,/visibilitychange/);
  assert.match(html,/setInterval\(refresh,15000\)/);
  assert.match(html,/refreshInFlight/);
  assert.match(html,/value===null\|\|value===undefined\?'Unavailable'/);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  for(const match of scripts)assert.doesNotThrow(()=>new Function(match[1]!));
  assert.equal((await app.get('/healthz').then(r=>r.json())).unifiedPortfolio,true);
});


test('candidate progression sorts counts descending, updates dynamically, and preserves observer stage masking', async t => {
  const app = await serve(t, { ...config, viewerUser: '', viewerPassword: '', publicViewer: true });
  const html = await (await app.get('/')).text();
  const start = html.indexOf('function renderFunnel(');
  const end = html.indexOf('\nfunction renderMetrics(', start);
  assert.ok(start >= 0 && end > start, 'real browser-rendering function is present');
  class Node {
    textContent = '';
    className = '';
    dataset: Record<string,string> = {};
    style = { width: '' };
    children: Node[] = [];
    readonly classes = new Set<string>();
    readonly classList = { add: (name: string) => { this.classes.add(name); }, contains: (name: string) => this.classes.has(name) };
    get lastElementChild() { return this.children.at(-1)!; }
    append(...items: Node[]) { this.children.push(...items); }
    replaceChildren(...items: Node[]) { this.children = items; }
    querySelectorAll(selector: string): Node[] {
      const name = selector.replace(/^\./, '');
      return this.children.flatMap(child => [...(child.className.split(' ').includes(name) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector: string): Node | null { return this.querySelectorAll(selector)[0] ?? null; }
  }
  const root = new Node();
  let observerActive = false;
  const add = (parent: Node, _tag: string, value?: unknown, className?: string) => {
    const node = new Node();
    if (value !== undefined) node.textContent = String(value);
    node.className = className ?? '';
    parent.append(node);
    return node;
  };
  const context = createContext({
    byId: () => root, add, Number, Math, Intl,
    document: { getElementById: () => root },
    observer: () => observerActive, latest: {}, note: () => {},
  });
  new Script(html.slice(start,end)).runInContext(context);
  const render = (counts: Record<string,number|null>) =>
    new Script('renderFunnel(' + JSON.stringify(counts) + ',null,'+observerActive+')').runInContext(context);
  const rows = () => root.querySelectorAll('.funnel-line');
  const labels = () => rows().map(node => node.querySelector('.funnel-name')!.textContent);
  const count = (key: string) => rows().find(row => row.dataset.funnelStage === key)!.querySelector('.funnel-count')!.textContent;
  const order = ['supported','reconciled','evaluated','paperFilled','exited','qualified','discovered','sufficientlyObserved','attempted'];
  render({discovered:0,supported:15,sufficientlyObserved:null,evaluated:7,qualified:1,attempted:null,paperFilled:2,exited:2,reconciled:10});
  assert.deepEqual(labels(), ['Supported','Reconciled','Financial evaluations','PAPER filled','Exited','Qualified','Discovered','Sufficiently observed','Attempted']);
  assert.deepEqual(rows().map(row => row.dataset.funnelStage),order);
  assert.equal(count('supported'),'15');
  assert.equal(count('attempted'),'Not reported');
  assert.equal(rows()[0]!.querySelector('.funnel-fill')!.style.width,'100.00%');
  assert.equal(rows().at(-1)!.querySelector('.funnel-fill')!.style.width,'0%');
  assert.equal(rows().some(row => row.classes.has('inactive-stage')),false,'candidate counts remain unmasked for non-observer source');

  render({discovered:100,supported:15,sufficientlyObserved:2,evaluated:7,qualified:1,attempted:0,paperFilled:2,exited:2,reconciled:10});
  assert.equal(labels()[0],'Discovered','latest counts re-sort without refreshing the page');
  assert.equal(count('attempted'),'0','zero remains distinct from unavailable');

  observerActive = true;
  render({discovered:0,supported:15,sufficientlyObserved:null,evaluated:7,qualified:1,attempted:null,paperFilled:2,exited:2,reconciled:10});
  assert.equal(labels()[0],'Supported','observer masking does not assume discovered is first');
  assert.equal(count('supported'),'NOT ACTIVE');
  assert.equal(count('discovered'),'0');
  assert.equal(rows().find(row => row.dataset.funnelStage === 'discovered')!.classes.has('inactive-stage'),false);
  assert.ok(rows().filter(row => row.dataset.funnelStage !== 'discovered').every(row => row.classes.has('inactive-stage')));
});


test('compact command view keeps the original portfolio, permanent P&L chart and source diagnostics', async t => {
  const app = await serve(t, { ...config, publicViewer: true, viewerUser: '', viewerPassword: '' });
  const html = await app.get('/').then(r=>r.text());
  const sampleReport=sample();
  assert.equal((await app.post(sampleReport)).status,200);
  const snapshot=await app.get('/api/snapshot').then(r=>r.json());
  assert.deepEqual(snapshot.snapshot,sampleReport);
  for(const id of ['portfolio','cards','performance','chart','positions','trades','funnel','reporting-status','refreshNow','metrics','decisions','sourceLabel','stateTitle']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))??[]).length,1,'original source node retained: '+id);
  }
  for(const id of ['experimental-portfolio','experimental-portfolio-cards','pilot-telemetry-panel','pilot-funnel','pilot-watch','pilot-decisions','pilotConnection']){
    assert.doesNotMatch(html,new RegExp('id="'+id+'"'),'separate experimental panel removed: '+id);
  }
  assert.match(html,/function compactCommandView\(\)/);
  assert.match(html,/panelFold\('section\[aria-labelledby="metricsTitle"\]'/);
  assert.doesNotMatch(html,/panelFold\('#performance'/,'P&L graph always visible');
  assert.match(html,/panelFold\('section\[aria-labelledby="decisionsTitle"\]'/);
  assert.match(html,/document\.createElement\('details'\)/);
  assert.match(html,/document\.createElement\('summary'\)/);
  assert.match(html,/aria-expanded/);
  assert.match(html,/body\.poe-compact-view #portfolio:not\(\.compact-expanded\) #cards>\.stat:nth-child\(n\+7\)/);
  assert.doesNotMatch(html,/#experimental-portfolio/);
  assert.match(html,/artworkCaption\?\.classList\.contains\('holo-index'\)/);
  assert.match(html,/A new dimension/);
  assert.match(html,/class="hero-visual holo-visual"/);
  assert.match(html,/class="holo-object"/);
  assert.match(html,/class="holo-index"/);
  assert.match(html,/LIVE EXECUTION DISABLED/);
  assert.match(html,/source-reported P&amp;L convention|TOKEN TRADING P&L/);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  for(const script of scripts)assert.doesNotThrow(()=>new Function(script[1]!));
});

test('source funnel distinguishes observer placeholders, predictive assessments, actual financial decisions and unavailable unique counts',async t=>{
 const app=await serve(t,{...config,publicViewer:true}),html=await app.get('/').then(r=>r.text()),start=html.indexOf('function renderFunnel('),end=html.indexOf('\nfunction renderMetrics(',start);assert.ok(start>=0&&end>start);
 class Node{textContent='';className='';dataset:Record<string,string>={};style={width:''};classList={add:()=>{}};children:Node[]=[];get lastElementChild(){return this.children.at(-1)!;}querySelector(selector:string){return this.query(selector.replace(/^\./,''))[0]!;}append(...v:Node[]){this.children.push(...v);}replaceChildren(){this.children=[];}query(selector:string):Node[]{return this.children.flatMap(c=>[...(c.className===selector?[c]:[]),...c.query(selector)]);}}
 const root=new Node(),add=(p:Node,_t:string,text?:unknown,cls='')=>{const n=new Node();n.textContent=text===undefined?'':String(text);n.className=cls;p.append(n);return n;};const context=createContext({byId:()=>root,add,Number,String,Math});new Script(html.slice(start,end)).runInContext(context);
 const render=(f:unknown,i:unknown,observer=false)=>new Script('renderFunnel('+JSON.stringify(f)+','+JSON.stringify(i)+','+observer+')').runInContext(context);const value=(key:string)=>root.query('funnel-line').find(r=>r.dataset.funnelStage===key)!.query('funnel-count')[0]!.textContent;
 render(sample().funnel,null,true);assert.equal(value('discovered'),'12');assert.equal(value('evaluated'),'NOT ACTIVE');
 render({...sample().funnel,qualified:0,paperFilled:0},{candidates:{migrationsReceived:12,known:100,watch:94,eligible:8,queued:5,auditedWindows:20,uniqueAudited:null,predictiveAssessments:20,predictivePasses:0,predictiveFailures:20,deepActive:3,deepMaximum:6}});assert.equal(value('predictiveAssessments'),'20');assert.equal(value('uniqueAudited'),'Unavailable');assert.equal(value('qualified'),'0');assert.equal(value('paperFilled'),'0');assert.equal(value('deepActive'),'3 / 6');
});


test('first snapshot paint immediately preserves stopped and stale source truth',async t=>{
 const app=await serve(t,{...config,publicViewer:true}),html=await app.get('/').then(r=>r.text()),show=html.slice(html.indexOf('function showSnapshot('),html.indexOf('\nlet refreshInFlight=')),freshness=html.slice(html.indexOf('function paintFreshness('),html.indexOf('\nclock();setInterval('));const signals:string[][]=[];
 const noop=()=>{},context=createContext({Date,Math,latest:null,latestReceivedAt:null,readFailure:null,renderCards:noop,put:noop,renderTable:noop,renderCandidateIntelligence:noop,renderMetrics:noop,plot:noop,money:noop,byId:()=>({hidden:true}),signal:(...args:string[])=>signals.push(args)});new Script(show+'\n'+freshness).runInContext(context);
 const paint=(snapshot:Snapshot,state:string)=>new Script('showSnapshot('+JSON.stringify(snapshot)+','+JSON.stringify(iso(NOW))+','+JSON.stringify({state})+')').runInContext(context);
 const stopped=sample();stopped.status.runtime='stopped';paint(stopped,'unavailable');assert.equal(signals.at(-1)![0],'STOPPED');assert.equal(signals.at(-1)![3],'warning');
 new Script("readFailure='REPORTING_HTTP_503';paintFreshness()").runInContext(context);assert.match(signals.at(-1)![0]!,/Data link interrupted.*STOPPED/);assert.match(signals.at(-1)![1]!,/Browser snapshot read failed \(REPORTING_HTTP_503\)/);assert.equal(signals.at(-1)![3],'error');
 paint(sample('2',NOW-100000),'stale');assert.equal(signals.at(-1)![0],'STALE SOURCE SNAPSHOT');assert.equal(signals.at(-1)![3],'warning');
 new Script("readFailure='REPORTING_HTTP_503';paintFreshness()").runInContext(context);assert.match(signals.at(-1)![0]!,/Data link interrupted.*STALE SOURCE SNAPSHOT/);assert.equal(signals.at(-1)![2],'DASHBOARD READ FAILED');assert.equal(signals.at(-1)![3],'error');
 paint(sample('3'),'fresh');assert.equal(signals.at(-1)![3],'connected');assert.equal(new Script('readFailure').runInContext(context),null);
});

test('single portfolio viewer retires the experimental channel and retains original authenticated snapshots',async t=>{
 const app=await serve(t,{...config,publicViewer:true});
 assert.equal((await app.get('/api/pilot')).status,410);assert.equal((await fetch(app.url+'/api/pilot',{method:'POST',body:'{}'})).status,410);assert.equal((await app.get('/api/connections')).status,404);
 assert.equal((await app.post(sample())).status,200);const response=await app.get('/api/snapshot').then(r=>r.json());assert.equal(response.snapshot.account.id,config.accountId);assert.equal(response.connections,undefined);
 const html=await app.get('/').then(r=>r.text());for(const text of ['Experimental portfolio','Experimental trades','Pilot diagnostics','pilot-telemetry-panel','experimental-portfolio'])assert.equal(html.includes(text),false,text);
 assert.equal((html.match(/id="portfolio"/g)||[]).length,1);assert.match(html,/Pending orders and reservations/);assert.match(html,/visibilitychange/);assert.match(html,/setInterval\(refresh,15000\)/);assert.match(html,/refreshInFlight/);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);for(const script of scripts)assert.doesNotThrow(()=>new Function(script[1]!));
 assert.equal((await app.get('/healthz').then(r=>r.json())).unifiedPortfolio,true);
});

test('compact one-account command view keeps metrics accessible without a duplicate portfolio',async t=>{const app=await serve(t,{...config,publicViewer:true}),html=await app.get('/').then(r=>r.text());assert.match(html,/Show all /);assert.match(html,/portfolio metrics/);assert.match(html,/compact-disclosure/);assert.match(html,/focus-visible/);assert.match(html,/overflow-wrap:anywhere/);assert.doesNotMatch(html,/experimental-portfolio|pilotIntelligence|setPilotIntelligence/);});

test('source financial positions beyond the legacy three-position profile remain complete under the snapshot byte bound',()=>{
 const source=sample();source.positions=Array.from({length:4},(_,index)=>({mint:'fixture-held-'+index,label:'DISPOSABLE held '+index,quantity:'100',enteredAt:source.times.generatedAt,entryCostUsd:10,netLiquidationUsd:9,executionCostsUsd:0,status:'PAPER held'}));
 const before=structuredClone(source);assert.deepEqual(validateSnapshot(source,config,NOW).positions,source.positions);assert.deepEqual(source,before);
 const cache=new SnapshotCache(config);cache.accept(source,NOW);assert.equal(cache.read()!.snapshot.positions.length,4);
 const oversized={...source,positions:Array.from({length:500},(_,index)=>({...source.positions[index%4]!,mint:'fixture-held-'+index,status:'x'.repeat(80)}))};assert.throws(()=>validateSnapshot(oversized,config,NOW),/payload limit/);
});
