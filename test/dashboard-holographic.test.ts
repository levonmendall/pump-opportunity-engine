import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {holographicDashboard,HOLOGRAPHIC_VERSION} from '../src/dashboard-holographic.js';
import {withConnectionDiagnostics} from '../src/dashboard-connectivity.js';
import {CONNECTIONS_HTML,CONNECTIONS_SCRIPT} from '../src/dashboard-connections.js';
import {createDashboard} from '../src/dashboard.js';

const source=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const marker='const HTML = String.raw`';
const start=source.indexOf(marker)+marker.length;
const end=source.indexOf('`;\n',start);
assert.ok(start>=marker.length && end>start,'actual dashboard template must exist');
const original=source.slice(start,end);
const full=()=>withConnectionDiagnostics(original).replace('<div class="section-heading" id="system">',CONNECTIONS_HTML+'<div class="section-heading" id="system">').replace('</body>',CONNECTIONS_SCRIPT+'</body>');
const ids=(s:string)=>Array.from(s.matchAll(/\bid="([^"]+)"/g),m=>m[1]!);
const scripts=(s:string)=>Array.from(s.matchAll(/<script>([\s\S]*?)<\/script>/g),m=>m[1]!);

test('holographic presentation is deterministic and idempotent',()=>{
 assert.equal(HOLOGRAPHIC_VERSION,'poe-holographic-v2');
 const a=holographicDashboard(original);
 assert.equal(a,holographicDashboard(original));
 assert.equal(a,holographicDashboard(a));
 assert.equal((a.match(/id="poe-holographic-style"/g)||[]).length,1);
});

test('all original data targets and original scripts survive unchanged',()=>{
 const rendered=holographicDashboard(original),before=ids(original),after=ids(rendered);
 for(const id of before)assert.equal(after.filter(x=>x===id).length,1,'preserve '+id);
 assert.deepEqual(scripts(rendered),scripts(original));
 assert.equal(new Set(after).size,after.length,'no duplicate IDs');
});

test('hero has one ornamental orbital illustration and no false performance data',()=>{
 const rendered=full();
 assert.match(rendered,/A new dimension/);
 assert.match(rendered,/class="holo-object"/);
 assert.match(rendered,/DECORATIVE \/ NOT MARKET DATA/);
 assert.match(rendered,/LIVE EXECUTION DISABLED/);
 assert.match(rendered,/NO DEMO PERFORMANCE/);
 assert.match(rendered,/NO SYNTHETIC BALANCES OR TRADES/);
 assert.match(rendered,/NO VERIFIED P&L SERIES/);
 assert.ok(!rendered.includes('class="radar"'));
 assert.ok(!rendered.includes('NaN'));
});

test('original and experimental diagnostics remain separate and visible',()=>{
 const rendered=full();
 for(const id of ['reportingConnections','refreshNow','pilot-telemetry-panel','pilot-link-state','pilot-source-detail','pilot-funnel','pilot-metrics','pilot-decisions','pilot-refusals'])assert.equal(ids(rendered).filter(x=>x===id).length,1,id);
 assert.match(rendered,/No pilot balances or results are merged into it/);
 assert.match(rendered,/SOURCE STALE/);
 assert.match(rendered,/PUBLISHER DISCONNECTED/);
 assert.ok(rendered.indexOf('id="overview"')<rendered.indexOf('id="portfolio"'));
 assert.ok(rendered.indexOf('id="portfolio"')<rendered.indexOf('id="performance"'));
 assert.ok(rendered.indexOf('id="performance"')<rendered.indexOf('id="activity"'));
 assert.ok(rendered.indexOf('id="activity"')<rendered.indexOf('id="pilot-telemetry-panel"'));
 assert.ok(rendered.indexOf('id="pilot-telemetry-panel"')<rendered.indexOf('id="system"'));
 assert.ok(rendered.indexOf('id="system"')<rendered.indexOf('id="decisions"'));
 assert.ok(rendered.indexOf('id="decisions"')<rendered.indexOf('id="metrics"'));
 assert.ok(rendered.indexOf('id="metrics"')<rendered.indexOf('class="status-strip reporting-bottom"'));
 assert.ok(rendered.indexOf('class="status-strip reporting-bottom"')<rendered.indexOf('id="reportingConnections"'));
 assert.match(rendered,/SYSTEM STATUS &amp; REPORTING/);
 assert.match(rendered,/Candidate progression &amp; decisions/);
});

test('visual layer adds no new client script, external dependency or request',()=>{
 const layer=readFileSync(new URL('../src/dashboard-holographic.ts',import.meta.url),'utf8');
 assert.ok(!layer.includes('fetch('));
 assert.ok(!layer.includes('setInterval('));
 assert.ok(!layer.includes('<script'));
 assert.ok(!/https?:\/\//.test(layer));
 assert.ok(!/url\(["']?https?:/.test(layer));
 assert.ok(!layer.includes('process.env'));
 for(const script of scripts(full()))assert.doesNotThrow(()=>new Function(script));
});

test('responsive, reduced-motion, keyboard focus and overflow protections exist',()=>{
 const html=full();
 for(const feature of ['@media(max-width:640px)','@media(max-width:360px)','prefers-reduced-motion:reduce','animation:none!important','focus-visible','overflow-wrap:anywhere','focusable="false"','aria-hidden="true"'])assert.ok(html.includes(feature),feature);
});

test('actual public HTTP viewer contains the new UI and keeps machine publishing protected',async t=>{
 const app=createDashboard({publicViewer:true,viewerUser:'',viewerPassword:'',ingestionSecret:'holographic-test-only-publisher-secret-2026'});
 t.after(()=>new Promise<void>(resolve=>{app.server.closeAllConnections();app.server.close(()=>resolve());}));
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const url='http://127.0.0.1:'+(app.server.address() as AddressInfo).port;
 const response=await fetch(url+'/');assert.equal(response.status,200);const html=await response.text();
 assert.match(html,/id="poe-holographic-style"/);
 assert.match(html,/id="pilot-telemetry-panel"/);
 assert.match(response.headers.get('content-security-policy')??'',/connect-src 'self'/);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('www-authenticate'),null);
 assert.equal((await fetch(url+'/api/snapshot',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetch(url+'/api/snapshot')).status,503);
 assert.equal((await fetch(url+'/healthz')).status,200);
 const connections=await fetch(url+'/api/connections').then(r=>r.json()) as {source:unknown};
 assert.equal(connections.source,null);
});
