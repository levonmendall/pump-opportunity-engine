import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {holographicDashboard,HOLOGRAPHIC_VERSION} from '../src/dashboard-holographic.js';
import {createDashboard} from '../src/dashboard.js';
import {operatingSnapshotFreshness} from '../src/reporting.js';

const source=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const marker='const HTML = String.raw`';
const start=source.indexOf(marker)+marker.length;
const end=source.indexOf('`;\n',start);
assert.ok(start>=marker.length && end>start,'actual dashboard template must exist');
// Resolve the same static function interpolation used by the served template.
const original=source.slice(start,end).replace('${operatingSnapshotFreshness.toString()}',operatingSnapshotFreshness.toString());
const full=()=>holographicDashboard(original);
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
 assert.equal((rendered.match(/class="holo-object"/g)||[]).length,1);
 assert.match(rendered,/DECORATIVE \/ NOT MARKET DATA/);
 assert.match(rendered,/LIVE EXECUTION DISABLED/);
 assert.match(rendered,/NO DEMO PERFORMANCE/);
 assert.match(rendered,/NO SYNTHETIC BALANCES OR TRADES/);
 assert.match(rendered,/RECORDING PORTFOLIO EQUITY/);
 assert.ok(!rendered.includes('class="radar"'));
 // Missing epoch time uses an internal NaN sentinel, rejected by the renderer's
 // finite-time guard. It must never appear in displayed markup or SVG values.
 const markup=rendered.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 assert.doesNotMatch(markup,/\b(?:NaN|Infinity)\b/);
});

test('original account panels remain, experimental sections are absent and the equity chart stays visible',()=>{
 const rendered=full(),elements=ids(rendered);
 for(const id of ['reporting-status','refreshNow','portfolio','performance','chart','funnel','metrics','decisions'])assert.equal(elements.filter(x=>x===id).length,1,id);
 for(const id of ['pilot-telemetry-panel','experimental-portfolio','pilot-link-state','pilot-funnel','pilot-decisions'])assert.ok(!elements.includes(id),'remove '+id);
 assert.ok(!rendered.includes("panelFold('#performance'"),'equity chart must not be collapsed');
 assert.match(rendered,/Portfolio equity trajectory/);
 assert.match(rendered,/PORTFOLIO EQUITY · USD/);
 assert.ok(!rendered.includes('chartRangeToggle'),'remove unnecessary range toggle');
 assert.ok(rendered.indexOf('id="overview"')<rendered.indexOf('id="portfolio"'));
 assert.ok(rendered.indexOf('id="portfolio"')<rendered.indexOf('id="performance"'));
 assert.ok(rendered.indexOf('id="performance"')<rendered.indexOf('id="activity"'));
 assert.ok(rendered.indexOf('id="activity"')<rendered.indexOf('id="system"'));
 assert.ok(rendered.indexOf('id="system"')<rendered.indexOf('id="decisions"'));
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
 assert.doesNotMatch(html,/id="pilot-telemetry-panel"/);
 assert.doesNotMatch(html,/id="experimental-portfolio"/);
 assert.match(html,/id="performance"/);
 assert.match(response.headers.get('content-security-policy')??'',/connect-src 'self'/);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('www-authenticate'),null);
 assert.equal((await fetch(url+'/api/snapshot',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetch(url+'/api/snapshot')).status,503);
 assert.equal((await fetch(url+'/healthz')).status,200);
 assert.equal((await fetch(url+'/api/connections')).status,404);
 assert.equal((await fetch(url+'/api/pilot')).status,410);
});
