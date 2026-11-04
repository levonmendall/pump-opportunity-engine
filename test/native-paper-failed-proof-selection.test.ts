/** OFFLINE actual launcher selection and handoff branches. Synthetic current
 * certificates, the real bounded proof cache and real deadline planner; no
 * provider, ledger, order handler or host operation is opened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {runNativePaper,nativePaperCurrentQualificationProof,nativePaperHandoffCategory} from '../src/run-native-paper.js';
import {NativePaperProofPreparation} from '../src/native-paper-proof-preparation.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import type {NativeQualificationProof} from '../src/native-paper.js';

type Outcome='complete'|'failed'|'pending'|'missing';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function proofFor(c:NativeAuditCertificate,at:number):NativeQualificationProof{return {proofId:['entry',c.mint,c.windowEndAt,c.admittedAt,c.featuresSha256].join(':'),mint:c.mint,startAt:c.windowStartAt,throughAt:at,windowEndAt:c.windowEndAt,featuresSha256:c.featuresSha256,certificateAt:c.admittedAt,deadlineAt:c.deadlineAt};}

async function fixture(outcomes:Outcome[]){
 let at=100500;const events:any[]=[],qualificationReads:string[]=[],supportReads:string[]=[],preparationRequests:string[]=[],certificateReads:string[]=[],pinCalls:string[]=[],settlePending:(()=>void)[]=[];
 const certificates=outcomes.map((_,i)=>({schemaVersion:1,mint:'OFFLINE_'+String.fromCharCode(65+i),pool:'OFFLINE_POOL_'+i,dataContract:'OFFLINE',openedAt:40000,connectionId:1,subscriptionId:i+2,windowStartAt:40000,windowEndAt:100000,auditAvailableAt:100100,admittedAt:100100,deadlineAt:110000,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:String.fromCharCode(97+i).repeat(64)} as unknown as NativeAuditCertificate));
 const cache=new NativePaperProofPreparation(()=>at),originalProofs=certificates.map(c=>proofFor(c,at));
 // Existing completed/failed records can coexist with one live pending pin.
 for(const outcome of ['complete','failed','pending'] as const)for(let i=0;i<outcomes.length;i++)if(outcomes[i]===outcome){
  cache.prepare(originalProofs[i]!,async proof=>{pinCalls.push(proof.mint);if(outcome==='failed')throw Error('OFFLINE_PIN_UNAVAILABLE');if(outcome==='pending')await new Promise<void>(resolve=>settlePending.push(resolve));});await turn();
 }
 const handoff=new NativeFinancialHandoff('offline',0,4,(_,row)=>events.push(row)),priority=new Set<string>(['OFFLINE_STALE_PRIORITY']),holder:any={};
 const engine:any={open:()=>true,deadlineView:()=>({requiredNativeAt:null,readyCount:certificates.length}),currentAuditCertificate:(mint:string,when:number)=>{certificateReads.push(mint);return certificates.find(c=>c.mint===mint&&when>=c.admittedAt&&when<=c.deadlineAt)??null;}};
 engine.financialAdmission=(c:NativeAuditCertificate,bound:number,when:number)=>NativeCandidateRunner.prototype.financialAdmission.call(engine,c,bound,when);
 const context:any={__name:(value:unknown)=>value,holder,Date:{now:()=>at},financialCandidates:certificates.map(c=>c.mint),financialEvaluationCandidates:priority,currentEngine:engine,service:true,args:{strategy:'liquidity-resilient-momentum-v3.1'},LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION:'liquidity-resilient-momentum-v3.1',nativePaperCurrentQualificationProof:(bridge:any,mint:string)=>nativePaperCurrentQualificationProof(bridge,mint,()=>at),currentBridge:{qualificationProof:(mint:string)=>{qualificationReads.push(mint);const c=certificates.find(row=>row.mint===mint);return c?proofFor(c,at):null;}},nativePaperRemainingEntryWork:()=>({prepared:true,decisionWorkMs:1450,quoteOperationMs:1200}),market:{entryPreparationStatus:(mint:string)=>{supportReads.push(mint);return {ready:true};}},plannedEntryWork:null,held:0,proofPreparation:cache,prepareQualificationProof:(c:NativeAuditCertificate)=>{preparationRequests.push(c.mint);return false;},riskCapacity:()=>true,currentRpc:{usage:()=>({})},entryStartsRemaining:()=>9,lowerView:()=>({admitted:true,latestStartAt:at+10000}),financialHandoff:handoff,entryCapacityReason:()=>null,nativePaperHandoffCategory,NATIVE_DEADLINE_POLICY};
 const source=runNativePaper.toString(),begin=source.search(/const\s+handoffAt\s*=\s*Date\.now\(\)/),tail=source.slice(begin),end=tail.search(/if\s*\(candidate\s*&&\s*entryRunwayAvailable/);assert.ok(begin>=0&&end>0,'execute the actual cached-certificate selection through peer deferral');
 const code='(async()=>{for(let once=0;once<1;once++){'+tail.slice(0,end)+';holder.candidate=candidate;holder.proofReady=proofReady;holder.entryRunwayAvailable=entryRunwayAvailable;holder.certificate=handoffCertificate;}})()';
 const run=async()=>{await runInNewContext(code,context,{timeout:1000});return {...holder};};
 return {cache,certificates,originalProofs,events,priority,qualificationReads,supportReads,preparationRequests,certificateReads,pinCalls,handoff,run,get at(){return at;},set at(value:number){at=value;},async close(){for(const done of settlePending)done();await turn();}};
}

test('an exact terminal failed A cannot block complete B or overwrite its own failure attribution',async t=>{
 const f=await fixture(['failed','complete','complete']);t.after(f.close);const before=JSON.stringify(f.certificates),selected=await f.run();
 assert.equal(selected.candidate,'OFFLINE_B');assert.equal(selected.proofReady,true);assert.equal(selected.entryRunwayAvailable,true);assert.equal(selected.certificate.deadlineAt,110000);
 assert.deepEqual([...f.priority],['OFFLINE_B','OFFLINE_C']);assert.deepEqual(f.qualificationReads,['OFFLINE_B']);assert.deepEqual(f.supportReads,['OFFLINE_B']);assert.deepEqual(f.preparationRequests,[]);
 const failed=f.events.filter(row=>row.mint==='OFFLINE_A');assert.equal(failed.length,1);assert.equal(failed[0].blockingPrerequisite,'PROOF_RETENTION_UNAVAILABLE');assert.equal(failed[0].operation,'PROOF_PREPARATION');assert.equal(failed[0].requiredMs,null);assert.equal(failed[0].availableMs,9500);assert.equal(failed[0].observedAt,f.at);assert.equal(failed[0].financialPermission,false);
 assert.equal(f.events.find(row=>row.mint==='OFFLINE_C')?.blockingPrerequisite,'AWAIT_EARLIER_CANDIDATE');assert.equal(f.events.some(row=>row.mint==='OFFLINE_A'&&row.blockingPrerequisite==='AWAIT_EARLIER_CANDIDATE'),false);
 const usage=f.handoff.usage(f.at);assert.equal(usage.seen,3);assert.equal(usage.active.length,3);assert.equal(usage.economicDecisions,0);assert.equal(usage.financialEvaluations,0);assert.equal(JSON.stringify(f.certificates),before);
 f.at+=50;await f.run();assert.equal(f.events.filter(row=>row.mint==='OFFLINE_A').length,1,'unchanged failure attribution is not repeatedly emitted');assert.equal(f.cache.usage(f.originalProofs[0]!)?.state,'failed');assert.equal(f.pinCalls.length,3,'selection adds no proof pin or queue');
});

test('skipping multiple exact failures preserves the existing order of all remaining candidates',async t=>{
 const f=await fixture(['failed','failed','complete','complete']);t.after(f.close);const selected=await f.run();assert.equal(selected.candidate,'OFFLINE_C');assert.equal(selected.entryRunwayAvailable,true);assert.deepEqual([...f.priority],['OFFLINE_C','OFFLINE_D']);
 for(const mint of ['OFFLINE_A','OFFLINE_B'])assert.deepEqual(f.events.filter(row=>row.mint===mint).map(row=>row.blockingPrerequisite),['PROOF_RETENTION_UNAVAILABLE']);assert.equal(f.handoff.usage(f.at).seen,4);
});

test('all exact terminal failures retain handoff history but release impossible transient financial priority',async t=>{
 const f=await fixture(['failed','failed']);t.after(f.close);const selected=await f.run();assert.equal(selected.candidate,undefined);assert.equal(selected.entryRunwayAvailable,false);assert.deepEqual([...f.priority],[]);assert.deepEqual(f.qualificationReads,[]);assert.deepEqual(f.supportReads,[]);
 assert.equal(f.handoff.usage(f.at).seen,2);assert.equal(f.handoff.usage(f.at).active.length,2);assert.deepEqual(f.events.map(row=>row.blockingPrerequisite),['PROOF_RETENTION_UNAVAILABLE','PROOF_RETENTION_UNAVAILABLE']);
});

for(const outcome of ['pending','missing'] as const)test(`a ${outcome} first proof keeps its original rank and financial priority`,async t=>{
 const f=await fixture([outcome,'complete']);t.after(f.close);const selected=await f.run();assert.equal(selected.candidate,'OFFLINE_A');assert.equal(selected.proofReady,false);assert.equal(selected.entryRunwayAvailable,false);assert.deepEqual([...f.priority],['OFFLINE_A','OFFLINE_B']);assert.deepEqual(f.preparationRequests,['OFFLINE_A']);
 assert.equal(f.events.find(row=>row.mint==='OFFLINE_A')?.blockingPrerequisite,'PROOF_PENDING');assert.equal(f.events.find(row=>row.mint==='OFFLINE_B')?.blockingPrerequisite,'AWAIT_EARLIER_CANDIDATE');assert.equal(f.events.some(row=>row.blockingPrerequisite==='PROOF_RETENTION_UNAVAILABLE'),false);
});

test('every changed stable certificate field prevents a previous failure from excluding new evidence',async t=>{
 for(const field of ['windowStartAt','windowEndAt','featuresSha256','admittedAt','deadlineAt'] as const){
  const f=await fixture(['failed','complete']);t.after(f.close);const c=f.certificates[0]!;if(field==='featuresSha256')c.featuresSha256='f'.repeat(64);else c[field]+=1;
  const selected=await f.run();assert.equal(selected.candidate,'OFFLINE_A',field);assert.deepEqual([...f.priority],['OFFLINE_A','OFFLINE_B'],field);assert.equal(f.events.some(row=>row.mint==='OFFLINE_A'&&row.blockingPrerequisite==='PROOF_RETENTION_UNAVAILABLE'),false,field);assert.deepEqual(f.preparationRequests,['OFFLINE_A'],field);
 }
});
