import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDashboard} from '../src/dashboard.js';

const dashboardSource=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');

function paperTradesMarkup(source:string){
 const begin=source.indexOf('<section class="panel data-panel paper-trades-panel" aria-labelledby="tradesTitle">');
 assert.ok(begin>=0,'actual Recent PAPER trades panel exists');
 const end=source.indexOf('</details></section>',begin);
 assert.ok(end>begin,'native disclosure closes within its own panel');
 return source.slice(begin,end+'</details></section>'.length);
}

test('Recent PAPER trades is a native, initially collapsed, keyboard-accessible disclosure',()=>{
 const panel=paperTradesMarkup(dashboardSource);
 const details=panel.match(/<details class="paper-trades-disclosure"[^>]*>/);
 assert.ok(details,'native details control must exist');
 assert.doesNotMatch(details[0],/\sopen(?:\s|=|>)/,'large execution log starts collapsed');
 assert.match(panel,/<summary class="panel-heading paper-trades-summary" aria-controls="paperTradesBody">/);
 assert.match(panel,/<h2 id="tradesTitle">Recent PAPER trades<\/h2>/);
 assert.match(panel,/<span class="paper-trades-icon" aria-hidden="true"><\/span>/);
 assert.match(panel,/<\/summary><div class="paper-trades-body" id="paperTradesBody">/);
 assert.match(dashboardSource,/\.paper-trades-summary:focus-visible\{outline:/);
 assert.match(dashboardSource,/\.paper-trades-disclosure\[open\] \.paper-trades-icon:before\{content:"−"\}/);
});

test('authoritative trade count stays visible while pending orders and completed executions collapse together',()=>{
 const panel=paperTradesMarkup(dashboardSource);
 const summary=panel.slice(panel.indexOf('<summary'),panel.indexOf('</summary>'));
 const body=panel.slice(panel.indexOf('</summary>')+'</summary>'.length);
 assert.match(summary,/id="tradesCount"/,'verified count stays visible in collapsed header');
 assert.ok(!summary.includes('id="orders"')&&!summary.includes('id="trades"'));
 for(const id of ['tradesCount','orders','trades']){
  assert.equal((panel.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'exactly one '+id);
 }
 assert.match(body,/Pending orders and reservations/);
 assert.match(body,/Completed PAPER executions/);
 assert.ok(body.indexOf('id="orders"')<body.indexOf('id="trades"'),'preserve execution order');
 assert.match(dashboardSource,/put\('tradesCount',s\.trades\.length\+' REPORTED'\)/);
 assert.match(dashboardSource,/renderTable\('trades',/);
 assert.match(dashboardSource,/renderTable\('orders',/);
});

test('activity navigation opens trades, refresh does not replace disclosure, and portfolio chart remains expanded',()=>{
 assert.match(dashboardSource,/if\(id==='#activity'\)\{const paperTrades=dest&&dest\.querySelector\('\.paper-trades-disclosure'\);if\(paperTrades\)paperTrades\.open=true;\}/);
 assert.ok(!dashboardSource.includes("panelFold('section[aria-labelledby=\"tradesTitle\"]'"),'do not add a second folding layer');
 assert.ok(!dashboardSource.includes("panelFold('#performance'"),'P&L chart must remain visible');
 assert.match(dashboardSource,/id="chart" viewBox=/);
 assert.match(dashboardSource,/\.data-panel\.paper-trades-panel\{min-height:0;align-self:start\}/);
 assert.match(dashboardSource,/@media print\{\.paper-trades-disclosure>\.paper-trades-body\{display:block!important\}\}/);
});

test('served holographic dashboard retains one collapsible original-account trade panel',async t=>{
 const app=createDashboard({ingestionSecret:'test-paper-trade-ui-secret-'.repeat(3),publicViewer:true,viewerUser:'',viewerPassword:''});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>(resolve=>app.server.close(()=>resolve())));
 const addr=app.server.address();assert.ok(addr&&typeof addr==='object');
 const response=await fetch('http://127.0.0.1:'+addr.port+'/');
 assert.equal(response.status,200);
 const html=await response.text();
 const panel=paperTradesMarkup(html);
 for(const id of ['tradesTitle','tradesCount','orders','trades']){
  assert.equal((panel.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
 }
 assert.ok(!/<details class="paper-trades-disclosure"[^>]*\sopen(?:\s|=|>)/.test(panel));
 assert.match(html,/id="portfolio"/);
 assert.match(html,/id="performance"/);
 assert.match(html,/id="chart"/);
 assert.doesNotMatch(html,/id="experimental-portfolio"/);
 assert.match(response.headers.get('cache-control')??'',/no-store/);
});
