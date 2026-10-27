// One-time source transformation, removed after the verified repair is committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let text = readFileSync('src/dashboard.ts', 'utf8');
const sha = createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
if (sha !== 'c89c95b430901e745209f5cf20d3b6b77f5e0a1c') throw new Error('Unexpected dashboard base; refuse overwrite');
function replace(before, after) { if (text.split(before).length !== 2) throw new Error('Missing or ambiguous patch anchor: ' + before.slice(0,100)); text = text.replace(before, after); }
replace("import { fileURLToPath } from 'node:url';", "import { fileURLToPath } from 'node:url';\nimport { connectionReport, withConnectionDiagnostics } from './dashboard-connectivity.js';");
replace("{ ok: true, service: 'poe-dashboard' }", "{ ok: true, service: 'poe-dashboard', dashboardRelease: process.env.RENDER_GIT_COMMIT ?? 'local-build', connectivityDiagnostics: 1 }");
replace("    if (path === '/status') { send(res, 200, cache.status()); return; }", "    if (path === '/status') { send(res, 200, cache.status()); return; }\n    if (path === '/api/connections') { send(res, 200, connectionReport(cache)); return; }");
replace("{ ...current, freshness: cache.status() }", "{ ...current, freshness: cache.status(), connections: connectionReport(cache) }");
replace('    res.end(HTML);', '    res.end(withConnectionDiagnostics(HTML));');
replace('async function refresh(){\n try{', 'let refreshInFlight=false;\nasync function refresh(){\n if(refreshInFlight)return;\n refreshInFlight=true;\n try{');
replace('signal:AbortSignal.timeout(4000)', 'signal:AbortSignal.timeout(10000)');
replace('showSnapshot(result.snapshot,result.receivedAt,result.freshness);', 'showSnapshot(result.snapshot,result.receivedAt,result.freshness,result.connections);');
replace("reason,'error')}\n }\n}\ndocument.querySelectorAll", "reason,'error')}\n }finally{refreshInFlight=false}\n}\ndocument.querySelectorAll");
replace('setInterval(refresh,30000);', 'setInterval(refresh,15000);');
writeFileSync('src/dashboard.ts', text);
let tests = readFileSync('test/reporting.test.ts','utf8');
tests += String.raw`

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
  assert.equal(scripts.length,2);
  for(const match of scripts)assert.doesNotThrow(()=>new Function(match[1]!));
  assert.equal((await app.get('/healthz').then(r=>r.json())).connectivityDiagnostics,1);
});
`;
writeFileSync('test/reporting.test.ts',tests);
console.log('Applied dashboard source connectivity repair; no runtime/ledger/trading files changed.');
