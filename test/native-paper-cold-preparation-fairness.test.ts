/** OFFLINE: actual launcher preparation/fallback, real SDK/PilotMarket and retained
 * account bytes, synthetic deep membership/calendar/certificates and fake RPC. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {coordinatedNativeReplayFixture} from './helpers/coordinated-native-replay-fixture.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {NativePaperWorkState} from '../src/native-paper-work.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';
import {runNativePaper,nativePaperRemainingEntryWork,nativePaperManagementReserve,nativePaperFinancialSelection} from '../src/run-native-paper.js';
const STRATEGY='liquidity-resilient-momentum-v3.1';
async function fixture(t:TestContext){
 const f=await coordinatedNativeReplayFixture(t,true,false,{initialSingle:true,reusePreparedEntryRent:true});await f.open();
 const mint=f.retained[0]!.proof.quote.mint as string,scope=f.states.get(mint)!;
 f.at=Math.ceil((f.at+65000)/10000)*10000+6000;
 let permission:string|null=null,source=true,lower=true,pending=false,held=false,busy=false,shortStarts=0,certificate:NativeAuditCertificate;
 const certificates:NativeAuditCertificate[]=[];
 const owner:any={candidates:new Map([[mint,{identity:{baseMint:mint,pool:scope.pool},openedAt:scope.openedAt,nextAuditAt:0}]]),financialOwnerHints:new Map(),observationMember:()=>source,open:()=>source,currentAuditCertificate:()=>certificate,deadlineView:()=>({requiredNativeAt:null,discretionaryUntil:f.at+6000,readyCount:0})};
 owner.financialPreparationTargets=(...args:any[])=>NativeCandidateRunner.prototype.financialPreparationTargets.apply(owner,args as [number]);
 owner.financialAdmission=(...args:any[])=>NativeCandidateRunner.prototype.financialAdmission.apply(owner,args as [NativeAuditCertificate,number,number]);
 owner.discretionaryAdmission=(...args:any[])=>NativeCandidateRunner.prototype.discretionaryAdmission.apply(owner,args as [number,number]);
 const usage=()=>({closed:false,fatal:null,cooldownUntil:0,inFlight:busy?1:0,waitingOrOperating:busy,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:shortStarts,rolling10SecondStarts:shortStarts}});
 const holder:any={},context:any={__name:(v:unknown)=>v,holder,AbortController,currentEngine:owner,serviceGeneration:0,currentLedger:{state:()=>({...f.ledger.state(),positions:held?{OTHER_HELD:{units:'1'}}:{},pending:pending?{OTHER_PENDING:{}}:{}})},currentBridge:{ownership:()=>null},market:f.market,service:true,args:{strategy:STRATEGY},LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION:STRATEGY,Date:{now:()=>f.at},financialCapacityReason:()=>permission,sourceAdmission:()=>source,lowerView:()=>({admitted:lower,latestStartAt:f.at+6000}),nativePaperRemainingEntryWork,nativePaperManagementReserve,NATIVE_DEADLINE_POLICY,currentRpc:{usage},workOwner:new NativePaperWorkState(),sourceEntryPreparation:null,record:(kind:string,data:unknown)=>f.records.push({kind,data}),held:0,handoffCertificates:certificates,candidate:undefined,financialSelectionSnapshot:null,financialHandoff:new NativeFinancialHandoff('offline-cold-preparation',0,4)};
 const text=runNativePaper.toString(),begin=text.indexOf('const prepareEntrySupport='),end=text.indexOf('const makeFeeds=',begin);assert.ok(begin>=0&&end>begin);
 runInNewContext(text.slice(begin,end)+';holder.prepareEntrySupport=prepareEntrySupport;',context,{timeout:1000});
 const marker=text.includes('const prospectiveEntryPreparation=')?'const prospectiveEntryPreparation=':'if(!handoffCertificates.length&&service';
 const bs=text.indexOf(marker),be=text.indexOf('const reconnectUsage=',bs);assert.ok(bs>=0&&be>bs);
 const run=runInNewContext('(async()=>{for(let once=0;once<1;once++){'+text.slice(bs,be)+'}})',context,{timeout:1000});
 const refresh=()=>{const at=f.at,windowEndAt=Math.floor(at/10000)*10000;certificate={schemaVersion:1,mint,pool:scope.pool,dataContract:'confirmed-program-activity-v3-shadow',openedAt:scope.openedAt!,connectionId:1,subscriptionId:scope.subscription,windowStartAt:windowEndAt-60000,windowEndAt,auditAvailableAt:at,admittedAt:at,deadlineAt:windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)};certificates.splice(0,certificates.length,certificate);return structuredClone(certificate);};refresh();
 return {f,mint,owner,context,certificates,refresh,runFallback:run,get certificate(){return certificate;},async turn(){const at=f.at,plan=nativePaperRemainingEntryWork({at,owned:held,preparation:f.market.entryPreparationStatus(mint,at)}),admission=owner.financialAdmission(certificate,plan.prepared?plan.decisionWorkMs:1700,at);context.held=held?1:0;context.financialSelectionSnapshot=nativePaperFinancialSelection({at,candidates:[{certificate,plan,proofState:'complete',admission,preservation:{admitted:lower,latestStartAt:at+6000},capacityAllowed:true}],permissionReason:permission,provider:{available:!busy,busy,readyAt:at}});context.candidate=context.financialSelectionSnapshot.selectedMint??undefined;const calls=f.calls.length;if(context.financialSelectionSnapshot.selection==='preparation'){const target=owner.financialPreparationTargets(at).find((row:any)=>row.mint===mint);await holder.prepareEntrySupport(target);}else await run();return {physicalStarts:f.calls.length-calls,selection:context.financialSelectionSnapshot};},set permission(v:string|null){permission=v;},set source(v:boolean){source=v;},set lower(v:boolean){lower=v;},set pending(v:boolean){pending=v;},set held(v:boolean){held=v;},set busy(v:boolean){busy=v;},set shortStarts(v:number){shortStarts=v;}};
}

test('continuously retained cold certificates cannot suppress a bounded prospective stable-preparation turn',async t=>{
 const x=await fixture(t),before=JSON.stringify(x.f.ledger.state()),original=structuredClone(x.certificate),records=x.f.records.length;
 assert.equal(x.f.market.entryPreparationStatus(x.mint).ready,false);
 const starts:number[]=[];
 for(let n=0;n<8&&!x.f.market.entryPreparationStatus(x.mint).ready;n++){assert.equal(x.certificates.length,1);const r=await x.turn();if(n===0)assert.equal(r.selection.selection,'none');else assert.ok(['none','preparation'].includes(r.selection.selection),'actual partial progress may make the unchanged original sequence feasible');starts.push(r.physicalStarts);x.f.at+=100;}
 assert.equal(x.f.market.entryPreparationStatus(x.mint).ready,true,'stable support must progress even though the original cold certificate cannot fit its whole sequence');
 assert.ok(starts.length<=3&&starts.every(n=>n===1),'one bounded existing physical preparation read per source turn');
 assert.deepEqual(x.certificate,original,'prospective work never rewrites the current certificate');
 assert.equal(JSON.stringify(x.f.ledger.state()),before);assert.equal(x.f.records.slice(records).some(r=>r.kind==='rpc-market-quote'),false,'stable preparation is not a quote or trade');
 const warm=await x.turn();assert.equal(warm.physicalStarts,0);assert.equal(warm.selection.selectedMint,x.mint,'freshly feasible original financial work has priority');
});

test('a late audit can reuse renewed stable support before its SAME original certificate expires',async t=>{
 const x=await fixture(t),end=x.certificate.windowEndAt;
 // Match the observed failure shape: early support has its real ten-second
 // lifetime, then the audit becomes available5.282s into its decision bucket.
 x.f.route({...x.f.wireRpc,async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal,options?:unknown){x.f.at+=300;return x.f.wireRpc.call<T>(method,params);}});
 x.f.at=end-6600;
 for(let n=0;n<3&&!x.f.market.entryPreparationStatus(x.mint).ready;n++)await x.f.market.prepareEntryCostTurn(x.mint,new AbortController().signal,1700);
 const early=x.f.market.entryPreparationStatus(x.mint);assert.equal(early.ready,true);assert.ok(early.expiresAt!<end+5282);
 x.f.at=end+5282;const certificate=x.refresh(),ledger=JSON.stringify(x.f.ledger.state());
 const cold=nativePaperRemainingEntryWork({at:x.f.at,owned:false,preparation:x.f.market.entryPreparationStatus(x.mint)});
 assert.equal(cold.remainingSequenceMs+125,6675);assert.equal(certificate.deadlineAt-x.f.at,4717);
 const starts=x.f.calls.length;
 for(let n=0;n<4&&!x.f.market.entryPreparationStatus(x.mint).ready;n++){const turn=await x.turn();assert.equal(turn.physicalStarts,1);}
 const warm=await x.turn();assert.equal(warm.selection.selection,'ready-decision');
 assert.ok(x.f.at+1575<=certificate.deadlineAt,'the renewed actual receipt leaves the full original decision bound');
 assert.ok(x.f.calls.length-starts<=3);assert.deepEqual(x.certificate,certificate);assert.equal(JSON.stringify(x.f.ledger.state()),ledger);
 assert.ok(x.f.market.entryPreparationStatus(x.mint).expiresAt!>early.expiresAt!,'a new provider observation, not a restamped old receipt, supplies support');
 assert.equal(x.f.records.some(row=>row.kind==='trader-execution'),false);
});

test('an executable peer keeps priority over prospective support for an infeasible cold certificate',async t=>{
 const x=await fixture(t);x.context.candidate='OTHER_READY_MINT';x.context.financialSelectionSnapshot={selectedMint:'OTHER_READY_MINT',candidates:[{mint:x.mint,impossible:true},{mint:'OTHER_READY_MINT',impossible:false}],selection:'ready-decision'};
 const before=x.f.calls.length;await x.runFallback();assert.equal(x.f.calls.length,before);assert.equal(x.f.market.entryPreparationStatus(x.mint).ready,false);
});

for(const blocked of ['owner-pause','pending-order','holding-runway','source','provider-reserve']as const)test('prospective cold preparation retains '+blocked+' precedence',async t=>{
 const x=await fixture(t);if(blocked==='owner-pause')x.permission='OWNER_PAUSE';if(blocked==='pending-order')x.pending=true;if(blocked==='holding-runway'){x.held=true;x.lower=false;}if(blocked==='source')x.source=false;if(blocked==='provider-reserve')x.shortStarts=19;
 const before=x.f.calls.length;await x.turn();assert.equal(x.f.calls.length,before);assert.equal(x.f.market.entryPreparationStatus(x.mint).ready,false);
});
