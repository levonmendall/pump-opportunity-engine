import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SnapshotCache} from '../dist/src/reporting.js';
import {createDashboard} from '../dist/src/dashboard.js';
import {restoreRenderReceiverHistory} from '../dist/src/render-history-bootstrap.js';
import {projectOperatingIntelligence} from '../dist/src/operating-intelligence.js';
import {PAPER_TWO_HOLDING_OPERATING_POLICY,paperEntryCapacity} from '../dist/src/paper-operating-capacity.js';
import {MIGRATION_AGE_POLICY} from '../dist/src/migration-age-policy.js';
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
 for(const old of [p.from,p.via,p.previous,p.current,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.migrationQuery,p.readinessReporting,p.proofHandoff,p.migrationReentry])assert.throws(()=>c.accept(sample('9',old),T),/source version/);
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
 for(const old of [p.previous,p.current,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.migrationQuery,p.readinessReporting,p.proofHandoff,p.migrationReentry])assert.throws(()=>c.accept(sample('37',old),T),/source version/);
});
for(const installed of [p.previous,p.current,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.migrationQuery,p.readinessReporting,p.proofHandoff,p.migrationReentry])test('a receiver configured at '+installed.slice(0,8)+' validates the exact repair before switching',()=>{
 const c=new SnapshotCache({...identity(),release:installed});assert.equal(attachReviewedSourceHandover(c),true);c.accept(sample('40',installed,T-1000),T);const before=c.read();
 const invalid=sample('41',p.to);invalid.account.inceptionAt='2026-10-27T22:07:36.212Z';assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,installed);assert.deepEqual(c.read(),before);
 assert.throws(()=>c.accept(sample('40',p.to),T));assert.equal(c.identity.release,installed);assert.deepEqual(c.read(),before);
 assert.equal(c.accept(sample('41',p.to),T),'accepted');assert.equal(c.identity.release,p.to);
});
for(const intermediate of [p.via,p.previous,p.current,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.migrationQuery,p.readinessReporting,p.proofHandoff,p.migrationReentry])test('an invalid intermediate '+intermediate.slice(0,8)+' report never changes the source or retained snapshot',()=>{
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
for(const installed of [p.from,p.preparation,p.discovery,p.cadence,p.selection,p.retention,p.sustained,p.efficiency,p.publication,p.decisions,p.ageQualified,p.proofTimeout,p.scheduling,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.migrationQuery,p.readinessReporting,p.proofHandoff,p.migrationReentry])test('existing HTTP authentication runs before forward transition from '+installed.slice(0,8),async t=>{
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
 assert.equal(p.recoveryProvenance,'69a8c2f8c0d79370a422c1d4cfa6fd60830087e6');assert.equal(p.migrationQuery,'873da573b62dcaac4f652891e2b9f4d741640d28');
 const c=new SnapshotCache({...identity(),release:p.recoveryProvenance});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254740992',p.recoveryProvenance,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.backupSha256='f'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='a'.repeat(40);}]){
  const invalid={...sample('9007199254740993',p.migrationQuery),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.recoveryProvenance);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254740993',p.migrationQuery),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.migrationQuery);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.read().snapshot.account,prior.account);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 assert.equal(c.accept(next,T),'duplicate');assert.throws(()=>c.accept({...next,sequence:'9007199254740994',source:{...next.source,release:p.recoveryProvenance}},T),/source version/);
});

test('the installed migration-age source advances only to the exact published operating repair without changing original history',()=>{
 assert.equal(p.migrationAge,'356083fd8f0e69297c8470d4493077a175d2bad1','retain the exact installed migration-age source');
 assert.equal(p.coordinatedRepair,'c92a2b95b1c175bf67b65cbe072c9e5f5080303d','retain the exact installed H2 source');
 assert.equal(p.recoveryProvenance,'69a8c2f8c0d79370a422c1d4cfa6fd60830087e6','retain the exact installed H3 recovery runtime');
 assert.equal(p.migrationQuery,'873da573b62dcaac4f652891e2b9f4d741640d28','bind the exact published migration query runtime, independently of this reporting commit');
 const c=new SnapshotCache({...identity(),release:p.migrationAge});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254740992',p.migrationAge,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [
  s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},
  s=>{s.sequence='9007199254740991';},s=>{s.sequence=prior.sequence;},s=>{delete s.financialEpoch;},
  s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='f'.repeat(64);},
  s=>{s.liveTrading=true;},s=>{s.source.release='a0e55cf50471e589eeabdc3337d2fc89f0191950';},
  s=>{s.source.release='3851bd22cf55bc85e5772d06e72f06ead1ae30ef';}, // Superseded source was never installed or admitted to the reviewed route.
 ]){
  const invalid={...sample('9007199254740993',p.migrationQuery),financialEpoch:structuredClone(prior.financialEpoch)};mutate(invalid);
  assert.throws(()=>c.accept(invalid,T));assert.equal(c.identity.release,p.migrationAge);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate','the still-installed source remains usable after every rejected target');
 const next={...sample('9007199254740993',p.migrationQuery),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.migrationQuery);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
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
 const next={...sample('9007199254741001',p.migrationQuery),financialEpoch:structuredClone(epoch)};
 assert.equal((await post('/api/snapshot',next,'Bearer wrong')).status,401);
 assert.equal(app.cache.identity.release,installed);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 assert.equal((await post('/api/snapshot',{...next,sequence:prior.sequence})).status,409);
 const omitted=structuredClone(next);delete omitted.financialEpoch;assert.equal((await post('/api/snapshot',omitted)).status,409);
 assert.equal(app.cache.identity.release,installed);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 assert.equal((await post('/api/snapshot',next)).status,200);
 const response=await (await fetch(base+'/api/snapshot')).json();assert.equal(response.snapshot.source.release,p.migrationQuery);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);
 assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');
 for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 assert.equal((await post('/api/snapshot',{...next,sequence:'9007199254741002',source:{...next.source,release:installed}})).status,400);
 const continued={...durable,lastSequence:next.sequence,points:[...durable.points,{at:next.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',continued)).status,200,'the ordinary complete-history republisher remains accepted after source handover');
 assert.equal(app.cache.identity.release,p.migrationQuery);assert.deepEqual(app.cache.equityHistory().financialEpoch,epoch);assert.equal(app.cache.equityHistory().points.at(-1).at,next.times.generatedAt);
});

test('exact installed H4 advances only to H5 without resetting account, epoch, original clocks or large sequence',()=>{
 assert.equal(p.migrationQuery,'873da573b62dcaac4f652891e2b9f4d741640d28');assert.equal(p.readinessReporting,'8e1f09b01f06fc01d4bcc014961f367c15ad35b4');
 const c=new SnapshotCache({...identity(),release:p.migrationQuery});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.migrationQuery,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);}]){
  const bad={...sample('9007199254741001',p.readinessReporting,T-1000),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.migrationQuery);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254741001',p.readinessReporting,T-1000),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of [p.from,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.migrationQuery])assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});

test('authenticated H4 to H5 preserves durable lifetime history across two fresh advancing source captures',async t=>{
 const secret='offline-h5-continuity-ingestion-secret',app=createDashboard({...identity(),release:p.migrationQuery,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',p.migrationQuery,T-120000),financialEpoch:epoch};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable)).status,200);const history=app.cache.equityHistory(),before=app.cache.read();assert.equal(history.retention,'durable-with-preserved-receiver');assert.ok(history.preservedReceiverPoints>0);
 const first={...sample('9007199254741001',p.readinessReporting,T-1000),financialEpoch:structuredClone(epoch)},second={...sample('9007199254741002',p.readinessReporting,T),financialEpoch:structuredClone(epoch)},captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.migrationQuery);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const response=await(await fetch(base+'/api/snapshot')).json();captures.push(response);
  assert.equal(response.snapshot.source.release,p.readinessReporting);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);assert.deepEqual(response.snapshot.times,next.times);assert.ok(Date.now()-Date.parse(response.snapshot.times.generatedAt)<90000);
  assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.migrationQuery}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);
 const after=app.cache.equityHistory();assert.equal(app.cache.identity.release,p.readinessReporting);assert.deepEqual(after.financialEpoch,epoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

test('exact installed H5 advances only to H6 without resetting account, epoch, original clocks or large sequence',()=>{
 assert.equal(p.readinessReporting,'8e1f09b01f06fc01d4bcc014961f367c15ad35b4');assert.equal(p.proofHandoff,'8334f5a56d01706cbdacc019bbc1fe76a136df24');assert.match(p.proofHandoff,/^[a-f0-9]{40}$/);assert.notEqual(p.proofHandoff,p.readinessReporting);
 const c=new SnapshotCache({...identity(),release:p.readinessReporting});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.readinessReporting,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);}]){
  const bad={...sample('9007199254741001',p.proofHandoff,T-1000),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.readinessReporting);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254741001',p.proofHandoff,T-1000),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of [p.from,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.readinessReporting])assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});

test('authenticated H5 to H6 preserves durable lifetime history across two fresh advancing source captures',async t=>{
 const secret='offline-h6-continuity-ingestion-secret',app=createDashboard({...identity(),release:p.readinessReporting,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',p.readinessReporting,T-120000),financialEpoch:epoch};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable)).status,200);const history=app.cache.equityHistory(),before=app.cache.read();assert.equal(history.retention,'durable-with-preserved-receiver');assert.ok(history.preservedReceiverPoints>0);
 const first={...sample('9007199254741001',p.proofHandoff,T-1000),financialEpoch:structuredClone(epoch)},second={...sample('9007199254741002',p.proofHandoff,T),financialEpoch:structuredClone(epoch)},captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.readinessReporting);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const response=await(await fetch(base+'/api/snapshot')).json();captures.push(response);
  assert.equal(response.snapshot.source.release,p.proofHandoff);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);assert.deepEqual(response.snapshot.times,next.times);assert.ok(Date.now()-Date.parse(response.snapshot.times.generatedAt)<90000);
  assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.readinessReporting}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);
 const after=app.cache.equityHistory();assert.equal(app.cache.identity.release,p.proofHandoff);assert.deepEqual(after.financialEpoch,epoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

test('exact installed H6 advances only to H7 without resetting account, epoch, original clocks or large sequence',()=>{
 assert.equal(p.proofHandoff,'8334f5a56d01706cbdacc019bbc1fe76a136df24');assert.equal(p.migrationReentry,'9c528bd4750c56900ce4bc53ccf594e498377d29');assert.match(p.migrationReentry,/^[a-f0-9]{40}$/);assert.notEqual(p.migrationReentry,p.proofHandoff);
 const c=new SnapshotCache({...identity(),release:p.proofHandoff});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.proofHandoff,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);}]){
  const bad={...sample('9007199254741001',p.migrationReentry,T-1000),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.proofHandoff);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254741001',p.migrationReentry,T-1000),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of [p.from,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.readinessReporting,p.proofHandoff])assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});

test('authenticated H6 to H7 preserves durable lifetime history across two fresh advancing source captures',async t=>{
 const secret='offline-h7-continuity-ingestion-secret',app=createDashboard({...identity(),release:p.proofHandoff,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',p.proofHandoff,T-120000),financialEpoch:epoch};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable)).status,200);const history=app.cache.equityHistory(),before=app.cache.read();assert.equal(history.retention,'durable-with-preserved-receiver');assert.ok(history.preservedReceiverPoints>0);
 const first={...sample('9007199254741001',p.migrationReentry,T-1000),financialEpoch:structuredClone(epoch)},second={...sample('9007199254741002',p.migrationReentry,T),financialEpoch:structuredClone(epoch)},captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.proofHandoff);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const response=await(await fetch(base+'/api/snapshot')).json();captures.push(response);
  assert.equal(response.snapshot.source.release,p.migrationReentry);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);assert.deepEqual(response.snapshot.times,next.times);assert.ok(Date.now()-Date.parse(response.snapshot.times.generatedAt)<90000);
  assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.proofHandoff}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);
 const after=app.cache.equityHistory();assert.equal(app.cache.identity.release,p.migrationReentry);assert.deepEqual(after.financialEpoch,epoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

test('exact installed H6 advances only to H8 without resetting account, epoch, original clocks or large sequence',()=>{
 assert.equal(p.proofHandoff,'8334f5a56d01706cbdacc019bbc1fe76a136df24');assert.equal(p.operatingReliability,'a885208fb2cc6cc2548e6e761c22300c1f6d8f54');assert.match(p.operatingReliability,/^[a-f0-9]{40}$/);assert.notEqual(p.operatingReliability,p.proofHandoff);
 const c=new SnapshotCache({...identity(),release:p.proofHandoff});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.proofHandoff,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);}]){
  const bad={...sample('9007199254741001',p.operatingReliability,T-1000),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.proofHandoff);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254741001',p.operatingReliability,T-1000),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of [p.from,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.readinessReporting,p.proofHandoff,p.migrationReentry])assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});

test('authenticated H6 to H8 preserves durable lifetime history across two fresh advancing source captures',async t=>{
 const secret='offline-h8-continuity-ingestion-secret',app=createDashboard({...identity(),release:p.proofHandoff,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',p.proofHandoff,T-120000),financialEpoch:epoch};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable)).status,200);const history=app.cache.equityHistory(),before=app.cache.read();assert.equal(history.retention,'durable-with-preserved-receiver');assert.ok(history.preservedReceiverPoints>0);
 const first={...sample('9007199254741001',p.operatingReliability,T-1000),financialEpoch:structuredClone(epoch)},second={...sample('9007199254741002',p.operatingReliability,T),financialEpoch:structuredClone(epoch)},captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.proofHandoff);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const response=await(await fetch(base+'/api/snapshot')).json();captures.push(response);
  assert.equal(response.snapshot.source.release,p.operatingReliability);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);assert.deepEqual(response.snapshot.times,next.times);assert.ok(Date.now()-Date.parse(response.snapshot.times.generatedAt)<90000);
  assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.proofHandoff}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);
 const after=app.cache.equityHistory();assert.equal(app.cache.identity.release,p.operatingReliability);assert.deepEqual(after.financialEpoch,epoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

test('exact installed H8 advances only to H9 without resetting account, epoch, original clocks or large sequence',()=>{
 assert.equal(p.operatingReliability,'a885208fb2cc6cc2548e6e761c22300c1f6d8f54');assert.equal(p.operatingFollowthrough,'79e07c604e520e9be3a55e273b4289093646b76e');assert.match(p.operatingFollowthrough,/^[a-f0-9]{40}$/);assert.notEqual(p.operatingFollowthrough,p.operatingReliability);
 const c=new SnapshotCache({...identity(),release:p.operatingReliability});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.operatingReliability,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);}]){
  const bad={...sample('9007199254741001',p.operatingFollowthrough,T-1000),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.operatingReliability);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254741001',p.operatingFollowthrough,T-1000),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of [p.from,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.readinessReporting,p.proofHandoff,p.operatingReliability,p.migrationReentry])assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});

test('authenticated H8 to H9 preserves durable lifetime history across two fresh advancing source captures',async t=>{
 const secret='offline-h9-continuity-ingestion-secret',app=createDashboard({...identity(),release:p.operatingReliability,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',p.operatingReliability,T-120000),financialEpoch:epoch};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable)).status,200);const history=app.cache.equityHistory(),before=app.cache.read();assert.equal(history.retention,'durable-with-preserved-receiver');assert.ok(history.preservedReceiverPoints>0);
 const first={...sample('9007199254741001',p.operatingFollowthrough,T-1000),financialEpoch:structuredClone(epoch)},second={...sample('9007199254741002',p.operatingFollowthrough,T),financialEpoch:structuredClone(epoch)},captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingReliability);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const response=await(await fetch(base+'/api/snapshot')).json();captures.push(response);
  assert.equal(response.snapshot.source.release,p.operatingFollowthrough);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);assert.deepEqual(response.snapshot.times,next.times);assert.ok(Date.now()-Date.parse(response.snapshot.times.generatedAt)<90000);
  assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingReliability}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);
 const after=app.cache.equityHistory();assert.equal(app.cache.identity.release,p.operatingFollowthrough);assert.deepEqual(after.financialEpoch,epoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

test('exact installed H9 advances only to H10 without resetting account, epoch, original clocks or large sequence',()=>{
 assert.equal(p.operatingFollowthrough,'79e07c604e520e9be3a55e273b4289093646b76e');assert.equal(p.financialFeasiblePeer,'65994a4ccb66a3c2f4ac09f4fa9562516afae600');assert.match(p.financialFeasiblePeer,/^[a-f0-9]{40}$/);assert.notEqual(p.financialFeasiblePeer,p.operatingFollowthrough);
 const c=new SnapshotCache({...identity(),release:p.operatingFollowthrough});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.operatingFollowthrough,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);}]){
  const bad={...sample('9007199254741001',p.financialFeasiblePeer,T-1000),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.operatingFollowthrough);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254741001',p.financialFeasiblePeer,T-1000),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of [p.from,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.readinessReporting,p.proofHandoff,p.operatingReliability,p.operatingFollowthrough,p.migrationReentry])assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});

test('authenticated H9 to H10 preserves durable lifetime history across two fresh advancing source captures',async t=>{
 const secret='offline-h10-continuity-ingestion-secret',app=createDashboard({...identity(),release:p.operatingFollowthrough,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',p.operatingFollowthrough,T-120000),financialEpoch:epoch};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable)).status,200);const history=app.cache.equityHistory(),before=app.cache.read();assert.equal(history.retention,'durable-with-preserved-receiver');assert.ok(history.preservedReceiverPoints>0);
 const first={...sample('9007199254741001',p.financialFeasiblePeer,T-1000),financialEpoch:structuredClone(epoch)},second={...sample('9007199254741002',p.financialFeasiblePeer,T),financialEpoch:structuredClone(epoch)},captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingFollowthrough);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const response=await(await fetch(base+'/api/snapshot')).json();captures.push(response);
  assert.equal(response.snapshot.source.release,p.financialFeasiblePeer);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);assert.deepEqual(response.snapshot.times,next.times);assert.ok(Date.now()-Date.parse(response.snapshot.times.generatedAt)<90000);
  assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingFollowthrough}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);
 const after=app.cache.equityHistory();assert.equal(app.cache.identity.release,p.financialFeasiblePeer);assert.deepEqual(after.financialEpoch,epoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

test('exact installed H9 advances only to backup recovery successor without resetting account, epoch, original clocks or large sequence',()=>{
 assert.equal(p.operatingFollowthrough,'79e07c604e520e9be3a55e273b4289093646b76e');assert.equal(p.backupRecovery,'de71a4c514da11c65a066a6aef330466aacd15e4');assert.match(p.backupRecovery,/^[a-f0-9]{40}$/);assert.notEqual(p.backupRecovery,p.operatingFollowthrough);
 const c=new SnapshotCache({...identity(),release:p.operatingFollowthrough});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.operatingFollowthrough,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);}]){
  const bad={...sample('9007199254741001',p.backupRecovery,T-1000),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.operatingFollowthrough);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254741001',p.backupRecovery,T-1000),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of [p.from,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.readinessReporting,p.proofHandoff,p.operatingReliability,p.operatingFollowthrough,p.migrationReentry,p.financialFeasiblePeer])assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});

test('authenticated H9 to backup recovery successor preserves durable lifetime history across two fresh advancing source captures',async t=>{
 const secret='offline-backup-recovery-successor-continuity-ingestion-secret',app=createDashboard({...identity(),release:p.operatingFollowthrough,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',p.operatingFollowthrough,T-120000),financialEpoch:epoch};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable)).status,200);const history=app.cache.equityHistory(),before=app.cache.read();assert.equal(history.retention,'durable-with-preserved-receiver');assert.ok(history.preservedReceiverPoints>0);
 const first={...sample('9007199254741001',p.backupRecovery,T-1000),financialEpoch:structuredClone(epoch)},second={...sample('9007199254741002',p.backupRecovery,T),financialEpoch:structuredClone(epoch)},captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingFollowthrough);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const response=await(await fetch(base+'/api/snapshot')).json();captures.push(response);
  assert.equal(response.snapshot.source.release,p.backupRecovery);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);assert.deepEqual(response.snapshot.times,next.times);assert.ok(Date.now()-Date.parse(response.snapshot.times.generatedAt)<90000);
  assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingFollowthrough}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);
 const after=app.cache.equityHistory();assert.equal(app.cache.identity.release,p.backupRecovery);assert.deepEqual(after.financialEpoch,epoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

test('actual installed H9 advances directly to H11 A4 without resetting account, epoch, original clocks or large sequence',()=>{
 assert.equal(p.operatingFollowthrough,'79e07c604e520e9be3a55e273b4289093646b76e');assert.equal(p.financialFeasiblePeer,'65994a4ccb66a3c2f4ac09f4fa9562516afae600');assert.equal(p.backupRecovery,'de71a4c514da11c65a066a6aef330466aacd15e4');assert.equal(p.operatingRecovery,'be509874f060ef5ac9b3be5bd1cdc08d0e176613');assert.notEqual(p.operatingRecovery,p.financialFeasiblePeer);assert.notEqual(p.operatingRecovery,p.backupRecovery);assert.match(p.operatingRecovery,/^[a-f0-9]{40}$/);assert.notEqual(p.operatingRecovery,p.operatingFollowthrough);
 const c=new SnapshotCache({...identity(),release:p.operatingFollowthrough});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.operatingFollowthrough,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);}]){
  const bad={...sample('9007199254741001',p.operatingRecovery,T-1000),financialEpoch:structuredClone(prior.financialEpoch)};mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.operatingFollowthrough);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next={...sample('9007199254741001',p.operatingRecovery,T-1000),financialEpoch:structuredClone(prior.financialEpoch)},saved=structuredClone(next);
 assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.deepEqual(c.equityHistory().financialEpoch,history.financialEpoch);
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of [p.from,p.migrationAge,p.coordinatedRepair,p.recoveryProvenance,p.readinessReporting,p.proofHandoff,p.operatingReliability,p.operatingFollowthrough,p.migrationReentry,p.financialFeasiblePeer,p.backupRecovery])assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});

test('authenticated direct H9 to H11 A4 preserves durable lifetime history across two fresh advancing source captures',async t=>{
 const secret='offline-h11-a4-continuity-ingestion-secret',app=createDashboard({...identity(),release:p.operatingFollowthrough,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
 assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);assert.ok(restored.points>0);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const epoch=v3Epoch();epoch.priorEpoch.activatedAt='2026-10-30T15:30:23.584Z';epoch.priorEpoch.priceAt='2026-10-30T15:30:23.484Z';epoch.activatedAt='2026-10-30T19:15:05.083Z';epoch.priceAt='2026-10-30T19:15:04.983Z';
 const prior={...sample('9007199254741000',p.operatingFollowthrough,T-120000),financialEpoch:epoch};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(epoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:epoch.priorEpoch.activatedAt,equityUsd:epoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:epoch.activatedAt,equityUsd:epoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable)).status,200);const history=app.cache.equityHistory(),before=app.cache.read();assert.equal(history.retention,'durable-with-preserved-receiver');assert.ok(history.preservedReceiverPoints>0);
 const first={...sample('9007199254741001',p.operatingRecovery,T-1000),financialEpoch:structuredClone(epoch)},second={...sample('9007199254741002',p.operatingRecovery,T),financialEpoch:structuredClone(epoch)},captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingFollowthrough);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const response=await(await fetch(base+'/api/snapshot')).json();captures.push(response);
  assert.equal(response.snapshot.source.release,p.operatingRecovery);assert.equal(response.snapshot.sequence,next.sequence);assert.deepEqual(response.snapshot.account,prior.account);assert.deepEqual(response.snapshot.times,next.times);assert.ok(Date.now()-Date.parse(response.snapshot.times.generatedAt)<90000);
  assert.deepEqual(response.snapshot.financialEpoch,epoch);assert.deepEqual(response.equityHistory.financialEpoch,epoch);assert.equal(response.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(response.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 for(const release of [p.operatingFollowthrough,p.financialFeasiblePeer,p.backupRecovery])assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);
 const after=app.cache.equityHistory();assert.equal(app.cache.identity.release,p.operatingRecovery);assert.deepEqual(after.financialEpoch,epoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

// Disposable source facts exercise the actual optional policy projector. They
// grant no financial permission and are not operating evidence or paper fills.
const capacityConfiguration='c8587da718318096c2a05c023fcd1745f51a6486ac1c6b7be18aee6e7a86022f';
function capacitySourceSnapshot(sequence,at){
 const state={positions:{},pending:{}},raw={accountId:p.accountId,inceptionAt:Date.parse(p.inceptionAt),runId:'offline-two-holding-source',startedAt:T-60000,generatedAt:at,source:{commit:p.operatingCapacity,sha256:'d'.repeat(64)},configurationSha256:capacityConfiguration,strategyVersion:p.strategy,persistent:true,...state,entriesEnabled:false,usage:{market:{}},operatingCapacity:{policy:PAPER_TWO_HOLDING_OPERATING_POLICY,...paperEntryCapacity(state,null,PAPER_TWO_HOLDING_OPERATING_POLICY)},marketAdmissionAgePolicy:MIGRATION_AGE_POLICY,operatingSupervision:null};
 return {...sample(sequence,p.operatingCapacity,at),financialEpoch:v3Epoch(),intelligence:projectOperatingIntelligence(raw)};
}
test('actual be anchor advances to exact two-holding successor while old routes, epoch, financial state and source clocks remain protected',()=>{
 assert.equal(p.operatingRecovery,'be509874f060ef5ac9b3be5bd1cdc08d0e176613');assert.equal(p.operatingCapacity,'427c5a9f8fb8ae81f6793a1581502a71beaaa1d9');assert.notEqual(p.operatingCapacity,p.operatingRecovery);
 const c=new SnapshotCache({...identity(),release:p.operatingRecovery});assert.equal(attachReviewedSourceHandover(c),true);const prior={...sample('9007199254741000',p.operatingRecovery,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);},s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},s=>{s.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission=true;},s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=86400000;}]){
  const bad=capacitySourceSnapshot('9007199254741001',T-1000);mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.operatingRecovery);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next=capacitySourceSnapshot('9007199254741001',T-1000),saved=structuredClone(next);assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.equal(c.identity.release,p.operatingCapacity);assert.equal(next.intelligence.run.configurationSha256,capacityConfiguration);
 const policy=next.intelligence.financialPolicy;assert.equal(policy.operatingCapacity.maximumPositions,2);assert.equal(policy.operatingCapacity.historicalMaximumPositions,null);assert.equal(policy.operatingCapacity.occupiedPositions,0);assert.equal(policy.operatingCapacity.grantsFinancialPermission,false);assert.equal(policy.marketAdmissionAge.minimumAgeMs,60000);assert.equal(policy.marketAdmissionAge.maximumAgeMs,86400000);assert.equal(next.intelligence.operatingSupervision,null);assert.equal(next.status.entries,'paused');
 assert.deepEqual(next.account,prior.account);assert.deepEqual(next.balances,prior.balances);assert.deepEqual(next.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of Object.values(p).filter(value=>/^[a-f0-9]{40}$/.test(value)&&value!==p.operatingCapacity&&value!==p.operatingIntakeThroughput&&value!==p.operatingReportBudget&&value!==p.operatingReportBudgetFinal&&value!==p.financialThroughput&&value!==p.to))assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});
test('authenticated be to two-holding successor preserves durable receiver history across two fresh advancing captures',async t=>{
 const secret='offline-capacity-supervision-handover-secret',app=createDashboard({...identity(),release:p.operatingRecovery,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)}),prior={...sample('9007199254741000',p.operatingRecovery,T-120000),financialEpoch:v3Epoch()};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(prior.financialEpoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:prior.financialEpoch.priorEpoch.activatedAt,equityUsd:prior.financialEpoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:prior.financialEpoch.activatedAt,equityUsd:prior.financialEpoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};assert.equal((await post('/api/equity-history',durable)).status,200);const before=app.cache.read(),history=app.cache.equityHistory(),first=capacitySourceSnapshot('9007199254741001',T-1000),second=capacitySourceSnapshot('9007199254741002',T),captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingRecovery);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){assert.equal((await post('/api/snapshot',next)).status,200);const body=await(await fetch(base+'/api/snapshot')).json();captures.push(body);assert.equal(body.snapshot.source.release,p.operatingCapacity);assert.equal(body.snapshot.intelligence.run.configurationSha256,capacityConfiguration);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.maximumPositions,2);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.historicalMaximumPositions,null);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission,false);assert.equal(body.snapshot.status.entries,'paused');assert.deepEqual(body.snapshot.account,prior.account);assert.deepEqual(body.snapshot.times,next.times);assert.deepEqual(body.snapshot.financialEpoch,prior.financialEpoch);assert.equal(body.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(body.equityHistory.points.find(value=>value.at===point.at),point);}
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingRecovery}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);const after=app.cache.equityHistory();assert.deepEqual(after.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

// The approved capacity source is a retained code anchor; actual native skips it.
function throughputSourceSnapshot(sequence,at){
 const state={positions:{},pending:{}},raw={accountId:p.accountId,inceptionAt:Date.parse(p.inceptionAt),runId:'offline-final-throughput-source',startedAt:T-60000,generatedAt:at,source:{commit:p.operatingIntakeThroughput,sha256:'d'.repeat(64)},configurationSha256:capacityConfiguration,strategyVersion:p.strategy,persistent:true,...state,entriesEnabled:false,usage:{market:{}},operatingCapacity:{policy:PAPER_TWO_HOLDING_OPERATING_POLICY,...paperEntryCapacity(state,null,PAPER_TWO_HOLDING_OPERATING_POLICY)},marketAdmissionAgePolicy:MIGRATION_AGE_POLICY,operatingSupervision:null};
 return {...sample(sequence,p.operatingIntakeThroughput,at),financialEpoch:v3Epoch(),intelligence:projectOperatingIntelligence(raw)};
}
test('actual installed be advances directly to exact throughput successor while every historical route and financial predicate remains protected',()=>{
 assert.equal(p.operatingRecovery,'be509874f060ef5ac9b3be5bd1cdc08d0e176613');assert.equal(p.operatingCapacity,'427c5a9f8fb8ae81f6793a1581502a71beaaa1d9');assert.equal(p.operatingIntakeThroughput,'0b63766f30cdf9932fb60a6af779e63a68400f1b');assert.notEqual(p.operatingIntakeThroughput,p.operatingRecovery);
 const c=new SnapshotCache({...identity(),release:p.operatingRecovery});assert.equal(attachReviewedSourceHandover(c),true);const prior={...sample('9007199254741000',p.operatingRecovery,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);},s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},s=>{s.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission=true;},s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=86400000;}]){
  const bad=throughputSourceSnapshot('9007199254741001',T-1000);mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.operatingRecovery);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next=throughputSourceSnapshot('9007199254741001',T-1000),saved=structuredClone(next);assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.equal(c.identity.release,p.operatingIntakeThroughput);assert.equal(next.intelligence.run.configurationSha256,capacityConfiguration);
 const policy=next.intelligence.financialPolicy;assert.equal(policy.operatingCapacity.maximumPositions,2);assert.equal(policy.operatingCapacity.historicalMaximumPositions,null);assert.equal(policy.operatingCapacity.occupiedPositions,0);assert.equal(policy.operatingCapacity.grantsFinancialPermission,false);assert.equal(policy.marketAdmissionAge.minimumAgeMs,60000);assert.equal(policy.marketAdmissionAge.maximumAgeMs,86400000);assert.equal(next.intelligence.operatingSupervision,null);assert.equal(next.status.entries,'paused');
 assert.deepEqual(next.account,prior.account);assert.deepEqual(next.balances,prior.balances);assert.deepEqual(next.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of Object.values(p).filter(value=>/^[a-f0-9]{40}$/.test(value)&&value!==p.operatingIntakeThroughput&&value!==p.operatingReportBudget&&value!==p.operatingReportBudgetFinal&&value!==p.financialThroughput&&value!==p.to))assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});
test('authenticated direct be to throughput successor retains two advancing original-clock captures, effective two-holding policy and durable history',async t=>{
 const secret='offline-capacity-supervision-handover-secret',app=createDashboard({...identity(),release:p.operatingRecovery,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)}),prior={...sample('9007199254741000',p.operatingRecovery,T-120000),financialEpoch:v3Epoch()};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(prior.financialEpoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:prior.financialEpoch.priorEpoch.activatedAt,equityUsd:prior.financialEpoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:prior.financialEpoch.activatedAt,equityUsd:prior.financialEpoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};assert.equal((await post('/api/equity-history',durable)).status,200);const before=app.cache.read(),history=app.cache.equityHistory(),first=throughputSourceSnapshot('9007199254741001',T-1000),second=throughputSourceSnapshot('9007199254741002',T),captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingRecovery);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){assert.equal((await post('/api/snapshot',next)).status,200);const body=await(await fetch(base+'/api/snapshot')).json();captures.push(body);assert.equal(body.snapshot.source.release,p.operatingIntakeThroughput);assert.equal(body.snapshot.intelligence.run.configurationSha256,capacityConfiguration);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.maximumPositions,2);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.historicalMaximumPositions,null);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission,false);assert.equal(body.snapshot.status.entries,'paused');assert.deepEqual(body.snapshot.account,prior.account);assert.deepEqual(body.snapshot.times,next.times);assert.deepEqual(body.snapshot.financialEpoch,prior.financialEpoch);assert.equal(body.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(body.equityHistory.points.find(value=>value.at===point.at),point);}
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingRecovery}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);const after=app.cache.equityHistory();assert.deepEqual(after.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

// Only reporting compatibility is asserted here; native producer budgeting is tested in the immutable source gate.
function budgetSourceSnapshot(sequence,at){
 const next=throughputSourceSnapshot(sequence,at);
 next.source.release=p.operatingReportBudget;next.intelligence.run.id='offline-current-producer-budget-repair';
 return next;
}
test('actual installed0b advances directly to exact producer-budget repair with every financial and source predicate protected',()=>{
 assert.equal(p.operatingRecovery,'be509874f060ef5ac9b3be5bd1cdc08d0e176613');assert.equal(p.operatingCapacity,'427c5a9f8fb8ae81f6793a1581502a71beaaa1d9');assert.equal(p.operatingIntakeThroughput,'0b63766f30cdf9932fb60a6af779e63a68400f1b');assert.equal(p.operatingReportBudget,'370f8c42609a04d8977fb1a98b8e53d1c9b64684');assert.notEqual(p.operatingReportBudget,p.operatingIntakeThroughput);
 const c=new SnapshotCache({...identity(),release:p.operatingIntakeThroughput});assert.equal(attachReviewedSourceHandover(c),true);const prior={...sample('9007199254741000',p.operatingIntakeThroughput,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt='2026-10-27T22:07:36.212Z';},s=>{s.source.strategy='other';},s=>{s.sequence=prior.sequence;},s=>{s.sequence='9007199254740999';},s=>{delete s.financialEpoch;},s=>{s.financialEpoch=s.financialEpoch.priorEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.liveTrading=true;},s=>{s.source.release='f'.repeat(40);},s=>{s.times.generatedAt=iso(T+30001);},s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},s=>{s.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission=true;},s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=86400000;}]){
  const bad=budgetSourceSnapshot('9007199254741001',T-1000);mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.operatingIntakeThroughput);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 assert.equal(c.accept(prior,T),'duplicate');const next=budgetSourceSnapshot('9007199254741001',T-1000),saved=structuredClone(next);assert.equal(c.accept(next,T),'accepted');assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);assert.equal(c.identity.release,p.operatingReportBudget);assert.equal(next.intelligence.run.configurationSha256,capacityConfiguration);
 const policy=next.intelligence.financialPolicy;assert.equal(policy.operatingCapacity.maximumPositions,2);assert.equal(policy.operatingCapacity.historicalMaximumPositions,null);assert.equal(policy.operatingCapacity.occupiedPositions,0);assert.equal(policy.operatingCapacity.grantsFinancialPermission,false);assert.equal(policy.marketAdmissionAge.minimumAgeMs,60000);assert.equal(policy.marketAdmissionAge.maximumAgeMs,86400000);assert.equal(next.intelligence.operatingSupervision,null);assert.equal(next.status.entries,'paused');
 assert.deepEqual(next.account,prior.account);assert.deepEqual(next.balances,prior.balances);assert.deepEqual(next.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of Object.values(p).filter(value=>/^[a-f0-9]{40}$/.test(value)&&value!==p.operatingReportBudget&&value!==p.operatingReportBudgetFinal&&value!==p.financialThroughput&&value!==p.to))assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});
test('authenticated direct0b to producer-budget repair retains two advancing original-clock captures and durable financial history',async t=>{
 const secret='offline-capacity-supervision-handover-secret',app=createDashboard({...identity(),release:p.operatingIntakeThroughput,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)}),prior={...sample('9007199254741000',p.operatingIntakeThroughput,T-120000),financialEpoch:v3Epoch()};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(prior.financialEpoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:prior.financialEpoch.priorEpoch.activatedAt,equityUsd:prior.financialEpoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:prior.financialEpoch.activatedAt,equityUsd:prior.financialEpoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};assert.equal((await post('/api/equity-history',durable)).status,200);const before=app.cache.read(),history=app.cache.equityHistory(),first=budgetSourceSnapshot('9007199254741001',T-1000),second=budgetSourceSnapshot('9007199254741002',T),captures=[];
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingIntakeThroughput);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){assert.equal((await post('/api/snapshot',next)).status,200);const body=await(await fetch(base+'/api/snapshot')).json();captures.push(body);assert.equal(body.snapshot.source.release,p.operatingReportBudget);assert.equal(body.snapshot.intelligence.run.configurationSha256,capacityConfiguration);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.maximumPositions,2);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.historicalMaximumPositions,null);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission,false);assert.equal(body.snapshot.status.entries,'paused');assert.deepEqual(body.snapshot.account,prior.account);assert.deepEqual(body.snapshot.times,next.times);assert.deepEqual(body.snapshot.financialEpoch,prior.financialEpoch);assert.equal(body.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(body.equityHistory.points.find(value=>value.at===point.at),point);}
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingIntakeThroughput}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);const after=app.cache.equityHistory();assert.deepEqual(after.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

//370 is a compatible code anchor; the actual installed predecessor remains0b.
function currentBudgetSourceSnapshot(sequence,at){
 const next=budgetSourceSnapshot(sequence,at);
 next.source.release=p.operatingReportBudgetFinal;next.intelligence.run.id='offline-final-producer-budget-repair';
 return next;
}
test('authenticated actual installed0b to exact07d7 producer repair preserves original clocks, policy, account and durable history',async t=>{
 assert.equal(p.operatingIntakeThroughput,'0b63766f30cdf9932fb60a6af779e63a68400f1b');assert.equal(p.operatingReportBudget,'370f8c42609a04d8977fb1a98b8e53d1c9b64684');assert.equal(p.operatingReportBudgetFinal,'07d7dadb24963fafab340b1f9270cdcff850ab2d');
 const secret='offline-final-report-budget-handover-secret',app=createDashboard({...identity(),release:p.operatingIntakeThroughput,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)}),prior={...sample('9007199254741000',p.operatingIntakeThroughput,T-120000),financialEpoch:v3Epoch()};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(prior.financialEpoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:prior.financialEpoch.priorEpoch.activatedAt,equityUsd:prior.financialEpoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:prior.financialEpoch.activatedAt,equityUsd:prior.financialEpoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};assert.equal((await post('/api/equity-history',durable)).status,200);const before=app.cache.read(),history=app.cache.equityHistory(),first=currentBudgetSourceSnapshot('9007199254741001',T-1000),second=currentBudgetSourceSnapshot('9007199254741002',T),captures=[];
 for(const [mutate,status] of [[s=>{s.account.id='other';},400],[s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},409],[s=>{s.liveTrading=true;},400],[s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},400],[s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=86400000;},400]]){const bad=structuredClone(first);mutate(bad);assert.equal((await post('/api/snapshot',bad)).status,status);assert.equal(app.cache.identity.release,p.operatingIntakeThroughput);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);}
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingIntakeThroughput);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){assert.equal((await post('/api/snapshot',next)).status,200);const body=await(await fetch(base+'/api/snapshot')).json();captures.push(body);assert.equal(body.snapshot.source.release,p.operatingReportBudgetFinal);assert.equal(body.snapshot.intelligence.run.configurationSha256,capacityConfiguration);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.maximumPositions,2);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.historicalMaximumPositions,null);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission,false);assert.equal(body.snapshot.status.entries,'paused');assert.deepEqual(body.snapshot.account,prior.account);assert.deepEqual(body.snapshot.times,next.times);assert.deepEqual(body.snapshot.financialEpoch,prior.financialEpoch);assert.equal(body.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(body.equityHistory.points.find(value=>value.at===point.at),point);}
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingIntakeThroughput}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);const after=app.cache.equityHistory();assert.deepEqual(after.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});
test('authenticated compatible370 code anchor to exact07d7 preserves history without claiming370 installation',async t=>{
 assert.equal(p.operatingIntakeThroughput,'0b63766f30cdf9932fb60a6af779e63a68400f1b');assert.equal(p.operatingReportBudget,'370f8c42609a04d8977fb1a98b8e53d1c9b64684');assert.equal(p.operatingReportBudgetFinal,'07d7dadb24963fafab340b1f9270cdcff850ab2d');
 const secret='offline-final-report-budget-handover-secret',app=createDashboard({...identity(),release:p.operatingReportBudget,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});assert.equal(attachReviewedSourceHandover(app.cache),true);const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)}),prior={...sample('9007199254741000',p.operatingReportBudget,T-120000),financialEpoch:v3Epoch()};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(prior.financialEpoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:prior.financialEpoch.priorEpoch.activatedAt,equityUsd:prior.financialEpoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:prior.financialEpoch.activatedAt,equityUsd:prior.financialEpoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};assert.equal((await post('/api/equity-history',durable)).status,200);const before=app.cache.read(),history=app.cache.equityHistory(),first=currentBudgetSourceSnapshot('9007199254741001',T-1000),second=currentBudgetSourceSnapshot('9007199254741002',T),captures=[];
 for(const [mutate,status] of [[s=>{s.account.id='other';},400],[s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},409],[s=>{s.liveTrading=true;},400],[s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},400],[s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=86400000;},400]]){const bad=structuredClone(first);mutate(bad);assert.equal((await post('/api/snapshot',bad)).status,status);assert.equal(app.cache.identity.release,p.operatingReportBudget);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);}
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal((await post('/api/snapshot',{...first,sequence:prior.sequence})).status,409);assert.equal(app.cache.identity.release,p.operatingReportBudget);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 for(const next of [first,second]){assert.equal((await post('/api/snapshot',next)).status,200);const body=await(await fetch(base+'/api/snapshot')).json();captures.push(body);assert.equal(body.snapshot.source.release,p.operatingReportBudgetFinal);assert.equal(body.snapshot.intelligence.run.configurationSha256,capacityConfiguration);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.maximumPositions,2);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.historicalMaximumPositions,null);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission,false);assert.equal(body.snapshot.status.entries,'paused');assert.deepEqual(body.snapshot.account,prior.account);assert.deepEqual(body.snapshot.times,next.times);assert.deepEqual(body.snapshot.financialEpoch,prior.financialEpoch);assert.equal(body.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(body.equityHistory.points.find(value=>value.at===point.at),point);}
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingReportBudget}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);const after=app.cache.equityHistory();assert.deepEqual(after.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});

// Disposable reporting facts, never a financial admission or operating receipt.
function financialThroughputSourceSnapshot(sequence,at){
 const next=currentBudgetSourceSnapshot(sequence,at);
 next.source.release=p.financialThroughput;next.intelligence.run.id='offline-financial-decision-throughput';
 next.intelligence.financialPolicy.risk={version:'paper-equity-risk-v3-no-daily-stop-v1',state:'ready',reasonCode:null,asOf:iso(at),
  entry:{targetBps:500,targetConsumedCostMicroUsd:'50000000',targetConsumedCostSol:'0.500000000',unreservedCashSol:'10.000000000',cashLimitedConsumedCostSol:'0.500000000',refundableDepositsIncluded:false,executabilityClaimed:false},
  daily:{day:iso(at).slice(0,10),limitBps:null,highWaterMicroUsd:'1000000000',highWaterAt:iso(at),currentEquityMicroUsd:'1000000000',drawdownMicroUsd:'0',drawdownBps:0,remainingBeforePauseMicroUsd:null,lossPaused:false,historyCoverage:'first-complete-observation',basis:'complete-observed-executable-equity-current-usd'}};
 return next;
}
test('installed07d advances only to exact financial-throughput source with original risk, PAPER and age predicates',()=>{
 assert.equal(p.operatingReportBudgetFinal,'07d7dadb24963fafab340b1f9270cdcff850ab2d');
 assert.equal(p.financialThroughput,'965dcd9d39fc8b84d0b1026fb25b80dfce410a4a');assert.notEqual(p.financialThroughput,p.operatingReportBudgetFinal);
 const c=new SnapshotCache({...identity(),release:p.operatingReportBudgetFinal});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.operatingReportBudgetFinal,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt=iso(T);},s=>{s.source.strategy='other';},s=>{s.source.release='f'.repeat(40);},s=>{s.mode='LIVE';},s=>{s.liveTrading=true;},s=>{s.sequence=prior.sequence;},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.times.generatedAt=iso(T+30001);},s=>{s.intelligence.financialPolicy.risk.entry.targetBps=1000;},s=>{s.intelligence.financialPolicy.risk.entry.executabilityClaimed=true;},s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},s=>{s.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission=true;},s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=0;},s=>{s.intelligence.financialPolicy.marketAdmissionAge.maximumAgeMs=172800000;}]){
  const bad=financialThroughputSourceSnapshot('9007199254741001',T-1000);mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.operatingReportBudgetFinal);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 const next=financialThroughputSourceSnapshot('9007199254741001',T-1000),saved=structuredClone(next);assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.financialThroughput);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(next.account,prior.account);assert.deepEqual(next.balances,prior.balances);assert.deepEqual(next.financialEpoch,prior.financialEpoch);assert.equal(next.intelligence.financialPolicy.risk.entry.targetBps,500);assert.equal(next.intelligence.financialPolicy.risk.daily.limitBps,null);assert.equal(next.intelligence.financialPolicy.risk.daily.lossPaused,false);assert.equal(next.status.entries,'paused');
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of Object.values(p).filter(value=>/^[a-f0-9]{40}$/.test(value)&&value!==p.financialThroughput&&value!==p.to))assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});
test('authenticated07d to exact financial-throughput source preserves two advancing captures and durable financial history',async t=>{
 const secret='offline-financial-throughput-handover-secret',app=createDashboard({...identity(),release:p.operatingReportBudgetFinal,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});assert.equal(attachReviewedSourceHandover(app.cache),true);
 const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const prior={...sample('9007199254741000',p.operatingReportBudgetFinal,T-120000),financialEpoch:v3Epoch()};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(prior.financialEpoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:prior.financialEpoch.priorEpoch.activatedAt,equityUsd:prior.financialEpoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:prior.financialEpoch.activatedAt,equityUsd:prior.financialEpoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable,'Bearer wrong')).status,401);assert.equal((await post('/api/equity-history',durable)).status,200);
 const before=app.cache.read(),history=app.cache.equityHistory(),first=financialThroughputSourceSnapshot('9007199254741001',T-1000),second=financialThroughputSourceSnapshot('9007199254741002',T),captures=[];
 for(const [mutate,status]of [[s=>{s.account.id='other';},400],[s=>{s.source.strategy='other';},400],[s=>{s.liveTrading=true;},400],[s=>{s.mode='LIVE';},400],[s=>{s.sequence=prior.sequence;},409],[s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},409],[s=>{s.intelligence.financialPolicy.risk.entry.targetBps=1000;},400],[s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},400],[s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=86400000;},400],[s=>{s.times.generatedAt=iso(Date.now()+60000);},400]]){
  const bad=structuredClone(first);mutate(bad);assert.equal((await post('/api/snapshot',bad)).status,status,mutate.toString());assert.equal(app.cache.identity.release,p.operatingReportBudgetFinal);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 }
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal(app.cache.identity.release,p.operatingReportBudgetFinal);assert.deepEqual(app.cache.read(),before);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const body=await(await fetch(base+'/api/snapshot')).json();captures.push(body);assert.equal(body.snapshot.source.release,p.financialThroughput);assert.deepEqual(body.snapshot,next);assert.equal(body.snapshot.intelligence.run.configurationSha256,capacityConfiguration);assert.equal(body.snapshot.intelligence.financialPolicy.risk.entry.targetBps,500);assert.equal(body.snapshot.intelligence.financialPolicy.risk.daily.limitBps,null);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.maximumPositions,2);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission,false);assert.equal(body.snapshot.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs,60000);assert.equal(body.snapshot.intelligence.financialPolicy.marketAdmissionAge.maximumAgeMs,86400000);assert.deepEqual(body.snapshot.financialEpoch,prior.financialEpoch);assert.equal(body.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(body.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.operatingReportBudgetFinal}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);const after=app.cache.equityHistory();assert.deepEqual(after.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});
test('forward financial-throughput reports retain source clocks and stay stale when delivery is delayed',()=>{
 const c=new SnapshotCache({...identity(),release:p.operatingReportBudgetFinal});assert.equal(attachReviewedSourceHandover(c),true);const prior={...sample('9007199254741000',p.operatingReportBudgetFinal,T-2000),financialEpoch:v3Epoch()};c.accept(prior,T);
 const next=financialThroughputSourceSnapshot('9007199254741001',T-1000),late=T+91000;assert.equal(c.accept(next,late),'accepted');assert.deepEqual(c.read().snapshot.times,next.times);assert.equal(c.read().receivedAt,iso(late));assert.equal(c.status(late).state,'stale');assert.equal(c.status(late).sourceAgeMs,92000);
 const before=c.read();assert.equal(c.accept(next,late+10000),'duplicate');assert.deepEqual(c.read(),before);assert.equal(c.status(late+10000).state,'stale');assert.equal(c.status(late+10000).sourceAgeMs,102000);
});

// Offline source-transition fixtures; no admission or live-operation claim.
function financialContinuationSourceSnapshot(sequence,at){
 const next=financialThroughputSourceSnapshot(sequence,at);next.source.release=p.to;next.intelligence.run.id='offline-financial-decision-continuation';return next;
}
test('installed965 advances only to exact financial-continuation source with original risk, PAPER and age predicates',()=>{
 assert.equal(p.financialThroughput,'965dcd9d39fc8b84d0b1026fb25b80dfce410a4a');
 assert.equal(p.to,'569cc2dfb6d2f6d15af48bfe3304a0607a355787');assert.notEqual(p.to,p.financialThroughput);
 const c=new SnapshotCache({...identity(),release:p.financialThroughput});assert.equal(attachReviewedSourceHandover(c),true);
 const prior={...sample('9007199254741000',p.financialThroughput,T-120000),financialEpoch:v3Epoch()};c.accept(prior,T);const before=c.read(),history=c.equityHistory();
 for(const mutate of [s=>{s.account.id='other';},s=>{s.account.inceptionAt=iso(T);},s=>{s.source.strategy='other';},s=>{s.source.release='f'.repeat(40);},s=>{s.mode='LIVE';},s=>{s.liveTrading=true;},s=>{s.sequence=prior.sequence;},s=>{delete s.financialEpoch;},s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},s=>{s.times.generatedAt=iso(T+30001);},s=>{s.intelligence.financialPolicy.risk.entry.targetBps=1000;},s=>{s.intelligence.financialPolicy.risk.entry.executabilityClaimed=true;},s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},s=>{s.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission=true;},s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=0;},s=>{s.intelligence.financialPolicy.marketAdmissionAge.maximumAgeMs=172800000;}]){
  const bad=financialContinuationSourceSnapshot('9007199254741001',T-1000);mutate(bad);assert.throws(()=>c.accept(bad,T));assert.equal(c.identity.release,p.financialThroughput);assert.deepEqual(c.read(),before);assert.deepEqual(c.equityHistory(),history);
 }
 const next=financialContinuationSourceSnapshot('9007199254741001',T-1000),saved=structuredClone(next);assert.equal(c.accept(next,T),'accepted');assert.equal(c.identity.release,p.to);assert.deepEqual(c.read().snapshot,saved);assert.deepEqual(next,saved);
 assert.deepEqual(next.account,prior.account);assert.deepEqual(next.balances,prior.balances);assert.deepEqual(next.financialEpoch,prior.financialEpoch);assert.equal(next.intelligence.financialPolicy.risk.entry.targetBps,500);assert.equal(next.intelligence.financialPolicy.risk.daily.limitBps,null);assert.equal(next.intelligence.financialPolicy.risk.daily.lossPaused,false);assert.equal(next.status.entries,'paused');
 for(const point of history.points)assert.deepEqual(c.equityHistory().points.find(value=>value.at===point.at),point);
 for(const release of Object.values(p).filter(value=>/^[a-f0-9]{40}$/.test(value)&&value!==p.to))assert.throws(()=>c.accept({...next,sequence:'9007199254741002',source:{...next.source,release}},T),/source version/);
});
test('authenticated965 to exact financial-continuation source preserves two advancing captures and durable financial history',async t=>{
 const secret='offline-financial-throughput-handover-secret',app=createDashboard({...identity(),release:p.financialThroughput,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});assert.equal(attachReviewedSourceHandover(app.cache),true);
 const restored=restoreRenderReceiverHistory(app.cache);assert.equal(restored.captureCount,2);assert.equal(restored.currentSnapshotCreated,false);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
 const base='http://127.0.0.1:'+app.server.address().port,post=(path,value,authorization='Bearer '+secret)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});
 const prior={...sample('9007199254741000',p.financialThroughput,T-120000),financialEpoch:v3Epoch()};assert.equal((await post('/api/snapshot',prior)).status,200);
 const durable={schemaVersion:1,accountId:p.accountId,inceptionAt:p.inceptionAt,source:'original-ec2-verified-equity',lastSequence:prior.sequence,downsampled:false,financialEpoch:structuredClone(prior.financialEpoch),points:[{at:p.inceptionAt,equityUsd:1000,segment:0,kind:'inception'},{at:prior.financialEpoch.priorEpoch.activatedAt,equityUsd:prior.financialEpoch.priorEpoch.initialUsd,segment:1,kind:'epoch-start'},{at:prior.financialEpoch.activatedAt,equityUsd:prior.financialEpoch.initialUsd,segment:2,kind:'epoch-start'},{at:prior.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}]};
 assert.equal((await post('/api/equity-history',durable,'Bearer wrong')).status,401);assert.equal((await post('/api/equity-history',durable)).status,200);
 const before=app.cache.read(),history=app.cache.equityHistory(),first=financialContinuationSourceSnapshot('9007199254741001',T-1000),second=financialContinuationSourceSnapshot('9007199254741002',T),captures=[];
 for(const [mutate,status]of [[s=>{s.account.id='other';},400],[s=>{s.source.strategy='other';},400],[s=>{s.liveTrading=true;},400],[s=>{s.mode='LIVE';},400],[s=>{s.sequence=prior.sequence;},409],[s=>{s.financialEpoch.priorEpoch.backupSha256='e'.repeat(64);},409],[s=>{s.intelligence.financialPolicy.risk.entry.targetBps=1000;},400],[s=>{s.intelligence.financialPolicy.operatingCapacity.maximumPositions=3;},400],[s=>{s.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs=86400000;},400],[s=>{s.times.generatedAt=iso(Date.now()+60000);},400]]){
  const bad=structuredClone(first);mutate(bad);assert.equal((await post('/api/snapshot',bad)).status,status,mutate.toString());assert.equal(app.cache.identity.release,p.financialThroughput);assert.deepEqual(app.cache.read(),before);assert.deepEqual(app.cache.equityHistory(),history);
 }
 assert.equal((await post('/api/snapshot',first,'Bearer wrong')).status,401);assert.equal(app.cache.identity.release,p.financialThroughput);assert.deepEqual(app.cache.read(),before);
 for(const next of [first,second]){
  assert.equal((await post('/api/snapshot',next)).status,200);const body=await(await fetch(base+'/api/snapshot')).json();captures.push(body);assert.equal(body.snapshot.source.release,p.to);assert.deepEqual(body.snapshot,next);assert.equal(body.snapshot.intelligence.run.configurationSha256,capacityConfiguration);assert.equal(body.snapshot.intelligence.financialPolicy.risk.entry.targetBps,500);assert.equal(body.snapshot.intelligence.financialPolicy.risk.daily.limitBps,null);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.maximumPositions,2);assert.equal(body.snapshot.intelligence.financialPolicy.operatingCapacity.grantsFinancialPermission,false);assert.equal(body.snapshot.intelligence.financialPolicy.marketAdmissionAge.minimumAgeMs,60000);assert.equal(body.snapshot.intelligence.financialPolicy.marketAdmissionAge.maximumAgeMs,86400000);assert.deepEqual(body.snapshot.financialEpoch,prior.financialEpoch);assert.equal(body.equityHistory.retention,'durable-with-preserved-receiver');for(const point of history.points)assert.deepEqual(body.equityHistory.points.find(value=>value.at===point.at),point);
 }
 assert.ok(BigInt(captures[1].snapshot.sequence)>BigInt(captures[0].snapshot.sequence));assert.ok(Date.parse(captures[1].snapshot.times.generatedAt)>Date.parse(captures[0].snapshot.times.generatedAt));assert.notEqual(captures[0].fingerprint,captures[1].fingerprint);
 assert.equal((await post('/api/snapshot',{...second,sequence:'9007199254741003',source:{...second.source,release:p.financialThroughput}})).status,400);
 const continued={...durable,lastSequence:second.sequence,points:[...durable.points,...[first,second].map(s=>({at:s.times.generatedAt,equityUsd:1000,segment:3,kind:'observed'}))]};assert.equal((await post('/api/equity-history',continued)).status,200);const after=app.cache.equityHistory();assert.deepEqual(after.financialEpoch,prior.financialEpoch);for(const point of history.points)assert.deepEqual(after.points.find(value=>value.at===point.at),point);assert.equal(after.points.at(-1).at,second.times.generatedAt);
});
test('forward financial-continuation reports retain source clocks and stay stale when delivery is delayed',()=>{
 const c=new SnapshotCache({...identity(),release:p.financialThroughput});assert.equal(attachReviewedSourceHandover(c),true);const prior={...sample('9007199254741000',p.financialThroughput,T-2000),financialEpoch:v3Epoch()};c.accept(prior,T);
 const next=financialContinuationSourceSnapshot('9007199254741001',T-1000),late=T+91000;assert.equal(c.accept(next,late),'accepted');assert.deepEqual(c.read().snapshot.times,next.times);assert.equal(c.read().receivedAt,iso(late));assert.equal(c.status(late).state,'stale');assert.equal(c.status(late).sourceAgeMs,92000);
 const before=c.read();assert.equal(c.accept(next,late+10000),'duplicate');assert.deepEqual(c.read(),before);assert.equal(c.status(late+10000).state,'stale');assert.equal(c.status(late+10000).sourceAgeMs,102000);
});
