import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SnapshotCache} from '../dist/src/reporting.js';
import {createDashboard} from '../dist/src/dashboard.js';
import {HANDOVER as p,attachReviewedSourceHandover} from '../src/reviewed-source-handover.mjs';
const T=Date.now(),iso=t=>new Date(t).toISOString();
const identity=()=>({accountId:p.accountId,inceptionAt:p.inceptionAt,release:p.from,strategy:p.strategy});
function sample(sequence='1',release=p.from,at=T){return{
 project:'pump-opportunity-engine',mode:'PAPER',liveTrading:false,schemaVersion:1,
 account:{id:p.accountId,inceptionAt:p.inceptionAt,initialUsd:1000},sequence,source:{release,strategy:p.strategy},
 times:{generatedAt:iso(at),marketAt:iso(at-1000),reconciledAt:iso(at-400),usefulProgressAt:iso(at-1000)},
 status:{runtime:'running',market:'observing',entries:'paused',reconciled:true,blocker:'Disposable offline fixture'},
 balances:{cashSol:'10',reservedSol:'0',equitySol:'10',equityUsd:1000,realizedUsd:0,unrealizedUsd:0,tradingPnlUsd:0,economicPnlUsd:null,positionCostUsd:0,markedExposureUsd:0,drawdownUsd:null,executionCostsUsd:null,operatingCostsUsd:null,passiveSolEquityUsd:1000,solPriceUsd:100},
 costLabels:{execution:'simulated',operating:'unavailable'},positions:[],trades:[],decisions:[],pnl:[],
 history:{windowStartAt:null,downsampled:false,label:'Offline fixture'},
 funnel:{discovered:2,supported:2,sufficientlyObserved:0,evaluated:0,qualified:0,attempted:0,paperFilled:0,exited:0,reconciled:0},
 metrics:{processingLagMs:null,eventLoopLagMs:null,providerEvents:0,rpcRequests:0,projectedDailyDataSol:null,budgetRemainingSol:null,budgetStatus:'unavailable',coverage:'Not measured',latency:'Not measured'}
};}
function fixture(){const cache=new SnapshotCache(identity());assert.equal(attachReviewedSourceHandover(cache),true);return cache;}
test('old source continues unchanged until exact target accepted; history and genuine release labels survive',()=>{
 const c=fixture(),old=sample('1',p.from,T-120000);c.accept(old,T);const before=c.equityHistory();
 assert.equal(c.identity.release,p.from);assert.deepEqual(c.read().snapshot,old);assert.equal(c.accept(old,T),'duplicate');
 const next=sample('2',p.to),saved=structuredClone(next);assert.equal(c.accept(next,T),'accepted');
 assert.equal(c.identity.release,p.to);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.ok(c.equityHistory().points.some(x=>x.at===before.points[0].at&&x.equityUsd===before.points[0].equityUsd));
 assert.equal(c.read().snapshot.status.entries,'paused');assert.equal(c.accept(next,T),'duplicate');
 assert.throws(()=>c.accept(sample('3',p.from),T),/source version/);
});
for(const [name,mutate]of[
 ['wrong account',s=>{s.account.id='other';}],['wrong strategy',s=>{s.source.strategy='other';}],
 ['funded mode',s=>{s.liveTrading=true;}],['unbounded field',s=>{s.additional='not allowed';}],
 ['future snapshot',s=>{s.times.generatedAt=iso(T+30001);}],['unknown release',s=>{s.source.release='a'.repeat(40);}],
 ['sequence conflict',s=>{s.sequence='1';}],['sequence regression',s=>{s.sequence='1';}],
 ['time regression',s=>{s.times.generatedAt=iso(T-2000);s.times.marketAt=null;s.times.reconciledAt=null;s.status.reconciled=false;s.times.usefulProgressAt=null;}],
])test('refused '+name+' never switches configured identity',()=>{
 const c=fixture();c.accept(sample(name==='sequence regression'?'2':'1'),T);const before=c.read(),next=sample('3',p.to);mutate(next);
 assert.throws(()=>c.accept(next,T));assert.equal(c.identity.release,p.from);assert.deepEqual(c.read(),before);
 assert.equal(c.accept(sample('4'),T),'accepted');
});
test('unconfigured, unrelated and already newer receivers do not gain an alternate source',()=>{
 for(const id of [null,{...identity(),accountId:'other'},{...identity(),release:p.to},{...identity(),release:'c'.repeat(40)}])assert.equal(attachReviewedSourceHandover(new SnapshotCache(id)),false);
 const c=fixture();assert.equal(attachReviewedSourceHandover(c),true);
});
test('existing HTTP authentication still runs before any transition',async t=>{
 const secret='offline-independent-ingestion-secret';const app=createDashboard({...identity(),viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 attachReviewedSourceHandover(app.cache);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
 const url='http://127.0.0.1:'+app.server.address().port+'/api/snapshot';
 const post=authorization=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(sample('1',p.to))});
 assert.equal((await post('Bearer wrong')).status,401);assert.equal(app.cache.identity.release,p.from);assert.equal(app.cache.read(),null);
 assert.equal((await post('Bearer '+secret)).status,200);assert.equal(app.cache.identity.release,p.to);assert.equal(app.cache.read().snapshot.source.release,p.to);
});
