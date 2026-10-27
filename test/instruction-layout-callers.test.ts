/** Network-free caller regressions on retained actual swap bytes. The audit
 * object/clocks below are disposable fixtures, never repaired forward results. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {invokedCanonicalSolSwaps} from '../src/active-selection.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
import {auditSchedulerForward,type ForwardAuditCapture,type ForwardAuditRpc} from '../src/scheduler-forward-audit.js';

const root='evidence/standing-research-20261027/01-paced-combined/';
const failedCapture=JSON.parse(readFileSync(root+'capture.json','utf8'));
const records=readFileSync(root+'observations.ndjson','utf8').trim().split('\n').map(line=>JSON.parse(line));
const retained=records.find(row=>row.kind==='confirmed-enrichment'&&row.data.hint.signature.startsWith('2CPX'))!.data;
const scope=failedCapture.scope,signature=retained.hint.signature;
const actualSwap=(tx:any)=>tx.meta.innerInstructions.find((g:any)=>g.index===1).instructions[9];

function auditFixture(transaction=retained.transaction){
  const target={startAt:Math.floor(transaction.blockTime/10)*10000,endAt:Math.floor(transaction.blockTime/10)*10000+60000};
  const providerAt=target.startAt+1000,rpcAt=target.startAt+2000,validatedAt=target.startAt+2100;
  // These synthetic availability fields exercise the audit interface only.
  const mapped=mapConfirmedPumpSwapEvidence(retained.transaction,{...scope,signature,providerReceivedAt:providerAt,availableAt:rpcAt});
  const capture:ForwardAuditCapture={openedAt:target.startAt-1000,observationEndedAt:target.endAt+5000,closedAt:target.endAt+5001,selectedMessages:1,duplicateSignatureHints:0,pending:0,qualityGaps:[],executedEvidence:mapped,auditSelectedHints:[{signature,receivedAt:providerAt,expectedTrade:true}],auditNormalizedAvailability:mapped.map(e=>({identityKey:e.identityKey,rpcAvailableAt:rpcAt,validationCompletedAt:validatedAt,duringObservation:true})),featureRows:[]};
  let calls=0,at=target.endAt+6000,elapsed=0;
  const row={signature,slot:transaction.slot,err:null,blockTime:transaction.blockTime},old={signature:bs58.encode(Buffer.alloc(64,202)),slot:transaction.slot-1,err:null,blockTime:target.startAt/1000-1};
  const rpc:ForwardAuditRpc={budget:{get calls(){return calls;},inFlight:0},async call<T>(method:string,_params:unknown[]){calls++;at+=1000;elapsed+=1000;return structuredClone(method==='getSignaturesForAddress'?[row,old]:transaction) as T;}};
  return {options:{capture,scope,rpc,record:()=>{},signal:new AbortController().signal,target,now:()=>at,monotonic:()=>elapsed},get calls(){return calls;}};
}

test('actual observed two-u64 exact-quote Buy is one genuine compiled swap in the selector denominator',()=>{
  const encoded=Buffer.from(bs58.decode(actualSwap(retained.transaction).data));assert.equal(encoded.length,24);assert.equal(encoded.subarray(0,8).toString('hex'),'c62e1552b4d9e870');
  assert.deepEqual(invokedCanonicalSolSwaps(retained.transaction),[{mint:scope.mint,pool:scope.pool}]);
  assert.equal(failedCapture.normalizedBuys,0);assert.ok(failedCapture.qualityGaps.some((g:any)=>g.reason==='confirmed-transaction-mapping-unavailable'));
});

test('synthetic audit wiring recognizes the observed layout without claiming the absent volume flag or packaged byte parity',async()=>{
  const f=auditFixture(),audit=await auditSchedulerForward(f.options);
  assert.equal(audit.complete,true);assert.equal(audit.compiledSwapInstructions,1);assert.equal(audit.verifiedSwapEvents,1);assert.equal(audit.matchedOriginalEvents,1);assert.equal(f.calls,3);
  const proof=audit.relevantInstructionChecks.find((r:any)=>r.instructionName==='buy_exact_quote_in');
  assert.equal(proof.instructionLayout,'observed-exact-quote-two-u64');assert.equal(proof.exactRecognizedLayout,true);assert.equal(proof.exactPackagedLayout,false);assert.equal(proof.trackVolumeAvailable,false);assert.equal(proof.outerInstructionIndex,1);assert.equal(proof.innerInstructionIndex,9);
  assert.equal(audit.receiveWindowCompleteness,'NOT_ESTABLISHED_BY_CHAIN_TIME_ALONE');assert.equal(audit.primaryStrategyEnabled,false);
});

test('unrecognized truncation or extra-byte layouts cannot become a supported selector swap or a zero-swap audit pass',async()=>{
  for(const length of [23,26]){
    const tx=structuredClone(retained.transaction),raw=Buffer.from(bs58.decode(actualSwap(tx).data));
    actualSwap(tx).data=bs58.encode(length<raw.length?raw.subarray(0,length):Buffer.concat([raw,Buffer.alloc(length-raw.length)]));
    assert.deepEqual(invokedCanonicalSolSwaps(tx),[]);
    const f=auditFixture(tx),audit=await auditSchedulerForward(f.options);assert.equal(audit.complete,false);assert.equal(f.calls,2);assert.equal(audit.attemptedOperations.finality,0);assert.ok(audit.unsupported.some((p:any)=>p.reason==='FORWARD_AUDIT_RELEVANT_AMM_INSTRUCTION_UNSUPPORTED'));
  }
});
