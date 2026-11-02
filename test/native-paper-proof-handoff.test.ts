/** OFFLINE: exercise the launcher's actual audit callback and proof helper.
 * No provider, financial account, or filesystem proof is used here. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {NativePaperProofPreparation,nativePaperCurrentQualificationProof,runNativePaper} from '../src/run-native-paper.js';
import type {NativeAuditCertificate} from '../src/native-candidate-runner.js';
import type {NativeQualificationProof} from '../src/native-paper.js';

const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
 let at=65_000,admitted=true,risk=true,pinCalls=0,maintenance=0,resolvePin!:()=>void;
 const pinPending=new Promise<void>(resolve=>{resolvePin=resolve;}),events:any[]=[],holder:any={};
 const certificate={schemaVersion:1,mint:'OFFLINE_MINT',pool:'OFFLINE_POOL',dataContract:'OFFLINE',openedAt:1,connectionId:1,subscriptionId:2,windowStartAt:0,windowEndAt:60_000,auditAvailableAt:at,admittedAt:at,deadlineAt:69_999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)} as unknown as NativeAuditCertificate;
 let proof:NativeQualificationProof|null={proofId:'OFFLINE:proof',mint:certificate.mint,startAt:0,throughAt:at,windowEndAt:certificate.windowEndAt,featuresSha256:certificate.featuresSha256,certificateAt:certificate.admittedAt,deadlineAt:certificate.deadlineAt};
 const preparation=new NativePaperProofPreparation(()=>at),bridge:any={
  qualificationProof:()=>proof&&({...proof,throughAt:at}),
  maintainFlatFinancialReadiness:()=>{maintenance++;},
  trader:{entryReadinessSafety:()=>({idle:true}),financialMaintenanceFailed:()=>assert.fail('no financial failure expected')},
  ownership:()=>null,
 };
 const context:any={__name:(value:unknown)=>value,holder,Date:{now:()=>at},service:true,proofPreparation:preparation,
  riskCapacity:()=>risk,certifiedAdmission:(current:NativeAuditCertificate)=>admitted&&current===certificate&&at<=certificate.deadlineAt,
  nativePaperCurrentQualificationProof:(owner:any,mint:string)=>nativePaperCurrentQualificationProof(owner,mint,()=>at),currentBridge:bridge,
  serviceRecorder:{pinProvisionalRange:async(id:string,start:number,through:number,deadline:number)=>{pinCalls++;events.push({kind:'pin-start',at,id,start,through,deadline});await pinPending;return {complete:true,proofId:id,manifestSha256:'b'.repeat(64),bytes:1234};}},
  need:(condition:unknown,reason:string)=>{if(!condition)throw Error(reason);},hash:(value:string)=>value,record:(kind:string,data:any)=>events.push({kind,data}),
 };
 const source=runNativePaper.toString(),begin=source.search(/const\s+prepareQualificationProof\s*=/),rest=source.slice(begin),end=rest.search(/;\s*const\s+makeEngine\s*=/);
 assert.ok(begin>=0&&end>0,'actual proof preparation closure is identified');
 runInNewContext(rest.slice(0,end)+';holder.prepare=prepareQualificationProof;',context,{timeout:1000});
 const makeBegin=source.search(/const\s+makeEngine\s*=/),makeRest=source.slice(makeBegin),makeEnd=makeRest.search(/;\s*try\s*\{\s*engine\s*=/);
 assert.ok(makeBegin>=0&&makeEnd>0,'actual constructor callback is identified');
 Object.assign(context,{prepareQualificationProof:holder.prepare,
  NativeCandidateRunner:class{currentPoolObservation=true;constructor(options:any){holder.auditAvailable=options.onAuditAvailable;}importOrigin(){}syncFinancialOwnership(){}},
  args:{strategy:'liquidity-resilient-momentum-v3.1'},LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION:'liquidity-resilient-momentum-v3.1',
  marketIntake:null,sharedMarketRegistry:{},runId:'OFFLINE',scheduled:{},native:{},isVersionedNativeStrategy:()=>true,isLiquidityResilientNativeStrategy:()=>true,
  deep:4,PERSISTENT_OBSERVABLE_MARKET_POLICY:{version:'OFFLINE'},input:{origins:[],watchCheckpoint:null},sourceAdmission:()=>true,lowerView:()=>({admitted:true}),
  sourceWork:{checkpoint(){}},registryIsolation:undefined,financialSourceCallback:(operation:()=>unknown)=>operation(),workOwner:{current:'source'},
  currentRpc:{usage:()=>({inFlight:0,waitingOrOperating:false})},price:null,manualPaused:false,safeStopRequested:false,
 });
 runInNewContext(makeRest.slice(0,makeEnd)+';makeEngine(null);',context,{timeout:1000});
 return {certificate,preparation,events,prepare:holder.prepare as (certificate:NativeAuditCertificate,eager?:boolean)=>boolean,auditAvailable:holder.auditAvailable as (certificate:NativeAuditCertificate)=>void,
  resolvePin,get pinCalls(){return pinCalls;},get maintenance(){return maintenance;},get proof(){return proof;},set proof(value:NativeQualificationProof|null){proof=value;},
  get at(){return at;},set at(value:number){at=value;},set admitted(value:boolean){admitted=value;},set risk(value:boolean){risk=value;},context};
}

test('completed audit starts the one proof task before returning to main-loop work, and ranked dispatch reuses it',async()=>{
 const f=fixture();f.auditAvailable(f.certificate);assert.equal(f.maintenance,1);assert.equal(f.preparation.usage()?.state,'pending');assert.equal(f.pinCalls,0,'filesystem work starts asynchronously');
 await turn();assert.equal(f.pinCalls,1);const first=f.events.find(row=>row.kind==='pin-start');assert.equal(first.through,65_000);assert.equal(first.deadline,69_999);
 f.at=66_000;assert.equal(f.prepare(f.certificate),false);assert.equal(f.pinCalls,1,'main loop must not enqueue a second pin for the same certificate');
 f.resolvePin();await turn();assert.equal(f.preparation.ready(f.proof!),true);assert.equal(f.prepare(f.certificate),true);assert.equal(f.pinCalls,1);
 const pin=f.events.find(row=>row.kind==='native-paper-entry-proof-pinned');assert.equal(pin.data.bytes,1234);assert.equal(pin.data.elapsedMs,1000);assert.equal(pin.data.certificateAt,65_000);
 f.at=70_000;assert.equal(f.preparation.ready(f.proof!),false,'the original deadline remains authoritative after retention');
});

test('eager peer audits cannot replace a pending or completed still-current proof',async()=>{
 const f=fixture();f.auditAvailable(f.certificate);await turn();const original=f.proof!,peer={...f.certificate,mint:'OFFLINE_PEER'};
 f.proof={...original,proofId:'OFFLINE:peer',mint:peer.mint};assert.equal(f.prepare(peer,true),false);assert.equal(f.pinCalls,1);assert.equal(f.preparation.usage()?.proofId,original.proofId);
 f.resolvePin();await turn();assert.equal(f.prepare(peer,true),false);assert.equal(f.preparation.usage()?.proofId,original.proofId);assert.equal(f.pinCalls,1);
});

for(const reason of ['source-refused','risk-refused','no-qualifying-proof','different-mint','different-window','different-hash','different-certificate','different-deadline','expired']as const)test(`early proof work stays refused for ${reason}`,async()=>{
 const f=fixture();
 if(reason==='source-refused')f.admitted=false;else if(reason==='risk-refused')f.risk=false;else if(reason==='no-qualifying-proof')f.proof=null;
 else if(reason==='different-mint')f.proof={...f.proof!,mint:'OFFLINE_WRONG_MINT'};
 else if(reason==='different-window')f.proof={...f.proof!,windowEndAt:f.proof!.windowEndAt+1};
 else if(reason==='different-hash')f.proof={...f.proof!,featuresSha256:'c'.repeat(64)};
 else if(reason==='different-certificate')f.proof={...f.proof!,certificateAt:f.proof!.certificateAt+1};
 else if(reason==='different-deadline')f.proof={...f.proof!,deadlineAt:f.proof!.deadlineAt+1};
 else f.at=f.certificate.deadlineAt+1;
 f.auditAvailable(f.certificate);await turn();assert.equal(f.pinCalls,0);assert.equal(f.preparation.usage(),null);
});
