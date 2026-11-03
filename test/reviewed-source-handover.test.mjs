import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SnapshotCache} from '../dist/src/reporting.js';
import {createDashboard} from '../dist/src/dashboard.js';
import {restoreRenderReceiverHistory} from '../dist/src/render-history-bootstrap.js';
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
 assert.equal(c.accept(sample('7',p.cadence,T-125),T),'accepted');assert.equal(c.identity.release,p.cadence);
 assert.throws(()=>c.accept(sample('8',p.discovery),T),/source version/);
 assert.equal(c.accept(sample('8',p.ageQualified,T-50),T),'accepted');assert.equal(c.identity.release,p.ageQualified);
 assert.throws(()=>c.accept(sample('9',p.decisions),T),/source version/);
 assert.equal(c.accept(sample('9',p.to),T),'accepted');assert.equal(c.identity.release,p.to);
 for(const old of [p.from,p.via,p.previous,p.current,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance])assert.throws(()=>c.accept(sample('9',old),T),/source version/);
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
 assert.equal(c.accept(sample('35',p.cadence,T-125),T),'accepted');assert.equal(c.identity.release,p.cadence);
 assert.equal(c.accept(sample('36',p.ageQualified,T-50),T),'accepted');assert.equal(c.identity.release,p.ageQualified);
 assert.equal(c.accept(sample('37',p.to),T),'accepted');assert.equal(c.identity.release,p.to);assert.equal(c.read().snapshot.sequence,'37');
 for(const old of [p.previous,p.current,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance])assert.throws(()=>c.accept(sample('37',old),T),/source version/);
});
for(const installed of [p.previous,p.current,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance])test('a receiver configured at '+installed.slice(0,8)+' validates the exact repair before switching',()=>{
 const c=new SnapshotCache({...identity(),release:installed});assert.equal(attachReviewedSourceHandover(c),true);c.accept(sample('40',installed,T-1000),T);const before=c.read();
 const invalid=sample('41',p.to);invalid.account.inceptionAt='2026-10-27T22:07:36.212Z';assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,installed);assert.deepEqual(c.read(),before);
 assert.throws(()=>c.accept(sample('40',p.to),T));assert.equal(c.identity.release,installed);assert.deepEqual(c.read(),before);
 assert.equal(c.accept(sample('41',p.to),T),'accepted');assert.equal(c.identity.release,p.to);
});
for(const intermediate of [p.via,p.previous,p.current,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance])test('an invalid intermediate '+intermediate.slice(0,8)+' report never changes the source or retained snapshot',()=>{
 const c=fixture();c.accept(sample('1'),T);const before=c.read();const bad=sample('2',intermediate);bad.liveTrading=true;
 assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.from);assert.deepEqual(c.read(),before);
 assert.equal(c.accept(sample('2',p.to),T),'accepted');
});
test('the installed cadence repair advances without changing the V3 financial epoch or retained equity',()=>{
 const c=new SnapshotCache({...identity(),release:p.cadence});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('50',p.cadence,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.equityHistory();
 for(const uninstalled of ['e38d0a70051ff5228130c94dc8e4e7f203a43504','f6e24ce57f4c910af24c8345548aa1f7497a5165']){
  const superseded={...sample('51',uninstalled),financialEpoch:structuredClone(prior.financialEpoch)},retained=c.read();
  assert.throws(()=>c.accept(superseded,T),/source version/);assert.equal(c.identity.release,p.cadence);assert.deepEqual(c.read(),retained);assert.deepEqual(c.equityHistory(),before);
 }
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
 const c=new SnapshotCache({...identity(),release:p.cadence});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('60',p.cadence,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 const bad={...sample('61',p.to),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);
 assert.throws(()=>c.accept(bad,T),/financial epoch regression or conflict/);
 assert.equal(c.identity.release,p.cadence);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 const valid={...sample('62',p.to),financialEpoch:structuredClone(prior.financialEpoch)};
 assert.equal(c.accept(valid,T),'accepted');assert.equal(c.identity.release,p.to);assert.deepEqual(c.read().snapshot.financialEpoch,prior.financialEpoch);
});
for(const installed of [p.from,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance])test('existing HTTP authentication runs before forward transition from '+installed.slice(0,8),async t=>{
 const secret='offline-independent-ingestion-secret';const app=createDashboard({...identity(),release:installed,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 attachReviewedSourceHandover(app.cache);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
 const url='http://127.0.0.1:'+app.server.address().port+'/api/snapshot';
 const post=authorization=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(sample('1',p.to))});
 assert.equal((await post('Bearer wrong')).status,401);assert.equal(app.cache.identity.release,installed);assert.equal(app.cache.read(),null);
 assert.equal((await post('Bearer '+secret)).status,200);assert.equal(app.cache.identity.release,p.to);assert.equal(app.cache.read().snapshot.source.release,p.to);
});

test('the installed selection runtime advances to exact retention source with original epoch and equity intact',()=>{
 assert.equal(p.selection,'23650d160f0f42a07424002e11f83d54fce2b2db');assert.equal(p.retention,'13b2cb5f1404a17c29b5ecfe688540d728c8724b');
 const c=new SnapshotCache({...identity(),release:p.selection});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('70',p.selection,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.equityHistory(),retained=c.read();
 const malformed={...sample('71',p.retention),financialEpoch:structuredClone(prior.financialEpoch)};malformed.financialEpoch.backupSha256='d'.repeat(64);
 assert.throws(()=>c.accept(malformed,T),/financial epoch regression or conflict/);assert.equal(c.identity.release,p.selection);assert.deepEqual(c.read(),retained);assert.deepEqual(c.equityHistory(),before);
 const next={...sample('72',p.retention),financialEpoch:structuredClone(prior.financialEpoch)};assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.retention);
 assert.deepEqual(c.read().snapshot.account,prior.account);assert.deepEqual(c.equityHistory().financialEpoch,before.financialEpoch);for(const point of before.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.throws(()=>c.accept({...prior,sequence:'73',times:next.times},T),/source version/);
});

for(const installed of [p.selection,p.retention])test('installed '+installed.slice(0,8)+' advances to exact combined repair with original epoch and equity intact',()=>{
 assert.equal(p.selection,'23650d160f0f42a07424002e11f83d54fce2b2db');assert.equal(p.retention,'13b2cb5f1404a17c29b5ecfe688540d728c8724b');assert.equal(p.sustained,'1ffbda5445ea31ec0cfed2591669ace928c7f278');
 const c=new SnapshotCache({...identity(),release:installed});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('80',installed,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.equityHistory(),retained=c.read();
 const malformed={...sample('81',p.sustained),financialEpoch:structuredClone(prior.financialEpoch)};malformed.financialEpoch.backupSha256='e'.repeat(64);
 assert.throws(()=>c.accept(malformed,T),/financial epoch regression or conflict/);assert.equal(c.identity.release,installed);assert.deepEqual(c.read(),retained);assert.deepEqual(c.equityHistory(),before);
 const next={...sample('82',p.sustained),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.sustained);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.read().snapshot.account,prior.account);assert.deepEqual(c.equityHistory().financialEpoch,before.financialEpoch);for(const point of before.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');for(const release of [p.selection,p.retention])assert.throws(()=>c.accept({...next,sequence:'83',source:{...next.source,release}},T),/source version/);
});


test('the exact installed sustained runtime remains accepted until the reviewed efficiency source passes every check',()=>{
 assert.equal(p.sustained,'1ffbda5445ea31ec0cfed2591669ace928c7f278');assert.equal(p.efficiency,'92d83ba59d542fa2dfb20bca4444b704666f9c05','retain the exact prior efficiency source');assert.notEqual(p.efficiency,p.sustained);
 const c=new SnapshotCache({...identity(),release:p.sustained});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('90',p.sustained,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence='89';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);}]){
  const invalid={...sample('91',p.efficiency),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.sustained);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');
 const next={...sample('92',p.efficiency),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.efficiency);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');assert.throws(()=>c.accept({...next,sequence:'93',source:{...next.source,release:p.sustained}},T),/source version/);
});

test('the exact installed efficiency runtime remains accepted until the reviewed publication source passes every check',()=>{
 assert.equal(p.efficiency,'92d83ba59d542fa2dfb20bca4444b704666f9c05');assert.equal(p.publication,'c71f8e68bc27bae44c18b02025991182137a4fac','bind the exact publication and observation repair source');assert.notEqual(p.publication,p.efficiency);
 const c=new SnapshotCache({...identity(),release:p.efficiency});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('90',p.efficiency,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence='89';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);}]){
  const invalid={...sample('91',p.publication),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.efficiency);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');
 const next={...sample('92',p.publication),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.publication);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');assert.throws(()=>c.accept({...next,sequence:'93',source:{...next.source,release:p.efficiency}},T),/source version/);
});

test('the exact installed publication runtime advances only to the reviewed PumpSwap decision repair',()=>{
 assert.equal(p.publication,'c71f8e68bc27bae44c18b02025991182137a4fac');assert.equal(p.decisions,'24ed291d9da85f9661b3dec06d26d0a9332b97b5','bind the exact PumpSwap decision repair source');assert.notEqual(p.decisions,p.publication);
 const c=new SnapshotCache({...identity(),release:p.publication});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('90',p.publication,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence='89';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);}]){
  const invalid={...sample('91',p.decisions),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.publication);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');
 const next={...sample('92',p.decisions),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.decisions);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');assert.throws(()=>c.accept({...next,sequence:'93',source:{...next.source,release:p.publication}},T),/source version/);
});

test('the exact installed PumpSwap runtime advances only to the reviewed age-qualified discovery repair',()=>{
 assert.equal(p.decisions,'24ed291d9da85f9661b3dec06d26d0a9332b97b5');assert.equal(p.ageQualified,'8913a9107989ce334b03e6167a2b4fc10d6fb7f6','bind the exact age-qualified discovery source');assert.notEqual(p.ageQualified,p.decisions);
 const c=new SnapshotCache({...identity(),release:p.decisions});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('90',p.decisions,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence='89';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);}]){
  const invalid={...sample('91',p.ageQualified),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.decisions);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');
 const next={...sample('92',p.ageQualified),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.ageQualified);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');assert.throws(()=>c.accept({...next,sequence:'93',source:{...next.source,release:p.decisions}},T),/source version/);
});


test('the exact installed age-qualified runtime advances only to the reviewed qualification and reporting repair',()=>{
 assert.equal(p.ageQualified,'8913a9107989ce334b03e6167a2b4fc10d6fb7f6','retain the exact installed A4 source');assert.equal(p.proofTimeout,'acb50ffee8c374b3f67ee10da0780ec69a62ba03','bind the exact reviewed A5 application source');assert.match(p.proofTimeout,/^[a-f0-9]{40}$/);assert.notEqual(p.proofTimeout,p.ageQualified);
 const c=new SnapshotCache({...identity(),release:p.ageQualified});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('90',p.ageQualified,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence='89';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);}]){
  const invalid={...sample('91',p.proofTimeout),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.ageQualified);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');
 const next={...sample('92',p.proofTimeout),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.proofTimeout);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');for(const release of [p.decisions,p.ageQualified])assert.throws(()=>c.accept({...next,sequence:'93',source:{...next.source,release}},T),/source version/);
});

test('the exact installed proof-timeout runtime advances only to the reviewed held-observation scheduling repair',()=>{
 assert.equal(p.proofTimeout,'acb50ffee8c374b3f67ee10da0780ec69a62ba03','retain the exact installed A5 source');assert.equal(p.scheduling,'c46d6f301535c80027bc31b29a15681b216df62e','bind the exact reviewed A6 application source');assert.match(p.scheduling,/^[a-f0-9]{40}$/);assert.notEqual(p.scheduling,p.proofTimeout);
 const c=new SnapshotCache({...identity(),release:p.proofTimeout});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('90',p.proofTimeout,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence='89';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);}]){
  const invalid={...sample('91',p.scheduling),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.proofTimeout);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');
 const next={...sample('92',p.scheduling),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.scheduling);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');for(const release of [p.decisions,p.ageQualified,p.proofTimeout])assert.throws(()=>c.accept({...next,sequence:'93',source:{...next.source,release}},T),/source version/);
});

test('the reviewed scheduler source advances to migration-age scope without changing the account',()=>{
 assert.equal(p.scheduling,'c46d6f301535c80027bc31b29a15681b216df62e','retain the exact installed A5 source');assert.equal(p.migrationAge,'356083fd8f0e69297c8470d4493077a175d2bad1','bind the exact reviewed A6 application source');assert.match(p.migrationAge,/^[a-f0-9]{40}$/);assert.notEqual(p.migrationAge,p.scheduling);
 const c=new SnapshotCache({...identity(),release:p.scheduling});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('90',p.scheduling,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence='89';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);}]){
  const invalid={...sample('91',p.migrationAge),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.scheduling);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');
 const next={...sample('92',p.migrationAge),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.migrationAge);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');for(const release of [p.decisions,p.ageQualified,p.scheduling])assert.throws(()=>c.accept({...next,sequence:'93',source:{...next.source,release}},T),/source version/);
});

test('installed H2 reporting advances to the exact recovery source while preserving account and lifetime history',()=>{
 assert.equal(p.coordinatedRepair,'c92a2b95b1c175bf67b65cbe072c9e5f5080303d');assert.equal(p.recoveryProvenance,'69a8c2f8c0d79370a422c1d4cfa6fd60830087e6');
 const c=new SnapshotCache({...identity(),release:p.coordinatedRepair});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254740992',p.coordinatedRepair,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='a'.repeat(40);}]){
  const invalid={...sample('9007199254740993',p.recoveryProvenance),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.coordinatedRepair);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254740993',p.recoveryProvenance),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.recoveryProvenance);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.read().snapshot.account,prior.account);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');assert.throws(()=>c.accept({...next,sequence:'9007199254740994',source:{...next.source,release:p.coordinatedRepair}},T),/source version/);
});

test('installed H3 reporting advances only to the exact migration query repair while preserving account and lifetime history',()=>{
 assert.equal(p.recoveryProvenance,'69a8c2f8c0d79370a422c1d4cfa6fd60830087e6');assert.equal(p.to,'873da573b62dcaac4f652891e2b9f4d741640d28');
 const c=new SnapshotCache({...identity(),release:p.recoveryProvenance});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254740992',p.recoveryProvenance,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='a'.repeat(40);}]){
  const invalid={...sample('9007199254740993',p.to),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.recoveryProvenance);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254740993',p.to),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.to);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.read().snapshot.account,prior.account);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');assert.throws(()=>c.accept({...next,sequence:'9007199254740994',source:{...next.source,release:p.recoveryProvenance}},T),/source version/);
});

test('the installed migration-age source advances only to the exact published operating repair without changing original history',()=>{
 assert.equal(p.migrationAge,'356083fd8f0e69297c8470d4493077a175d2bad1','retain the exact installed migration-age source');
 assert.equal(p.coordinatedRepair,'c92a2b95b1c175bf67b65cbe072c9e5f5080303d','retain the exact installed H2 source');
 assert.equal(p.recoveryProvenance,'69a8c2f8c0d79370a422c1d4cfa6fd60830087e6','retain the exact installed H3 recovery runtime');
 assert.equal(p.to,'873da573b62dcaac4f652891e2b9f4d741640d28','bind the exact published migration query runtime, independently of this reporting commit');
 const c=new SnapshotCache({...identity(),release:p.migrationAge});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254740992',p.migrationAge,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [
  s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},
  s=>{s.sequence='9007199254740991';},s=>{s.sequence=prior.sequence;},s=>{delete s.financialEpoch;},
  s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='f'.repeat(64);},
  s=>{s.liveTrading=true;},s=>{s.source.release='a0e55cf50471e589eeabdc3337d2fc89f0191950';},
  s=>{s.source.release='3851bd22cf55bc85e5772d06e72f06ead1ae30ef';}, // Superseded source was never installed or admitted to the reviewed route.
 ]){
  const invalid={...sample('9007199254740993',p.to),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.migrationAge);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate','the still-installed source remains usable after every rejected target');
 const next={...sample('9007199254740993',p.to),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.to);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(c.read().snapshot.account,prior.account);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');
 assert.throws(()=>c.accept({...next,sequence:'9007199254740994',source:{...next.source,release:p.migrationAge}},T),/source version/);
});

for(const installed of [p.migrationAge,p.recoveryProvenance])test('authenticated '+installed.slice(0,8)+' to exact migration query repair preserves durable lifetime history and fixed receiver captures',async t=>{
 const secret='offline-continuity-ingestion-secret',app=createDashboard({...identity(),release:installed,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);
 assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port;
 const post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 // Disposable financial amounts; use the original epoch timestamps so the
 // exact pre-epoch receiver captures keep their genuine chronological scope.
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',installed,T-120000),financialEpoch:epoch};
 assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[
  {at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},
  {at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},
  {at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},
  {at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'},
 ]};
 assert.equal((await post('/api/equity-history',durable,'Bearer wrong')).status,401);
 assert.equal((await post('/api/equity-history',durable)).status,200);
 const before=app.cache.read(),history=app.cache.equityHistory();assert.equal(history.retention,'durable-with-preserved-receiver');assert.equal(history.windowLimited,false);assert.ok(history.preservedReceiverPoints>0);
 const next={...sample('9007199254741001',p.to),financialEpoch:structuredClone(epoch)};
 assert.equal((await post('/api/snapshot',next,'Bearer wrong')).status,401);
 assert.equal(app.cache.identity.release,installed);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 assert.equal((await post('/api/snapshot',{...next,sequence:prior.sequence})).status,409);
 const omitted=structuredClone(next);delete omitted.financialEpoch;assert.equal((await post('/api/snapshot',omitted)).status,409);
 assert.equal(app.cache.identity.release,installed);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 assert.equal((await post('/api/snapshot',next)).status,200);
 const response=await (await fetch(base+'/api/snapshot')).json();assert.equal(response.snapshot.source.release,p.to);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);
 assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');
 for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 assert.equal((await post('/api/snapshot',{...next,sequence:'9007199254741002',source:{...next.source,release:installed}})).status,400);
 const continued={...durable,lastSequence:next.sequence,points:[...durable.points,{at:next.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',continued)).status,200,'the ordinary complete-history republisher remains accepted after source handover');
 assert.equal(app.cache.identity.release,p.to);assert.deepEqual(app.cache.equityHistory().financialEpoch,epoch);assert.equal(app.cache.equityHistory().points.at(-1).at,next.times.generatedAt);
});
