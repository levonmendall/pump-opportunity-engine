import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
import {createDashboard} from '../src/dashboard.js';

const source=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const start=source.indexOf("let chartRange='recent';");
const end=source.indexOf('function showSnapshot(',start);
assert.ok(start>=0&&end>start,'live dashboard line-plot renderer exists');
const renderer=source.slice(start,end);
type PnlRow={at:string;tradingUsd:number|null;economicUsd:number|null};
class Node {
 children:Node[]=[];
 attributes:Record<string,string>={};
 textContent='';
 hidden=false;
 parentElement:{clientWidth:number}={clientWidth:900};
 constructor(readonly tag:string){}
 append(...children:Node[]){this.children.push(...children);}
 replaceChildren(){this.children=[];}
 setAttribute(key:string,value:string){this.attributes[key]=value;}
}
function view(width=900){
 const elements=new Map([
  ['chart',new Node('svg')],
  ['chartRangeToggle',new Node('button')],
  ['chartWindowLabel',new Node('span')],
 ]);
 elements.get('chart')!.parentElement.clientWidth=width;
 const makeSvg=(tag:string,attributes:Record<string,unknown>,txt?:string)=>{
  const e=new Node(tag);for(const [k,v]of Object.entries(attributes))e.setAttribute(k,String(v));
  if(txt!==undefined)e.textContent=txt;return e;
 };
 const context=createContext({byId:(id:string)=>{
  const node=elements.get(id);assert.ok(node,'expected dashboard element '+id);return node;
 },put:(id:string,value:string)=>{
  const node=elements.get(id);assert.ok(node,'expected text target '+id);node.textContent=value;
 },makeSvg,Math,Date});
 new Script(renderer).runInContext(context);
 const api=context as unknown as {plot:(points:PnlRow[])=>void;tradingPnlTimeline:(points:PnlRow[])=>Array<{at:string;tradingUsd:number|null;conflict:boolean}>};
 const chart=elements.get('chart')!,toggle=elements.get('chartRangeToggle')!,label=elements.get('chartWindowLabel')!;
 const paths=()=>chart.children.filter(node=>node.tag==='path'&&node.attributes['data-chart-series']==='trading-pnl-line');
 const endpoints=()=>chart.children.filter(node=>node.tag==='circle'&&node.attributes['data-chart-point']==='last-verified');
 return {api,context,chart,toggle,label,paths,endpoints};
}
const at=(seconds:number)=>new Date(Date.parse('2026-10-29T15:00:00.000Z')+seconds*1000).toISOString();
const row=(seconds:number,value:number|null):PnlRow=>({at:at(seconds),tradingUsd:value,economicUsd:null});

test('same-timestamp null P&L placeholders do not break the verified line',()=>{
 const v=view();const p=[row(0,-8.4),row(0,null),row(15,-8.45),row(15,null),row(30,-8.5),row(30,null)];
 const before=JSON.stringify(p);
 const merged=v.api.tradingPnlTimeline(p);
 assert.equal(merged.length,3);
 assert.deepEqual(Array.from(merged,p=>p.tradingUsd),[-8.4,-8.45,-8.5]);
 v.api.plot(p);
 assert.equal(v.paths().length,1,'three verified observations produce one visible line');
 const d=v.paths()[0]!.attributes.d;
 assert.ok((d.match(/L/g)||[]).length===2,'line joins consecutive verified points');
 assert.equal(v.paths()[0]!.attributes.fill,'none','pure line graph, no area fill');
 assert.equal(v.endpoints().length,1,'one endpoint marker, not a scatter chart');
 assert.equal(v.toggle.hidden,true,'no full-history toggle when all data is recent');
 assert.equal(JSON.stringify(p),before,'dashboard does not mutate source P&L history');
});

test('distinct missing timestamp and long unsampled intervals preserve honest gaps',()=>{
 const v=view();v.api.plot([
  row(0,-8.1),row(15,-8.2),row(15,null),
  row(30,null),
  row(45,-8.3),row(60,-8.4),
  row(260,-8.5),row(275,-8.6),
 ]);
 assert.equal(v.paths().length,3,'missing timestamp and >90s silence break the line');
 assert.ok(v.paths().every(p=>(p.attributes.d.match(/L/g)||[]).length===1));
 assert.equal(v.endpoints().length,3);
 assert.ok(!v.chart.children.some(p=>p.tag==='path'&&p.attributes.fill!=='none'));
});

test('conflicting verified duplicates are not silently selected as a trading value',()=>{
 const v=view();const p=[row(0,-8),row(15,-8.1),row(15,-8.2),row(30,-8.3),row(45,-8.4)];
 const merged=v.api.tradingPnlTimeline(p);
 assert.equal(merged[1]!.tradingUsd,null);
 assert.equal(merged[1]!.conflict,true);
 v.api.plot(p);
 assert.equal(v.paths().length,1,'only the later verified pair forms a line');
});

test('default recent line is readable while full history remains available on request',()=>{
 const v=view(335);
 const history=[
  {at:'2026-10-26T22:00:00.000Z',tradingUsd:0,economicUsd:null},
  {at:'2026-10-26T22:00:00.000Z',tradingUsd:null,economicUsd:null},
  row(0,-8.4),row(0,null),row(15,-8.3),row(15,null),row(30,-8.2),
 ];
 v.api.plot(history);
 assert.equal(v.chart.attributes.viewBox,'0 0 335 280');
 assert.equal(v.toggle.hidden,false);
 assert.equal(v.toggle.textContent,'View full history');
 assert.equal(v.toggle.attributes['aria-pressed'],'false');
 assert.match(v.label.textContent,/RECENT 24H.*ZOOMED VALUE SCALE/);
 assert.equal(v.paths().length,1);
 const line=v.paths()[0]!.attributes.d;
 assert.match(line,/^M58[., ]/,'recent line starts at the left chart margin on mobile');
 new Script("chartRange='all'").runInContext(v.context);
 v.api.plot(history);
 assert.equal(v.toggle.textContent,'View recent 24h');
 assert.equal(v.toggle.attributes['aria-pressed'],'true');
 assert.match(v.label.textContent,/FULL REPORTED HISTORY.*ZERO-BASED SCALE/);
 assert.ok(v.chart.children.some(x=>x.tag==='line'&&x.attributes['stroke-dasharray']==='5 4'),'zero reference in full history');
 assert.equal(v.paths().length,1,'history gap is retained, no false line to inception');
});

test('no verified P&L renders an honest absence, not a synthetic line',()=>{
 const v=view();v.api.plot([row(0,null),row(15,null)]);
 assert.equal(v.paths().length,0);
 assert.ok(v.chart.children.some(e=>e.textContent==='NO VERIFIED P&L SERIES'));
});

test('served original dashboard exposes line graph and accessible range control without hiding P&L',async t=>{
 const app=createDashboard({ingestionSecret:'pnl-line-dashboard-regression-secret-'.repeat(3),publicViewer:true,viewerUser:'',viewerPassword:''});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>(resolve=>app.server.close(()=>resolve())));
 const address=app.server.address();assert.ok(address&&typeof address==='object');
 const response=await fetch('http://127.0.0.1:'+address.port+'/');
 assert.equal(response.status,200);
 const html=await response.text();
 for(const id of ['chart','chartRangeToggle','chartWindowLabel','chartNote','chartTag','portfolio']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'exactly one '+id);
 }
 assert.match(html,/id="chartRangeToggle" type="button" aria-pressed="false" hidden/);
 assert.match(html,/data-chart-series/);
 assert.match(html,/Missing samples remain gaps/);
 assert.ok(!html.includes("panelFold('#performance'"),'P&L is always expanded');
 assert.doesNotMatch(html,/id="experimental-portfolio"/);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
