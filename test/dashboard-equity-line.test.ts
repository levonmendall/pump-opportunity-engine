import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
import {createDashboard} from '../src/dashboard.js';

const source=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const start=source.indexOf('function plot(points){');
const end=source.indexOf('function showSnapshot(',start);
assert.ok(start>=0&&end>start,'dashboard must include one standalone equity-line renderer');
const code=source.slice(start,end);
type EquityPoint={at:string;equityUsd:number};
class Element {
 children:Element[]=[];
 attributes:Record<string,string>={};
 textContent='';
 parentElement:{clientWidth:number}={clientWidth:900};
 constructor(readonly tag:string){}
 append(...children:Element[]){this.children.push(...children);}
 replaceChildren(){this.children=[];}
 setAttribute(name:string,value:string){this.attributes[name]=value;}
}
function chart(width=900){
 const root=new Element('svg');root.parentElement.clientWidth=width;
 const makeSvg=(tag:string,attrs:Record<string,unknown>,txt?:string)=>{
  const element=new Element(tag);
  for(const [k,v]of Object.entries(attrs))element.setAttribute(k,String(v));
  if(txt!==undefined)element.textContent=txt;
  return element;
 };
 const context=createContext({byId:(id:string)=>{
  assert.equal(id,'chart','only the source-equity SVG is accessed by the renderer');return root;
 },makeSvg,Date,Math,Number,Intl});
 new Script(code).runInContext(context);
 const plot=(context as unknown as {plot:(p:EquityPoint[])=>void}).plot;
 const lines=()=>root.children.filter(e=>e.tag==='path'&&e.attributes['data-chart-series']==='portfolio-equity-usd');
 return {plot,root,lines};
}
const base=Date.parse('2026-10-29T18:45:00.000Z');
const point=(minutes:number,value:number):EquityPoint=>({at:new Date(base+minutes*60_000).toISOString(),equityUsd:value});

test('portfolio chart draws exactly one connected USD equity line, never trading P&L dots or shaded area',()=>{
 const v=chart(),data=[point(0,984.35),point(1,981.95),point(2,986.1),point(3,984.75)];
 const original=JSON.stringify(data);
 v.plot(data);
 assert.equal(v.lines().length,1);
 assert.equal((v.lines()[0]!.attributes.d??'').match(/L/g)?.length,3,'four verified values form one line');
 assert.equal(v.lines()[0]!.attributes.fill,'none');
 assert.ok(!v.root.children.some(e=>e.tag==='circle'||e.tag==='linearGradient'),'no scatter-point cloud, fake area or gradient');
 assert.ok(!v.root.children.some(e=>e.attributes['stroke-dasharray']!==undefined),'no dotted gap bridges');
 const labels=v.root.children.filter(e=>e.tag==='text').map(e=>e.textContent);
 assert.ok(labels.some(x=>x.startsWith('$98')),'Y axis uses actual equity USD amounts');
 assert.ok(!labels.some(x=>x.includes('−$8')),'chart is not plotting trading P&L');
 assert.equal(JSON.stringify(data),original,'renderer does not change source equity');
});

test('mobile chart has responsive dimensions, a single line, and legible dollar axes',()=>{
 const v=chart(335);v.plot([point(0,995.5),point(1,992.4),point(2,990.3),point(3,991.2)]);
 assert.equal(v.root.attributes.viewBox,'0 0 335 280');
 assert.equal(v.lines().length,1);
 assert.match(v.lines()[0]!.attributes.d??'',/^M67[., ]/);
 assert.ok(v.root.children.filter(e=>e.tag==='text').length>=7,'money ticks and time labels are visible');
 assert.ok(!v.root.children.some(e=>e.tag==='circle'),'no cloud of dots on mobile');
});

test('a genuine five-minute reporting outage breaks the line instead of inventing equity points',()=>{
 const v=chart(),values=[point(0,990),point(1,991),point(12,984),point(13,982)];
 v.plot(values);
 assert.equal(v.lines().length,2,'separate source runs are separate line segments');
 for(const line of v.lines())assert.equal((line.attributes.d??'').match(/L/g)?.length,1);
 assert.ok(!v.root.children.some(e=>e.attributes['data-chart-gap-bridge']!==undefined));
});

test('no historical equity or a single current value does not fabricate a past trajectory',()=>{
 for(const data of [[],[point(0,1012.3)]]){
  const v=chart();v.plot(data);
  assert.equal(v.lines().length,0);
  assert.ok(v.root.children.some(e=>e.textContent==='RECORDING PORTFOLIO EQUITY'));
 }
});

test('portfolio source and dashboard render path are tied to the same equity value, not unrelated P&L',()=>{
 assert.match(source,/equityHistory: cache\.equityHistory\(\)/);
 assert.match(source,/plot\(latestEquityHistory\?\.points\?\?\[\]\)/);
 assert.match(source,/showSnapshot\(result\.snapshot,result\.receivedAt,result\.freshness,result\.equityHistory\?\?null\)/);
 assert.match(source,/Portfolio equity trajectory/);
 assert.match(source,/PORTFOLIO EQUITY · USD/);
 assert.match(source,/Actual portfolio equity in USD, matching Portfolio Overview/);
 assert.ok(!code.includes('tradingUsd'),'trading P&L cannot be substituted for portfolio equity');
 assert.ok(!code.includes('economicUsd'),'economic P&L cannot be substituted for portfolio equity');
 assert.ok(!source.includes("panelFold('#performance'"),'equity line remains expanded');
 assert.ok(!source.includes('chartRangeToggle'),'remove unnecessary toggle');
});

test('actual served holographic dashboard uses a single account equity line without experimental reports',async t=>{
 const app=createDashboard({ingestionSecret:'fixture-source-equity-dashboard-secret-only',publicViewer:true,viewerUser:'',viewerPassword:''});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>(resolve=>app.server.close(()=>resolve())));
 const address=app.server.address();assert.ok(address&&typeof address==='object');
 const result=await fetch('http://127.0.0.1:'+address.port+'/');
 assert.equal(result.status,200);
 const html=await result.text();
 assert.match(html,/Portfolio equity trajectory/);
 assert.match(html,/id="chart" viewBox="0 0 900 280"/);
 assert.match(html,/RECORDING PORTFOLIO EQUITY/);
 assert.match(html,/portfolio-equity-usd/);
 assert.doesNotMatch(html,/id="experimental-portfolio"/);
 assert.doesNotMatch(html,/chartRangeToggle/);
 assert.equal(result.headers.get('cache-control'),'no-store');
});
