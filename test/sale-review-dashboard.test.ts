import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
import {once} from 'node:events';
import {createDashboard} from '../src/dashboard.js';
import {pendingSaleReview,completeSaleReview,SALE_REVIEW_DELAY_MS} from '../src/sale-review.js';
import type {Snapshot} from '../src/reporting.js';
const mint='So11111111111111111111111111111111111111112',id='paper-fill:'+'c'.repeat(32);
test('Explain renders the requested label, same-unit prices, percentage and actual observation time',()=>{
 const source=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8'),begin=source.indexOf('function renderTradeOutcome('),end=source.indexOf('\nfunction renderFunnel(',begin);
 class Element{children:Element[]=[];textContent='';className='';open=false;constructor(readonly tag='div'){}append(n:Element){this.children.push(n);}addEventListener(){}}
 const add=(p:Element,tag:string,value?:unknown,cls='')=>{const e=new Element(tag);e.textContent=value===undefined?'':String(value);e.className=cls;p.append(e);return e;};
 const render=new Script(source.slice(begin,end)+'\nrenderTradeOutcome').runInContext(createContext({add,BigInt,Date,Set,String})) as ((p:Element,t:unknown)=>void)&{saleReviews:Map<string,unknown>};
 const at=Date.now()-SALE_REVIEW_DELAY_MS,point={quoteLamports:'140000000',baseUnits:'1000000',observedAt:at+SALE_REVIEW_DELAY_MS,sourceAt:at+SALE_REVIEW_DELAY_MS,decimals:6};
 const row=completeSaleReview(pendingSaleReview(id,mint,at,{quoteLamports:'100000000',baseUnits:'1000000'}),point,point.observedAt);
 render.saleReviews=new Map([[id,row]]);const root=new Element();render(root,{id,mint,side:'sell',at:new Date(at).toISOString()});
 const text=(e:Element):string=>[e.textContent,...e.children.map(text)].join('\n');
 assert.match(text(root),/4-hour sale review · BAD SALE/);assert.match(text(root),/40\.000000%/);assert.match(text(root),/0\.1000000000 SOL \/ token/);assert.match(text(root),/0\.1400000000 SOL \/ token/);assert.ok(text(root).includes(new Date(point.observedAt).toISOString()));
 const buy=new Element();render(buy,{id,mint,side:'buy',at:new Date(at).toISOString()});assert.doesNotMatch(text(buy),/4-hour sale review/);
});
test('authenticated reporting endpoint joins reviews without modifying financial snapshots',async t=>{
 const now=Date.now(),filledAt=now-SALE_REVIEW_DELAY_MS,config={accountId:'sale-review-receiver-fixture',inceptionAt:new Date(filledAt-10000).toISOString(),release:'fixture-release',strategy:'fixture-strategy',viewerUser:'fixture',viewerPassword:'fixture-viewer-password-unique',ingestionSecret:'fixture-sale-review-machine-secret'};
 const app=createDashboard(config);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise<void>(r=>app.server.close(()=>r()));});const address=app.server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
 const iso=(at:number)=>new Date(at).toISOString(),snapshot:Snapshot={project:'pump-opportunity-engine',mode:'PAPER',liveTrading:false,schemaVersion:1,account:{id:config.accountId,inceptionAt:config.inceptionAt,initialUsd:1000},sequence:'1',source:{release:config.release,strategy:config.strategy},times:{generatedAt:iso(now),marketAt:iso(now),reconciledAt:iso(now),usefulProgressAt:iso(now)},status:{runtime:'running',market:'observing',entries:'disabled',reconciled:true,blocker:null},balances:{cashSol:'10',reservedSol:'0',equitySol:'10',equityUsd:1000,realizedUsd:0,unrealizedUsd:0,tradingPnlUsd:0,economicPnlUsd:null,positionCostUsd:0,markedExposureUsd:0,drawdownUsd:0,executionCostsUsd:0,operatingCostsUsd:null,passiveSolEquityUsd:1000,solPriceUsd:100},costLabels:{execution:'simulated',operating:'unavailable'},positions:[],trades:[{id,mint,side:'sell',quantity:'1000000',at:iso(filledAt),valueUsd:10,executionCostsUsd:0,status:'filled',reason:'fixture sale'}],decisions:[],pnl:[],history:{windowStartAt:null,downsampled:false,label:'No fixture history'},funnel:{discovered:1,supported:1,sufficientlyObserved:1,evaluated:1,qualified:1,attempted:1,paperFilled:1,exited:1,reconciled:1},metrics:{processingLagMs:null,eventLoopLagMs:null,providerEvents:0,rpcRequests:0,projectedDailyDataSol:null,budgetRemainingSol:null,budgetStatus:'unavailable',coverage:'Not measured',latency:'Not measured'}};
 app.cache.accept(snapshot,now);const before=JSON.stringify(app.cache.read());
 const row=completeSaleReview(pendingSaleReview(id,mint,filledAt,{quoteLamports:'100000000',baseUnits:'1000000'}),{quoteLamports:'60000000',baseUnits:'1000000',observedAt:now,sourceAt:now,decimals:6},now),body={schemaVersion:1,accountId:config.accountId,inceptionAt:config.inceptionAt,generatedAt:now,basis:'four-hour-price-only',reviews:[row]};
 const post=(auth:string)=>fetch(base+'/api/sale-reviews',{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('Bearer wrong')).status,401);assert.equal((await post('Bearer '+config.ingestionSecret)).status,200);assert.equal(JSON.stringify(app.cache.read()),before);
 const response=await fetch(base+'/api/snapshot',{headers:{authorization:'Basic '+Buffer.from(config.viewerUser+':'+config.viewerPassword).toString('base64')}}),value=await response.json() as any;
 assert.equal(response.status,200);assert.equal(value.saleReviews[0].status,'GOOD SALE');assert.deepEqual(value.snapshot,snapshot);
});
