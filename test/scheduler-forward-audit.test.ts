/** Network-free audit fixtures. Retained real swap bytes; synthetic audit clocks. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import BN from 'bn.js';
import bs58 from 'bs58';
import {auditSchedulerForward,type ForwardAuditCapture,type ForwardAuditRpc} from '../src/scheduler-forward-audit.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
import {invokedCanonicalSolPools} from '../src/active-selection.js';
const raw=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={...invokedCanonicalSolPools(raw.transaction)[0]!,baseUnits:'1000',minSlot:raw.transaction.slot,supportedPoolEvidence:'DISPOSABLE retained actual identity; no current support claim'};
const target={startAt:Math.floor(raw.transaction.blockTime/10)*10000,endAt:Math.floor(raw.transaction.blockTime/10)*10000+60000};
const sig=(n:number)=>bs58.encode(Buffer.alloc(64,n));
function fixture(){
  let clock=target.endAt+6000,elapsed=0,calls=90,step=1000;const requests:Array<{method:string;params:any[]}>=[],records:any[]=[];
  const row={signature:raw.signature,slot:raw.transaction.slot,err:null,blockTime:raw.transaction.blockTime},old={signature:sig(211),slot:row.slot-1,err:null,blockTime:target.startAt/1000-1};
  let pages:any[][]=[[row,old]],txAnswer=(signature:string)=>{const tx=structuredClone(raw.transaction);tx.transaction.signatures[0]=signature;return tx;};
  const captured=mapConfirmedPumpSwapEvidence(raw.transaction,{...scope,signature:raw.signature,providerReceivedAt:target.startAt+3000,availableAt:target.startAt+4000});
  const capture:ForwardAuditCapture={openedAt:target.startAt-1000,observationEndedAt:target.endAt+5000,closedAt:target.endAt+5002,selectedMessages:1,duplicateSignatureHints:0,pending:0,executedEvidence:captured,enrichmentHints:{[raw.signature]:{receivedAt:target.startAt+3000,requestedAt:target.startAt+3900,availableAt:target.startAt+4000}},auditSelectedHints:[{signature:raw.signature,receivedAt:target.startAt+3000,expectedTrade:true}],auditNormalizedAvailability:[{identityKey:captured[0]!.identityKey,rpcAvailableAt:target.startAt+4000,validationCompletedAt:target.startAt+4100,duringObservation:true}],qualityGaps:[],featureRows:[{at:target.endAt+200,fullyEnriched:true,curve:{windowStartAt:target.startAt,windowEndAt:target.endAt,sufficientlyObserved:true},user:{windowStartAt:target.startAt,windowEndAt:target.endAt,sufficientlyObserved:true}}]};
  const rpc:ForwardAuditRpc={budget:{get calls(){return calls;},inFlight:0},async call<T>(method:string,params:unknown[],signal?:AbortSignal){signal?.throwIfAborted();requests.push({method,params:params as any[]});calls++;clock+=step;elapsed+=step;return (method==='getSignaturesForAddress'?pages.shift()??[]:txAnswer(String(params[0]))) as T;}};
  const options=()=>({capture,scope,rpc,record:(kind:string,data:unknown)=>records.push({kind,data}),signal:new AbortController().signal,target,now:()=>clock,monotonic:()=>elapsed});
  return {capture,row,old,rpc,requests,records,options,pages:(v:any[][])=>{pages=v;},answer:(fn:(signature:string)=>any)=>{txAnswer=fn;},step:(ms:number)=>{step=ms;},advance:(ms:number)=>{clock+=ms;elapsed+=ms;}};
}

test('exact chain interval and every observed signature use independent requests without original-response reuse',async()=>{
  const f=fixture();Object.defineProperty(f.capture,'enrichmentTransactions',{get(){throw Error('ORIGINAL_RESPONSE_REUSED');}});
  const r=await auditSchedulerForward(f.options());assert.equal(r.complete,true);assert.equal(r.calls,3);assert.equal(r.attemptedOperations.history,1);assert.equal(r.attemptedOperations.independent,1);assert.equal(r.attemptedOperations.finality,1);
  assert.equal(f.requests[0]!.params[1].limit,50);assert.equal(f.requests[1]!.params[1].commitment,'confirmed');assert.equal(f.requests[2]!.params[1].commitment,'finalized');
  assert.equal(r.chainAuditTarget.boundaryExclusionMs,0);assert.deepEqual(r.applicationAvailabilityTarget.startAt,target.startAt);assert.equal(r.receiveWindowCompleteness,'NOT_ESTABLISHED_BY_CHAIN_TIME_ALONE');assert.equal(r.applicationTargetReadiness.independentlyProvenReceiveWindowCompleteness,false);
  assert.equal(r.independentTransactions[0].events[0].originalValidationCompletedAt,target.startAt+4100);assert.ok(r.independentTransactions[0].events[0].independentAvailableAt>target.endAt);assert.equal(r.laterAuditInformationBackdated,false);
});

test('two fifty-row pages are the complete history ceiling and cursor is explicit',async()=>{
  const f=fixture(),newer=Array.from({length:50},(_,i)=>({signature:sig(i+1),slot:f.row.slot+1000-i,err:null,blockTime:target.endAt/1000+5}));f.pages([newer,[f.row,f.old]]);
  const r=await auditSchedulerForward(f.options());assert.equal(r.complete,true);assert.equal(r.historyPages.length,2);assert.equal(f.requests[1]!.params[1].before,newer.at(-1)!.signature);assert.equal(f.requests[1]!.params[1].limit,50);assert.equal(r.calls,4);
  const g=fixture();g.pages([newer,newer.map((x,i)=>({...x,signature:sig(i+51),slot:x.slot-50}))]);const incomplete=await auditSchedulerForward(g.options());assert.equal(incomplete.complete,false);assert.equal(incomplete.attemptedOperations.history,2);assert.equal(g.requests.filter(r=>r.method==='getSignaturesForAddress').length,2);assert.equal(incomplete.historyRangeCovered,false);
});

test('the exact chain boundaries include S and exclude S+60 while observed out-of-range hints are still checked',async()=>{
  const f=fixture(),tx=structuredClone(raw.transaction);tx.blockTime=target.startAt/1000;f.pages([[{...f.row,blockTime:tx.blockTime},f.old]]);f.answer(()=>tx);
  const captured=mapConfirmedPumpSwapEvidence(tx,{...scope,signature:raw.signature,providerReceivedAt:target.startAt+3000,availableAt:target.startAt+4000});f.capture.executedEvidence=captured;
  const r=await auditSchedulerForward(f.options());assert.equal(r.verifiedSwapEvents,1);assert.equal(r.complete,true);
  const end=fixture(),endTx=structuredClone(raw.transaction);endTx.blockTime=target.endAt/1000;end.pages([[{...end.row,blockTime:endTx.blockTime},end.old]]);end.answer(()=>endTx);end.capture.executedEvidence=mapConfirmedPumpSwapEvidence(endTx,{...scope,signature:raw.signature,providerReceivedAt:target.startAt+3000,availableAt:target.startAt+4000});
  const e=await auditSchedulerForward(end.options());assert.equal(e.complete,false);assert.equal(e.verifiedSwapEvents,0);assert.equal(e.independentTransactions.length,1);assert.equal(e.independentTransactions[0].inChainTarget,false);
});

test('missing event CPI remains in the compiled swap denominator and cannot pass',async()=>{
  const f=fixture(),bad=structuredClone(raw.transaction);bad.meta.innerInstructions[0].instructions.splice(5,1);f.answer(()=>bad);
  const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.ok(r.unsupported.some((x:any)=>x.reason==='FORWARD_AUDIT_COMPILED_SWAP_EVENT_COUNT_MISMATCH'));assert.equal(r.denominatorChecks[0].compiledSwapInstructions,1);assert.equal(r.denominatorChecks[0].decodedSwapEvents,0);
});

test('more than ten required independent transactions are named rather than sampled away or retried',async()=>{
  const f=fixture(),rows=Array.from({length:11},(_,i)=>({...f.row,signature:i?sig(i+80):raw.signature,slot:f.row.slot-i}));f.pages([[...rows,{...f.old,slot:f.row.slot-20}]]);
  f.answer(signature=>{const tx=structuredClone(raw.transaction),row=rows.find(r=>r.signature===signature)!;tx.transaction.signatures[0]=signature;tx.slot=row.slot;return tx;});
  const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.equal(r.attemptedOperations.independent,0);assert.equal(r.attemptedOperations.finality,0);assert.equal(r.calls,1);assert.equal(r.unretrievedSignatures.length,11);assert.equal(r.reason,'INDEPENDENT_TRANSACTION_ALLOCATION_INSUFFICIENT');
});

test('unknown chain boundary and unresolved late selected hint prevent a completeness claim',async()=>{
  const f=fixture();f.pages([[{...f.row,blockTime:null}]]);f.capture.auditSelectedHints!.push({signature:sig(199),receivedAt:target.endAt+5001,expectedTrade:true});f.capture.selectedMessages=2;f.answer(signature=>signature===raw.signature?structuredClone(raw.transaction):null);
  const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.equal(r.historyRangeCovered,false);const late=r.unresolvedSelectedHints.find((x:any)=>x.signature===sig(199));assert.equal(late.receivedAfterTargetClose,true);assert.equal(late.receivedAfterObservationClose,true);assert.equal(late.chainTargetMembership,'UNKNOWN');assert.equal(late.laterAuditDoesNotRepairOriginalWindow,true);
});

test('later finality corrections or pending finality are explicit and never become earlier observations',async()=>{
  for(const pending of [false,true]){
    const f=fixture(),original=f.rpc.call.bind(f.rpc);f.rpc.call=async<T>(m:string,p:unknown[],s?:AbortSignal)=>{if(m==='getTransaction'&&(p[1]as any).commitment==='finalized'){const tx=await original<any>(m,p,s);if(pending)return null as T;tx.slot++;return tx as T;}return original<T>(m,p,s);};
    const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.ok(r.unsupported.some((x:any)=>x.reason===(pending?'FINALITY_PENDING_NOT_A_REVERSAL':'FINALIZED_EXECUTED_CONTENT_CHANGED')));assert.equal(r.laterAuditInformationBackdated,false);
  }
});

test('elapsed, cancellation and throttle failures stop one phase without retries or new unaccounted clients',async()=>{
  const slow=fixture();slow.step(7001);const timed=await auditSchedulerForward(slow.options());assert.equal(timed.complete,false);assert.ok(timed.calls<=4);assert.equal(timed.reason,'FORWARD_AUDIT_ELAPSED_OR_ABORT_CAP');
  const cancelled=fixture(),o=cancelled.options(),c=new AbortController();c.abort();const r=await auditSchedulerForward({...o,signal:c.signal});assert.equal(r.complete,false);assert.equal(r.calls,0);
  const f=fixture();let calls=0;const rpc:ForwardAuditRpc={budget:{get calls(){return calls;},inFlight:0},async call<T>():Promise<T>{calls++;throw Error('COMPONENT_HTTP_429');}};const refused=await auditSchedulerForward({...f.options(),rpc});assert.equal(refused.calls,1);assert.equal(refused.reason,'COMPONENT_HTTP_429');assert.equal(calls,1);
});

test('two actual-shape swaps in one transaction remain two events with one independent transaction request',async()=>{
  const f=fixture(),tx=structuredClone(raw.transaction),next=tx.transaction.message.instructions.length;
  tx.transaction.message.instructions.push(structuredClone(tx.transaction.message.instructions[2]));tx.meta.innerInstructions.push({index:next,instructions:structuredClone(tx.meta.innerInstructions[0].instructions)});f.answer(()=>tx);
  f.capture.executedEvidence=mapConfirmedPumpSwapEvidence(tx,{...scope,signature:raw.signature,providerReceivedAt:target.startAt+3000,availableAt:target.startAt+4000});f.capture.auditNormalizedAvailability=f.capture.executedEvidence.map(e=>({identityKey:e.identityKey,rpcAvailableAt:e.availableAt,validationCompletedAt:e.availableAt+100,duringObservation:true}));
  const r=await auditSchedulerForward(f.options());assert.equal(r.complete,true);assert.equal(r.compiledSwapInstructions,2);assert.equal(r.verifiedSwapEvents,2);assert.equal(r.matchedOriginalEvents,2);assert.equal(r.attemptedOperations.independent,1);
});

test('an omitted known target transaction cannot be repaired by unioning the selected hints into history',async()=>{
  const f=fixture();f.pages([[f.old]]);const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.ok(r.unsupported.some((x:any)=>x.reason==='HISTORY_OMITTED_KNOWN_TRANSACTION'));assert.equal(r.verifiedSwapEvents,1);
});

test('history success disagreement and backdated full-validation metadata are explicit failures',async()=>{
  const f=fixture();f.pages([[{...f.row,err:{InstructionError:[0,'failed']}},f.old]]);const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.ok(r.unsupported.some((x:any)=>x.reason==='FORWARD_AUDIT_HISTORY_CONTEXT_MISMATCH'));
  const bad=fixture();bad.capture.auditNormalizedAvailability![0]!.validationCompletedAt=target.startAt+3999;const b=await auditSchedulerForward(bad.options());assert.equal(b.complete,false);assert.ok(b.unsupported.some((x:any)=>x.reason==='ORIGINAL_VALIDATION_AVAILABILITY_UNVERIFIED'));
});

test('no opened stream or an uncertain physical slot prevents every audit request',async()=>{
  for(const state of ['no-open','uncertain'] as const){const f=fixture();if(state==='no-open')f.capture.openedAt=null;else f.capture.physicalSlotUncertain=true;const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.equal(r.calls,0);assert.equal(f.requests.length,0);}
});

test('an unmatched history transaction with unknown actual AMM pool instruction cannot silently become zero swaps',async()=>{
  const f=fixture(),unknownSignature=sig(177),unknown=structuredClone(raw.transaction);unknown.transaction.signatures[0]=unknownSignature;unknown.slot++;unknown.transaction.message.instructions[2].data=bs58.encode(Buffer.alloc(8,251));unknown.meta.innerInstructions=[];
  f.pages([[{...f.row,signature:unknownSignature,slot:unknown.slot},f.row,f.old]]);f.answer(signature=>signature===unknownSignature?unknown:structuredClone(raw.transaction));
  const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.ok(r.unsupported.some((x:any)=>x.reason==='FORWARD_AUDIT_RELEVANT_AMM_INSTRUCTION_UNSUPPORTED'));
  assert.equal(r.calls,2);assert.equal(r.attemptedOperations.finality,0);assert.ok(r.unretrievedSignatures.includes(raw.signature));
  const check=r.relevantInstructionChecks.find((x:any)=>x.signature===unknownSignature);assert.equal(check.outerInstructionIndex,2);assert.equal(check.innerInstructionIndex,null);assert.equal(check.discriminatorHex,'fbfbfbfbfbfbfbfb');assert.equal(check.instructionName,null);
});

test('an exact packaged known non-swap pool instruction remains outside the swap denominator',async()=>{
  const require=createRequire(import.meta.url),idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl,coder=new BorshCoder(idl);
  const f=fixture(),depositSignature=sig(178),deposit=structuredClone(raw.transaction);deposit.transaction.signatures[0]=depositSignature;deposit.slot++;deposit.meta.innerInstructions=[];
  deposit.transaction.message.instructions[2].data=bs58.encode(coder.instruction.encode('deposit',{lp_token_amount_out:new BN(1),max_base_amount_in:new BN(1),max_quote_amount_in:new BN(1)}));
  f.pages([[{...f.row,signature:depositSignature,slot:deposit.slot},f.row,f.old]]);f.answer(signature=>signature===depositSignature?deposit:structuredClone(raw.transaction));
  const r=await auditSchedulerForward(f.options());assert.equal(r.complete,true);assert.equal(r.verifiedSwapEvents,1);assert.equal(r.attemptedOperations.independent,2);assert.ok(r.relevantInstructionChecks.some((x:any)=>x.signature===depositSignature&&x.instructionName==='deposit'&&x.knownNonSwap===true&&x.exactPackagedLayout));
});

test('an unmatched event or known capture quality gap stops further audit network attempts immediately',async()=>{
  const f=fixture();f.capture.executedEvidence[0]!.fingerprint='SYNTHETIC changed original fingerprint';const r=await auditSchedulerForward(f.options());assert.equal(r.complete,false);assert.equal(r.calls,2);assert.equal(r.attemptedOperations.finality,0);assert.equal(r.reason,'EXECUTED_CONTENT_CHANGED');
  const g=fixture();g.capture.qualityGaps=[{at:target.startAt+5000,reason:'SYNTHETIC source loss'}];const gap=await auditSchedulerForward(g.options());assert.equal(gap.calls,0);assert.equal(gap.reason,'ORIGINAL_CAPTURE_QUALITY_GAP');assert.equal(gap.unretrievedSignatures.length,1);
});

test('synchronous finality recording that reaches20s cannot pass before the timer callback gets a turn',async()=>{
  const f=fixture(),o=f.options();const r=await auditSchedulerForward({...o,record:(kind,data)=>{o.record(kind,data);if(kind==='forward-audit-finalized-recheck')f.advance(20000);}});assert.equal(r.calls,3);assert.equal(r.complete,false);assert.equal(r.reason,'FORWARD_AUDIT_ELAPSED_OR_ABORT_CAP');assert.ok(r.elapsedMs>=20000);
});
