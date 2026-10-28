/** Disposable reporting fixtures only. No live portfolio or trading action. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContext,Script} from 'node:vm';
import {createDashboard} from '../src/dashboard.js';
import {createPilotTelemetryChannel,projectPilotStatus,validatePilotTelemetry} from '../src/pilot-telemetry.js';
import {PILOT_PORTFOLIO_HTML,PILOT_PORTFOLIO_SCRIPT} from '../src/pilot-portfolio-ui.js';
import type {Snapshot} from '../src/reporting.js';
const now=Date.now(),inceptionAt=now-600000,accountId='poe-pilot-portfolio-fixture';
const iso=(at:number)=>new Date(at).toISOString();
function portfolio(sequence='1'):Snapshot{return {
 project:'pump-opportunity-engine',mode:'PAPER',liveTrading:false,schemaVersion:1,
 account:{id:accountId,inceptionAt:iso(inceptionAt),initialUsd:1000},sequence,source:{release:'fixture-release',strategy:'fixture-strategy'},
 times:{generatedAt:iso(now),marketAt:iso(now-1000),reconciledAt:iso(now-1000),usefulProgressAt:iso(now-1000)},
 status:{runtime:'running',market:'observing',entries:'paused',reconciled:true,blocker:'OFFLINE reporting fixture'},
 balances:{cashSol:'9',reservedSol:'0.1',equitySol:null,equityUsd:null,realizedUsd:null,unrealizedUsd:null,tradingPnlUsd:null,economicPnlUsd:null,positionCostUsd:50,markedExposureUsd:null,drawdownUsd:null,executionCostsUsd:0.01,operatingCostsUsd:null,passiveSolEquityUsd:1001,solPriceUsd:101},
 costLabels:{execution:'simulated',operating:'unavailable'},
 positions:[{mint:'<script>untrusted-token</script>',label:'<img src=x>',quantity:'1000',enteredAt:iso(now-10000),entryCostUsd:50,netLiquidationUsd:null,executionCostsUsd:0.01,status:'mark unavailable; exposure retained'}],
 trades:[{id:'fixture-failed-order',mint:'fixture-mint',side:'buy',quantity:'0',at:iso(now-5000),valueUsd:null,executionCostsUsd:null,status:'failed',reason:'expiry; no fill'}],decisions:[],
 pnl:[{at:iso(now-30000),tradingUsd:0,economicUsd:null},{at:iso(now-15000),tradingUsd:null,economicUsd:null},{at:iso(now),tradingUsd:-1,economicUsd:null}],
 history:{windowStartAt:iso(now-30000),downsampled:false,label:'OFFLINE fixture recorded points; gap retained'},
 funnel:{discovered:10,supported:2,sufficientlyObserved:1,evaluated:1,qualified:0,attempted:1,paperFilled:0,exited:0,reconciled:1},
 metrics:{processingLagMs:null,eventLoopLagMs:20,providerEvents:100,rpcRequests:10,projectedDailyDataSol:null,budgetRemainingSol:null,budgetStatus:'unavailable',coverage:'OFFLINE fixture only',latency:'not measured'}
};}
function raw(){return {experimental:true,authoritative:false,liveTradingEnabled:false,accountId,inceptionAt,runId:'fixture-run',generatedAt:now,source:{commit:'fixture-release'},strategyVersion:'fixture-strategy',running:true,entriesEnabled:false,status:'OFFLINE fixture',mode:'paper',financialExecutionAuthorized:true,experimentalPortfolio:portfolio(),experimentalAccounting:{schemaVersion:1,at:now,totalPnlLamports:null,realizedLamports:'-1000000',unrealizedLamports:null,executionCostsLamports:'7000',lockedDepositLamports:'2000000'},funnel:{evaluated:1},usage:{rpc:{newUnits:10},feeds:{frames:100,normalizedTrades:1,totalSocketBytes:1000}},timing:{completedEvaluationGaps:[]},decisions:[],refusals:{},financial:{credential:'MUST_NOT_LEAK'},journal:['MUST_NOT_LEAK']};}
const config={secret:'fixture-pilot-ingest-key-'.repeat(3),accountId,inceptionAt,publicViewer:true,viewerUser:'',viewerPassword:''};

test('complete source-calculated portfolio is separately identified and unknown marks remain unavailable',()=>{
 const p=projectPilotStatus(raw());assert.deepEqual(p.portfolio,portfolio());assert.equal(p.portfolio!.balances.equityUsd,null);assert.equal(p.portfolio!.positions[0]!.netLiquidationUsd,null);assert.equal(p.portfolio!.trades[0]!.status,'failed');assert.equal(p.portfolio!.trades[0]!.executionCostsUsd,null);assert.equal(p.portfolio!.funnel.paperFilled,0);assert.doesNotMatch(JSON.stringify(p),/MUST_NOT_LEAK/);
});
test('candidate mode never publishes its historical financial reference or a supplied portfolio',()=>{
 const r=raw();r.mode='candidate-evaluation';r.financialExecutionAuthorized=false;const p=projectPilotStatus(r);assert.equal(p.portfolio,null);assert.equal(p.accounting,null);
 p.portfolio=portfolio();assert.throws(()=>validatePilotTelemetry(p),/explicit PAPER/);
});
test('portfolio requires explicit financial mode, exact account, inception and runtime identities',()=>{
 for(const change of ['mode','permission','account','inception','release','strategy','time','secret']as const){
  const p=projectPilotStatus(raw());
  if(change==='mode')delete p.mode;
  if(change==='permission')p.financialExecutionAuthorized=false;
  if(change==='account')p.portfolio!.account.id='original-authoritative-account';
  if(change==='inception')p.portfolio!.account.inceptionAt=iso(inceptionAt-1);
  if(change==='release')p.portfolio!.source.release='another-release';
  if(change==='strategy')p.portfolio!.source.strategy='another-strategy';
  if(change==='time')p.portfolio!.times.generatedAt=iso(now+1);
  if(change==='secret')(p.portfolio as unknown as Record<string,unknown>).credential='FORBIDDEN';
  assert.throws(()=>validatePilotTelemetry(p),Error,change);
 }
});
test('experimental financial sequence persists across run counters and rejects financial regression/conflict',()=>{
 const c=createPilotTelemetryChannel(config,()=>now+1000),p=projectPilotStatus(raw());assert.equal(c.accept(p),'accepted');
 const next=structuredClone(p);next.runId='next-run';next.generatedAt++;next.accounting!.at=next.generatedAt;next.portfolio=portfolio('2');assert.equal(c.accept(next),'accepted');
 const older=structuredClone(next);older.generatedAt++;older.accounting!.at=older.generatedAt;older.portfolio=portfolio('1');assert.throws(()=>c.accept(older),/portfolio sequence/);
 const conflict=structuredClone(next);conflict.generatedAt++;conflict.accounting!.at=conflict.generatedAt;conflict.portfolio!.balances.cashSol='8';assert.throws(()=>c.accept(conflict),/portfolio sequence/);
 const replay=structuredClone(next);replay.generatedAt++;replay.accounting!.at=replay.generatedAt;assert.equal(c.accept(replay),'accepted');assert.equal(c.read().snapshot!.portfolio!.times.generatedAt,iso(now));
 assert.equal(createPilotTelemetryChannel(config,()=>now+1000).read().snapshot,null,'receiver restart seeds no experimental balances');
});
test('original financial cache and pilot portfolio authentication remain independent over HTTP',async t=>{
 const keys=['POE_PILOT_INGEST_SECRET','POE_PILOT_ACCOUNT_ID','POE_PILOT_INCEPTION_AT']as const,before=keys.map(k=>process.env[k]);
 process.env.POE_PILOT_INGEST_SECRET=config.secret;process.env.POE_PILOT_ACCOUNT_ID=accountId;process.env.POE_PILOT_INCEPTION_AT=String(inceptionAt);
 t.after(()=>keys.forEach((k,i)=>before[i]===undefined?delete process.env[k]:process.env[k]=before[i]));
 const original='fixture-original-reporting-key-'.repeat(3),app=createDashboard({ingestionSecret:original,publicViewer:true,viewerUser:'',viewerPassword:''});
 await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>app.server.close(()=>r())));const address=app.server.address();assert.ok(address&&typeof address==='object');const url='http://127.0.0.1:'+address.port;
 const post=(path:string,key:string)=>fetch(url+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(projectPilotStatus(raw()))});
 assert.equal((await post('/api/pilot',original)).status,401);assert.equal((await post('/api/snapshot',config.secret)).status,401);
 assert.equal((await post('/api/pilot',config.secret)).status,200);assert.equal(app.cache.read(),null);
 const read=await fetch(url+'/api/pilot').then(r=>r.json());assert.equal(read.snapshot.portfolio.account.id,accountId);assert.equal(read.snapshot.portfolio.positions[0].netLiquidationUsd,null);
 const html=await fetch(url+'/').then(r=>r.text());assert.match(html,/Experimental portfolio/);assert.doesNotMatch(html,new RegExp(config.secret));assert.doesNotMatch(html,new RegExp(original));
 const body=html.match(/function renderFunnel\(f\)\{([\s\S]*?)\nfunction renderMetrics/);assert.ok(body);const labels:string[]=[];const element={replaceChildren(){},style:{width:''},dataset:{}};const render=new Function('byId','add','return function(f){'+body[1]+';')(()=>element,(_parent:unknown,_tag:string,value:unknown)=>{if(value!==undefined)labels.push(String(value));return element;});assert.doesNotThrow(()=>render(projectPilotStatus(raw()).funnel));assert.ok(labels.includes('Not reported'),'nullable diagnostic counts remain unavailable, never a broken refresh');
});

class Element {textContent='';children:Element[]=[];attrs:Record<string,string>={};className='';classList={toggle:()=>{}};append(...e:Element[]){this.children.push(...e);}replaceChildren(...e:Element[]){this.children=e;}setAttribute(k:string,v:string){this.attrs[k]=v;}set innerHTML(_v:string){throw Error('HTML forbidden');}}
test('experimental UI renders source values, explicit gaps and untrusted token text without touching original panels',()=>{
 const nodes=new Map<string,Element>();for(const id of ['experimental-portfolio-state','experimental-portfolio-source','experimental-portfolio-cards','experimental-portfolio-positions','experimental-portfolio-trades','experimental-portfolio-chart','experimental-portfolio-history'])nodes.set(id,new Element());
 const window:Record<string,any>={},intervals:Array<()=>void>=[];const context=createContext({window,document:{getElementById:(id:string)=>{assert.ok(id.startsWith('experimental-portfolio-'));return nodes.get(id);},createElement:()=>new Element(),createElementNS:()=>new Element()},setInterval:(f:()=>void)=>intervals.push(f),Date,Intl,Number,Array,Object,String,Math});
 new Script(PILOT_PORTFOLIO_SCRIPT.replace(/^<script>\s*/,'').replace(/\s*<\/script>$/,'')).runInContext(context);
 window.renderExperimentalPortfolio(projectPilotStatus(raw()));assert.match(nodes.get('experimental-portfolio-source')!.textContent,/poe-pilot-portfolio-fixture/);const cardText=nodes.get('experimental-portfolio-cards')!.children.map(e=>e.children.map(c=>c.textContent).join(': ')).join('\n');assert.match(cardText,/Realized P&L · SOL: -0.001 SOL/);assert.match(cardText,/Modeled execution costs · SOL: 0.000007 SOL/);assert.match(cardText,/Total trading P&L · SOL: Unavailable/);assert.match(cardText,/Portfolio change · USD \(includes SOL\/USD\): Unavailable/);assert.match(cardText,/Passive SOL benchmark · USD:/);
 assert.match(nodes.get('experimental-portfolio-positions')!.children[0]!.textContent,/<script>untrusted-token<\/script>.*Unavailable/);
 assert.match(nodes.get('experimental-portfolio-trades')!.children[0]!.textContent,/failed.*expiry; no fill/);
 const chart=nodes.get('experimental-portfolio-chart')!;assert.equal(chart.children.filter(x=>x.attrs.points!==undefined).length,2,'actual null point separates two plotted segments');
 const stopped=projectPilotStatus(raw());stopped.running=false;stopped.portfolio!.status.runtime='stopped';window.renderExperimentalPortfolio(stopped);assert.match(nodes.get('experimental-portfolio-state')!.textContent,/STOPPED/);assert.match(nodes.get('experimental-portfolio-source')!.textContent,/continuing position protection is not implied/);
 window.renderExperimentalPortfolio(null);assert.equal(nodes.get('experimental-portfolio-cards')!.children.length,0);assert.match(nodes.get('experimental-portfolio-history')!.textContent,/No historical performance/);
 assert.match(PILOT_PORTFOLIO_HTML,/OWN ACCOUNT/);assert.match(PILOT_PORTFOLIO_HTML,/Portfolio change · USD \(includes SOL\/USD\)/);assert.match(nodes.get('experimental-portfolio-history')!.textContent,/No historical performance/);assert.doesNotMatch(PILOT_PORTFOLIO_SCRIPT,/innerHTML|api\/snapshot|showSnapshot|renderCards|Bearer|privateKey/);
});


test('exact source SOL accounting is optional, timestamp-bound and never current-USD P&L inference',()=>{
 const p=projectPilotStatus(raw());assert.equal(p.accounting!.realizedLamports,'-1000000');assert.equal(p.accounting!.totalPnlLamports,null);assert.equal(p.accounting!.unrealizedLamports,null);assert.equal(p.portfolio!.balances.realizedUsd,null);
 const legacy=raw() as Record<string,any>;delete legacy.experimentalAccounting;assert.equal(projectPilotStatus(legacy).accounting,null);
 for(const mutate of [(q:any)=>q.accounting.at--,(q:any)=>q.accounting.at++,(q:any)=>q.accounting.totalPnlLamports='0',(q:any)=>q.accounting.unrealizedLamports='0',(q:any)=>delete q.accounting.realizedLamports,(q:any)=>q.accounting.private='no',(q:any)=>q.portfolio=null]){const q=structuredClone(p);mutate(q);assert.throws(()=>validatePilotTelemetry(q));}
});
test('accounting integer validation preserves signed128 and unsigned128 precision and rejects malformed amounts',()=>{
 const p=projectPilotStatus(raw());
 p.accounting!.realizedLamports=(-(1n<<127n)).toString();p.accounting!.executionCostsLamports=((1n<<128n)-1n).toString();assert.doesNotThrow(()=>validatePilotTelemetry(p));
 for(const value of ['-0','+1','01','1.0','1e9',' 1','',1,null,((1n<<127n)).toString(),(-(1n<<127n)-1n).toString()]){const q=projectPilotStatus(raw());(q.accounting as any).realizedLamports=value;assert.throws(()=>validatePilotTelemetry(q));}
 for(const value of ['-1',(1n<<128n).toString()]){const q=projectPilotStatus(raw());q.accounting!.executionCostsLamports=value;assert.throws(()=>validatePilotTelemetry(q));}
});
