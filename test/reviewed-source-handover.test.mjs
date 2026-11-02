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
function v3Epoch(){
 const at=Date.parse('2026-10-30T15:00:00.000Z');
 const prior={version:'poe-paper-epoch-v1',id:'poe-paper-10sol-20261030',activatedAt:iso(at),initialSol:'10.000000000',contributionSol:'10.000000000',initialUsd:950,solPriceUsd:95,priceAt:iso(at-100),priorEquitySol:'9.300000000',priorArchivedCashSol:'9.290000000',priorArchivedDepositsSol:'0.010000000',priorRealizedPnlSol:'-0.600000000',priorExecutionCostsSol:'0.000100000',capitalAdjustmentSol:'0.700000000',priorStateSha256:'a'.repeat(64),backupSha256:'b'.repeat(64)};
 return {...prior,version:'poe-paper-epoch-v3',id:'poe-paper-10sol-v3-20261030',activatedAt:iso(at+60000),priceAt:iso(at+59900),priorEpoch:prior,priorRealizedPnlSol:'-1.000000000',priorExecutionCostsSol:'0.000200000'};
}
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
 ['wrong financial inception',s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';}],
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
test('existing source can advance through every installed recovery and exact feed repair, never backward',()=>{
 const c=fixture();c.accept(sample('1',p.from,T-4000),T);
 assert.equal(c.accept(sample('2',p.via,T-3000),T),'accepted');assert.equal(c.identity.release,p.via);
 assert.throws(()=>c.accept(sample('3',p.from),T),/source version/);
 assert.equal(c.accept(sample('3',p.previous,T-2000),T),'accepted');assert.equal(c.identity.release,p.previous);
 assert.throws(()=>c.accept(sample('4',p.via),T),/source version/);
 assert.equal(c.accept(sample('4',p.current,T-1000),T),'accepted');assert.equal(c.identity.release,p.current);
 assert.throws(()=>c.accept(sample('5',p.previous),T),/source version/);
 assert.equal(c.accept(sample('5',p.preparation,T-500),T),'accepted');assert.equal(c.identity.release,p.preparation);
 assert.throws(()=>c.accept(sample('6',p.current),T),/source version/);
 assert.equal(c.accept(sample('6',p.discovery,T-250),T),'accepted');assert.equal(c.identity.release,p.discovery);
 assert.throws(()=>c.accept(sample('7',p.preparation),T),/source version/);
 assert.equal(c.accept(sample('7',p.to),T),'accepted');assert.equal(c.identity.release,p.to);
 for(const old of [p.from,p.via,p.previous,p.current,p.preparation,p.discovery])assert.throws(()=>c.accept(sample('8',old),T),/source version/);
});
test('a receiver configured at the installed recovery accepts only the exact newer repair',()=>{
 const c=new SnapshotCache({...identity(),release:p.via});assert.equal(attachReviewedSourceHandover(c),true);
 c.accept(sample('8',p.via,T-1000),T);
 const bad=sample('9',p.to);bad.account.id='wrong-account';assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.via);
 assert.throws(()=>c.accept(sample('8',p.to),T));assert.equal(c.identity.release,p.via);
 assert.equal(c.accept(sample('9',p.to),T),'accepted');assert.equal(c.identity.release,p.to);
});
test('retained startup identity can skip a reviewed intermediate and accept current source before the exact repair',()=>{
 const c=fixture();c.accept(sample('30',p.from,T-120000),T);const before=c.equityHistory();
 assert.equal(c.accept(sample('31',p.previous,T-1000),T),'accepted');assert.equal(c.identity.release,p.previous);
 assert.equal(c.read().snapshot.account.id,p.accountId);assert.equal(c.read().snapshot.account.inceptionAt,p.inceptionAt);assert.ok(c.equityHistory().points.some(x=>x.at===before.points[0].at));
 assert.equal(c.accept(sample('32',p.current,T-750),T),'accepted');assert.equal(c.identity.release,p.current);
 assert.equal(c.accept(sample('33',p.preparation,T-500),T),'accepted');assert.equal(c.identity.release,p.preparation);
 assert.equal(c.accept(sample('34',p.discovery,T-250),T),'accepted');assert.equal(c.identity.release,p.discovery);
 assert.equal(c.accept(sample('35',p.to),T),'accepted');assert.equal(c.identity.release,p.to);assert.equal(c.read().snapshot.sequence,'35');
 for(const old of [p.previous,p.current,p.preparation,p.discovery])assert.throws(()=>c.accept(sample('36',old),T),/source version/);
});
for(const installed of [p.previous,p.current,p.preparation,p.discovery])test('a receiver configured at '+installed.slice(0,8)+' validates the exact repair before switching',()=>{
 const c=new SnapshotCache({...identity(),release:installed});assert.equal(attachReviewedSourceHandover(c),true);c.accept(sample('40',installed,T-1000),T);const before=c.read();
 const invalid=sample('41',p.to);invalid.account.inceptionAt='2026-10-27T22:07:36.212Z';assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,installed);assert.deepEqual(c.read(),before);
 assert.throws(()=>c.accept(sample('40',p.to),T));assert.equal(c.identity.release,installed);assert.deepEqual(c.read(),before);
 assert.equal(c.accept(sample('41',p.to),T),'accepted');assert.equal(c.identity.release,p.to);
});
for(const intermediate of [p.via,p.previous,p.current,p.preparation,p.discovery])test('an invalid intermediate '+intermediate.slice(0,8)+' report never changes the source or retained snapshot',()=>{
 const c=fixture();c.accept(sample('1'),T);const before=c.read();const bad=sample('2',intermediate);bad.liveTrading=true;
 assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.from);assert.deepEqual(c.read(),before);
 assert.equal(c.accept(sample('2',p.to),T),'accepted');
});
test('the installed discovery repair advances without changing the V3 financial epoch or retained equity',()=>{
 const c=new SnapshotCache({...identity(),release:p.discovery});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('50',p.discovery,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.equityHistory();
 const next={...sample('51',p.to),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.to);
 assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.read().snapshot.account,prior.account);
 const after=c.equityHistory();assert.deepEqual(after.financialEpoch,before.financialEpoch);
 for(const point of before.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');assert.deepEqual(c.equityHistory(),after);
 assert.throws(()=>c.accept({...prior,sequence:'52',times:next.times},T),/source version/);
});
for(const [name,mutate]of[
 ['omitted',s=>{delete s.financialEpoch;}],
 ['regressed',s=>{s.financialEpoch=s.financialEpoch.priorEpoch;}],
 ['conflicting',s=>{s.financialEpoch.backupSha256='c'.repeat(64);}],
])test('forward source transition rejects '+name+' epoch receipt without changing identity or history',()=>{
 const c=new SnapshotCache({...identity(),release:p.discovery});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('60',p.discovery,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 const bad={...sample('61',p.to),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);
 assert.throws(()=>c.accept(bad,T),/financial epoch regression or conflict/);
 assert.equal(c.identity.release,p.discovery);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 const valid={...sample('62',p.to),financialEpoch:structuredClone(prior.financialEpoch)};
 assert.equal(c.accept(valid,T),'accepted');assert.equal(c.identity.release,p.to);assert.deepEqual(c.read().snapshot.financialEpoch,prior.financialEpoch);
});
for(const installed of [p.from,p.preparation,p.discovery])test('existing HTTP authentication runs before forward transition from '+installed.slice(0,8),async t=>{
 const secret='offline-independent-ingestion-secret';const app=createDashboard({...identity(),release:installed,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 attachReviewedSourceHandover(app.cache);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
 const url='http://127.0.0.1:'+app.server.address().port+'/api/snapshot';
 const post=authorization=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(sample('1',p.to))});
 assert.equal((await post('Bearer wrong')).status,401);assert.equal(app.cache.identity.release,installed);assert.equal(app.cache.read(),null);
 assert.equal((await post('Bearer '+secret)).status,200);assert.equal(app.cache.identity.release,p.to);assert.equal(app.cache.read().snapshot.source.release,p.to);
});
