/** OFFLINE: actual launcher admission and PilotRpc reservation/pacing gates.
 * Synthetic current certificate/holding timing; no provider or financial write. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {PilotRpc,PilotRpcUnavailable} from '../src/pilot-rpc.js';
import {NativeCandidateRunner,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {NativePaperWorkState} from '../src/native-paper-work.js';
import {pilotLowerPriorityAdmission} from '../src/pilot.js';
import {runNativePaper,nativePaperRpcConfiguration,nativePaperRequestOperationBound,nativePaperSourceWorkAdmission,nativePaperManagementReserve} from '../src/run-native-paper.js';

async function fixture(t:TestContext){
 let at=1_700_000_000_000,sourceOpen=true,scopeCurrent=true,certificateCurrent=true,remaining=4,pendingAt:number|null=null,pacingHook:(()=>void)|undefined;
 const records:Array<{kind:string;data:any}>=[],starts:Array<{method:string;at:number}>=[],root=mkdtempSync(join(tmpdir(),'poe-certified-preparation-')),prior=join(root,'prior.json');
 writeFileSync(prior,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:at-120000,starts:[at-121000],pending:[]}),{mode:0o600});
 const rpc=new PilotRpc({directory:join(root,'rpc'),runId:'offline-certified-preparation',baselinePaths:[prior],priorPhysicalSettled:true,...nativePaperRpcConfiguration(true),now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;pacingHook?.();},fetcher:(async(_url,init)=>{const q=JSON.parse(String(init?.body));starts.push({method:q.method,at});return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='getMinimumBalanceForRentExemption'?1_000_165:{context:{slot:100},value:[]}}));}),record:(kind,data)=>records.push({kind,data})});
 t.after(()=>{rpc.close();rmSync(root,{recursive:true,force:true});});
 // Spend the actual optional allowance, then two owned protective starts.
 // Both real rolling reserves still fit the four remaining workflow reads.
 const optionalStarts=nativePaperManagementReserve(rpc.usage(),true,true,4).discretionary10SecondStartAllowance!;
 for(let i=0;i<optionalStarts;i++)await rpc.call('getMinimumBalanceForRentExemption',[165,{commitment:'confirmed'}]);
 for(let i=0;i<2;i++)await rpc.callProtection('getMinimumBalanceForRentExemption',[165,{commitment:'confirmed'}],undefined,{completeBy:at+2000});
 const windowEndAt=Math.floor(at/10000)*10000,certificate={schemaVersion:1,mint:'OFFLINE-MINT',pool:'OFFLINE-POOL',dataContract:'confirmed-program-activity-v3-shadow',openedAt:windowEndAt-60000,connectionId:1,subscriptionId:1,windowStartAt:windowEndAt-60000,windowEndAt,auditAvailableAt:at,admittedAt:at,deadlineAt:windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)} as NativeAuditCertificate;
 const owner=new NativePaperWorkState();owner.set('source');
 const state={positions:{HELD:{units:'1'}},pending:{},controls:{entriesEnabled:true,stopRequested:false}};
 const engine:any={open:()=>sourceOpen,deadlineView:()=>({requiredNativeAt:null,readyCount:0}),currentAuditCertificate:(mint:string,when:number)=>certificateCurrent&&mint===certificate.mint&&when<=certificate.deadlineAt?certificate:null};
 engine.financialAdmission=(cert:NativeAuditCertificate,bound:number)=>NativeCandidateRunner.prototype.financialAdmission.call(engine,cert,bound,at);
 let lastCompleted=at;
 const lowerView=(bound=1200)=>pilotLowerPriorityAdmission({now:at,endAt:Number.MAX_SAFE_INTEGER,held:1,lastUsable:lastCompleted,nextPendingAt:pendingAt,operationBoundMs:bound});
 const scope={mint:certificate.mint,certificate:structuredClone(certificate) as NativeAuditCertificate|null,deadlineAt:certificate.deadlineAt-2650,current:()=>scopeCurrent,remainingStarts:()=>remaining};
 const holder:any={},context:any={__name:(value:unknown)=>value,holder,Date:{now:()=>at},record:(kind:string,data:unknown)=>records.push({kind,data}),runId:'OFFLINE-certified-preparation',requestSequence:0,workOwner:owner,entryToken:null,entryCertificate:null,sourceEntryPreparation:scope,requiredEntryNativeMaintenance:null,currentLedger:{state:()=>state},currentRpc:rpc,engine,candidateDiagnostic:(run:()=>unknown)=>run(),service:true,endAt:Number.MAX_SAFE_INTEGER,stopped:false,nativePaperRequestOperationBound,nativePaperManagementReserve,nativePaperSourceWorkAdmission,lowerView,sourceInformationAdmission:()=>sourceOpen,sourceAdmission:()=>nativePaperSourceWorkAdmission({informationOpen:sourceOpen,owned:true,entryWork:false,usage:rpc.usage(),persistent:true}),optionalAdmission:()=>false};
 const text=runNativePaper.toString(),begin=text.search(/const\s+requestOptions\s*=/),rest=text.slice(begin),end=rest.search(/;\s*let\s+requiredEntryNativeMaintenance/);assert.ok(begin>=0&&end>0,'actual launcher request gate is identified');
 runInNewContext(rest.slice(0,end)+';holder.requestOptions=requestOptions;',context,{timeout:1000});
 const original=structuredClone(certificate),baseline=rpc.usage(),baselinePhysical=starts.length;
 const read=(method='getMinimumBalanceForRentExemption')=>rpc.call(method,method==='getMinimumBalanceForRentExemption'?[165,{commitment:'confirmed'}]:[[],{commitment:'confirmed'}],new AbortController().signal,holder.requestOptions({},false,method));
 return {rpc,read,records,starts,certificate,original,scope,state,context,baseline,baselinePhysical,get at(){return at;},set at(value:number){at=value;},set sourceOpen(value:boolean){sourceOpen=value;},set scopeCurrent(value:boolean){scopeCurrent=value;},set certificateCurrent(value:boolean){certificateCurrent=value;},set remaining(value:number){remaining=value;},set pendingAt(value:number|null){pendingAt=value;},set lastCompleted(value:number){lastCompleted=value;},onPacing:(fn:()=>void)=>{pacingHook=fn;}};
}

for(const method of ['getMinimumBalanceForRentExemption','getMultipleAccounts'])test(`a feasible certified preparation ${method} proceeds after the optional setup allowance is spent`,async t=>{
 const f=await fixture(t),reserve=nativePaperManagementReserve(f.rpc.usage(),true,true,4);assert.equal(reserve.entryAllowed,true);assert.equal(reserve.discretionarySetupAllowed,false);
 assert.equal(reserve.discretionaryStartsLast10s,reserve.discretionary10SecondStartAllowance);
 await f.read(method);assert.equal(f.starts.length,f.baselinePhysical+1);assert.equal(f.rpc.usage().newUnits-f.baseline.newUnits,1);assert.deepEqual(f.certificate,f.original);assert.equal(f.scope.deadlineAt,f.original.deadlineAt-2650);assert.equal(f.records.some(row=>row.kind==='native-paper-request-admission-refused'),false);
});

test('prospective preparation keeps optional smoothing without an already current certificate',async t=>{
 const f=await fixture(t);f.scope.certificate=null;await assert.rejects(f.read(),PilotRpcUnavailable);assert.equal(f.starts.length,f.baselinePhysical);assert.ok(f.records.some(row=>row.kind==='native-paper-request-admission-refused'&&row.data.reason==='source-setup-budget'));
});

for(const changed of ['scope','source','certificate','generation','scope-deadline','certificate-deadline','holding-runway','pending-runway','short-reserve','owner-stop','method'] as const)test(`certified preparation still refuses ${changed}`,async t=>{
 const f=await fixture(t);
 if(changed==='scope')f.scopeCurrent=false;
 if(changed==='source')f.sourceOpen=false;
 if(changed==='certificate')f.certificateCurrent=false;
 if(changed==='generation')f.certificate.connectionId++;
 if(changed==='scope-deadline')f.scope.deadlineAt=f.at+1199;
 if(changed==='certificate-deadline'){f.at=f.certificate.deadlineAt+1;f.scope.deadlineAt=f.at+5000;f.lastCompleted=f.at;}
 if(changed==='holding-runway')f.lastCompleted=f.at-2000;
 if(changed==='pending-runway')f.pendingAt=f.at+100;
 if(changed==='short-reserve')f.remaining=9;
 if(changed==='owner-stop')f.context.stopped=true;
 await assert.rejects(f.read(changed==='method'?'getTransaction':undefined),PilotRpcUnavailable);assert.equal(f.starts.length,f.baselinePhysical,'a refused component never invokes another transport');assert.ok(f.records.some(row=>row.kind==='native-paper-request-admission-refused'));
});

test('a certified preparation scope that changes during actual provider pacing cannot spend a physical start',async t=>{
 const f=await fixture(t);let paced=false;f.onPacing(()=>{paced=true;f.scopeCurrent=false;});await assert.rejects(f.read(),PilotRpcUnavailable);assert.equal(paced,true);assert.equal(f.starts.length,f.baselinePhysical);assert.ok(f.records.some(row=>row.kind==='component-local-admission-refused'&&row.data.stage==='after-pacing'&&row.data.transportStarted===false));
});
