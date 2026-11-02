/** Offline forward mechanics using the exact recovered public packet.
 * These simulated arrival/lookup times are never historical trading evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {PublicKey} from '@solana/web3.js';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import {CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW} from '../src/program-log-mapping.js';
import {NATIVE_CLEANUP_PROOF_POLICY} from '../src/pilot-native-flow.js';
import {setup,settle,coder,scope as peerScope} from './native-flow-fixture.js';

const directory='evidence/protocol-empty-boost-vault-20261102',tx=JSON.parse(readFileSync(directory+'/transaction-response.json','utf8')).result;
const original=JSON.parse(readFileSync(directory+'/provenance.json','utf8')).originalRefusal;
const selected={mint:'CmEk1uNV3uF2mVUSp12Mstm3r7srvD7AjhdG5a1Xpump',pool:'7fwtyQKJQQL1W2F27hqk3v6S9s2wtqsDjDv9svxNPgSh',minSlot:tx.slot};
type Config=Parameters<typeof setup>[0];
async function fixture(config:Config={}){
 const effects:any[]=[],f=setup({persistent:true,dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,at:original.receivedAt,slot:tx.slot,baseTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),maximumCandidates:2,cleanupRead:async()=>structuredClone(tx),onProtocolEffect:row=>effects.push(row),...config});
 const socket=await f.open(selected);
 const notice=(value:{signature?:string;logs?:string[];err?:unknown}={})=>socket.frame({jsonrpc:'2.0',method:'logsNotification',params:{subscription:f.flow.snapshot(selected.mint)!.subscription,result:{context:{slot:tx.slot},value:{signature:value.signature??original.signature,err:value.err??null,logs:value.logs??structuredClone(tx.meta.logMessages)}}}});
 return {...f,socket,notice,effects,base:f};
}

test('ordinary exact cleanup stays unqualified until one scheduled compiled proof becomes available',async()=>{
 let f:Awaited<ReturnType<typeof fixture>>;
 f=await fixture({cleanupRead:async(method,params,_signal,admission)=>{
  assert.equal(method,'getTransaction');assert.deepEqual(params,[original.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
  assert.equal(admission.timeoutMs,1000);assert.equal(admission.operationBoundMs,1500);assert.equal(admission.latestStartAt,original.receivedAt+3500);
  await f.base.advance(80);return structuredClone(tx);
 }});
 assert.equal(f.flow.snapshot(selected.mint)!.completeRequiredEventFields,true);
 const generation=f.flow.captureState(selected.mint)!;f.notice();
 assert.equal(f.cleanupCalls.length,0,'receipt callback never starts HTTP');assert.equal(f.flow.usage().cleanupProof.pending,1);
 assert.equal(f.flow.snapshot(selected.mint)!.completeRequiredEventFields,false);assert.equal(f.flow.snapshot(selected.mint)!.warm,false);
 assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,false);assert.equal(f.effects.length,0);
 const pending=f.records.find(r=>r.kind==='native-flow-cleanup-proof-pending')!;assert.equal('logs' in pending.data,false);assert.equal(pending.data.financialPermission,false);
 assert.equal(f.flow.servicePlan().action,'cleanup-proof');assert.equal(f.flow.servicePlan().deadlineAt,original.receivedAt+5000);
 assert.equal((await f.flow.service()).kind,'cleanup-proof');assert.equal(f.cleanupCalls.length,1);assert.equal(f.effects.length,1);assert.equal(f.trades.length,0);
 assert.equal(f.effects[0].effect.compiledCleanup.rawNotificationSha256,original.rawHash);
 assert.equal(f.effects[0].effect.receivedAt,original.receivedAt);assert.equal(f.effects[0].availableAt,original.receivedAt+80);
 assert.equal(f.flow.usage().perTransactionEnrichmentRequests,1);assert.equal(f.flow.usage().cleanupProof.physicalStarts,1);assert.equal(f.flow.usage().cleanupProof.pending,0);
 assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,false);assert.equal(f.flow.snapshot(selected.mint)!.completeRequiredEventFields,true);
 assert.equal(f.flow.captureState(selected.mint)!.openedAt,generation.openedAt);assert.equal(f.flow.captureState(selected.mint)!.subscription,generation.subscription);
 const proof=f.records.find(r=>r.kind==='native-flow-cleanup-proof-transaction')!;assert.deepEqual(proof.data.transaction,tx);assert.equal(proof.data.notBackdated,true);
 assert.ok(f.records.indexOf(proof)<f.records.findIndex(r=>r.kind==='native-flow-information-available'));
 assert.equal(f.records.filter(r=>r.kind==='native-flow-raw-representative'||r.kind==='native-flow-raw-refusal').length,0);
 assert.equal(f.records.filter(r=>r.kind==='native-flow-cleanup-proof-request-completed'||r.kind==='native-flow-cleanup-proof-request-settled').length,0,'shared RPC accounting needs no synchronous post-admission duplicate');
 await f.flow.service();assert.equal(f.cleanupCalls.length,1);await f.flow.stop();
});

test('an already warm view becomes unavailable during proof without replacing its capture generation',async()=>{
 const f=await fixture({at:original.receivedAt-70000});
 for(let i=0;i<14;i++){await f.base.advance(5000);await f.drive(3);}
 assert.equal(f.flow.snapshot(selected.mint)!.warm,true);const openedAt=f.flow.captureState(selected.mint)!.openedAt;
 f.notice();assert.equal(f.flow.snapshot(selected.mint)!.warm,false);assert.equal(f.flow.snapshot(selected.mint)!.completeRequiredEventFields,false);
 assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,false);assert.equal(f.flow.captureState(selected.mint)!.openedAt,openedAt);
 await f.flow.service();assert.equal(f.flow.snapshot(selected.mint)!.warm,true);assert.equal(f.flow.captureState(selected.mint)!.openedAt,openedAt);await f.flow.stop();
});

for(const mode of ['unavailable','null','wrong-close','wrong-logs','wrong-version','wrong-signature','wrong-slot'] as const){
 test('one '+mode+' cleanup proof fails closed and retains the original refused notification',async()=>{
  const response=structuredClone(tx);
  if(mode==='wrong-close')response.meta.innerInstructions.find((g:any)=>g.index===2).instructions[4].accounts[2]=0;
  if(mode==='wrong-logs')response.meta.logMessages[0]+=' different';
  if(mode==='wrong-version')response.version=2;
  if(mode==='wrong-signature')response.transaction.signatures[0]=bs58.encode(Buffer.alloc(64,93));
  if(mode==='wrong-slot')response.slot++;
  const f=await fixture({cleanupRead:async()=>{if(mode==='unavailable')throw Error('PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT');return mode==='null'?null:response;}});
  f.notice();assert.equal((await f.flow.service()).kind,'unavailable');assert.equal(f.cleanupCalls.length,1);assert.equal(f.effects.length,0);
  assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);assert.equal(f.flow.snapshot(selected.mint)!.warm,false);
  assert.equal(f.flow.usage().cleanupProof.failed,1);assert.equal(f.flow.usage().cleanupProof.physicalStarts,1);assert.equal(f.flow.usage().supportRecovery.deferredRefreshFailures,0);
  assert.equal(f.flow.usage().transportIntegrityGaps,0);assert.equal(f.flow.usage().connected,true,'candidate proof failure does not terminate the shared capture transport');
  const refused=f.records.find(r=>r.kind==='native-flow-raw-refusal')!;assert.equal(refused.data.signature,original.signature);assert.deepEqual(refused.data.logs,tx.meta.logMessages);
  await f.drive(3);assert.equal(f.cleanupCalls.length,1,'no automatic or service-loop retry');await f.flow.stop();
 });
}

test('original receipt expiry cancels pending proof while physical ownership lasts until settlement',async()=>{
 let finish!:(value:unknown)=>void,requestSignal:AbortSignal|undefined;
 const f=await fixture({cleanupRead:async(_method,_params,signal)=>{requestSignal=signal;return new Promise(resolve=>{finish=resolve;});}});
 f.notice();const running=f.flow.service();await settle();assert.equal(f.base.active,1);assert.equal(f.flow.usage().sharedOperationActive,true);assert.equal(f.flow.usage().perTransactionEnrichmentRequests,1);assert.equal(f.flow.usage().cleanupProof.completedCallPhysicalStarts,0);
 await f.base.advance(5100);assert.equal(requestSignal?.aborted,true);assert.equal(f.flow.usage().cleanupProof.pending,0);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);
 assert.equal(f.base.active,1,'expiry does not invent physical settlement');assert.equal((await f.flow.service()).kind,'busy');
 finish(structuredClone(tx));await running;assert.equal(f.base.active,0);assert.equal(f.effects.length,0);assert.equal(f.cleanupCalls.length,1);await f.flow.stop();
});

test('uninvoked shared-gate refusal remains distinct from an actual provider request',async()=>{
 const f=await fixture({cleanupBeforeStart:()=>{throw Error('PILOT_RPC_COMPONENT_DISPATCH_EXPIRED');}});f.notice();
 assert.equal((await f.flow.service()).kind,'unavailable');assert.equal(f.flow.usage().cleanupProof.logicalAttempts,1);
 assert.equal(f.flow.usage().cleanupProof.physicalStarts,0);assert.equal(f.flow.usage().perTransactionEnrichmentRequests,0);
 assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);await f.drive(2);assert.equal(f.cleanupCalls.length,1);await f.flow.stop();
});

test('a failed cleanup proof leaves an unrelated selected subscription usable',async()=>{
 const f=await fixture({cleanupRead:async()=>null});await f.open(peerScope);const peerBefore=f.flow.captureState(peerScope.mint)!;
 f.notice();await f.flow.service();const peerAfter=f.flow.snapshot(peerScope.mint)!;
 assert.equal(peerAfter.hasQualityLoss,false);assert.equal(peerAfter.completeRequiredEventFields,true);assert.equal(peerAfter.openedAt,peerBefore.openedAt);
 assert.equal(f.gaps.filter(g=>g.mint===peerScope.mint).length,0);assert.equal(f.flow.usage().connected,true);await f.flow.stop();
});

test('a cleanup lacking sufficient remaining original receipt runway starts no lookup',async()=>{
 const f=await fixture();f.notice();f.base.elapseWithoutTimers(3501);
 assert.equal((await f.flow.service()).kind,'unavailable');assert.equal(f.cleanupCalls.length,0);assert.equal(f.flow.usage().perTransactionEnrichmentRequests,0);
 assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);await f.flow.stop();
});

test('proof receipt after the declared operation bound is never admitted even before the5s cutoff',async()=>{
 let f:Awaited<ReturnType<typeof fixture>>;f=await fixture({cleanupRead:async()=>{await f.base.advance(1501);return structuredClone(tx);}});
 f.notice();assert.equal((await f.flow.service()).kind,'unavailable');assert.equal(f.effects.length,0);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);await f.flow.stop();
});

test('response validation and retention also fit inside the original1500ms scheduled operation',async()=>{
 let f:Awaited<ReturnType<typeof fixture>>;f=await fixture({cleanupRead:async()=>{await f.base.advance(1490);f.delayNextRecord(11);return structuredClone(tx);}});
 f.notice();assert.equal((await f.flow.service()).kind,'unavailable');assert.equal(f.effects.length,0);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);
 assert.ok(f.flow.usage().processingMs.maximum!<250,'the independent scheduled operation bound also applies when CPU work alone is within250ms');
 assert.ok(f.records.some(r=>r.kind==='native-flow-refusal'&&r.data.reason==='NATIVE_FLOW_PROCESSING_DEADLINE'));await f.flow.stop();
});

test('initial recognition and resumed response retention share the same250ms processing limit',async()=>{
 let f:Awaited<ReturnType<typeof fixture>>;f=await fixture({cleanupRead:async()=>{await f.base.advance(100);f.delayNextRecord(101);return structuredClone(tx);}});
 f.delayNextRecord(150);f.notice();assert.equal(f.flow.usage().cleanupProof.pending,1);
 assert.equal((await f.flow.service()).kind,'unavailable');assert.equal(f.effects.length,0);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);
 assert.equal(f.flow.usage().processingMs.maximum,251);assert.ok(f.records.some(r=>r.kind==='native-flow-cleanup-proof-transaction'));
 assert.ok(f.records.some(r=>r.kind==='native-flow-refusal'&&r.data.reason==='NATIVE_FLOW_PROCESSING_DEADLINE'));
 await f.flow.stop();
});

test('identical pending copies do not restart the original clock or perform another lookup',async()=>{
 const f=await fixture();f.notice();await f.base.advance(50);f.notice();
 assert.equal(f.flow.usage().cleanupProof.pending,1);assert.equal(f.flow.usage().cleanupProof.duplicates,1);assert.equal(f.flow.servicePlan().deadlineAt,original.receivedAt+5000);
 await f.flow.service();assert.equal(f.cleanupCalls.length,1);assert.equal(f.effects.length,1);assert.equal(f.flow.usage().notifications,2);await f.flow.stop();
});

test('the same exact packet cannot initiate another proof lookup after a fresh subscription',async()=>{
 const f=await fixture();f.notice();await f.flow.service();assert.equal(f.cleanupCalls.length,1);
 f.flow.removeCandidate(selected.mint,'OFFLINE_NEW_GENERATION');await f.flow.service();await f.base.advance(100);await f.open(selected);
 f.notice();assert.equal(f.flow.usage().cleanupProof.pending,0);assert.equal(f.cleanupCalls.length,1);
 assert.ok(f.records.some(r=>r.kind==='native-flow-refusal'&&r.data.reason==='NATIVE_FLOW_CLEANUP_ALREADY_ATTEMPTED'));
 await f.flow.stop();
});

test('an already stale program clock cannot consume a compiled proof request',async()=>{
 const f=await fixture({at:original.receivedAt+31000});f.notice();assert.equal(f.cleanupCalls.length,0);assert.equal(f.flow.usage().cleanupProof.pending,0);
 assert.ok(f.records.some(r=>r.kind==='native-flow-refusal'&&r.data.reason==='NATIVE_FLOW_CLEANUP_SOURCE_CLOCK'));await f.flow.stop();
});

test('a correction while proof is pending invalidates original and later bytes, and aborts only that lookup',async()=>{
 let finish!:(value:unknown)=>void,requestSignal:AbortSignal|undefined;
 const f=await fixture({cleanupRead:async(_method,_params,signal)=>{requestSignal=signal;return new Promise(resolve=>{finish=resolve;});}});
 f.notice();const running=f.flow.service();await settle();const corrected=structuredClone(tx.meta.logMessages);corrected[0]+=' correction';f.notice({logs:corrected});
 assert.equal(requestSignal?.aborted,true);assert.equal(f.flow.usage().corrections,1);assert.equal(f.flow.usage().cleanupProof.pending,0);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);
 finish(structuredClone(tx));await running;assert.equal(f.effects.length,0);assert.equal(f.cleanupCalls.length,1);
 assert.deepEqual(f.records.find(r=>r.kind==='native-flow-raw-refusal')!.data.logs,tx.meta.logMessages);await f.flow.stop();
});

for(const change of ['generation','subscription','connection','retirement'] as const){
 test('a '+change+' change during lookup cannot apply proof to another capture',async()=>{
  let finish!:(value:unknown)=>void;
  const f=await fixture({cleanupRead:async()=>new Promise(resolve=>{finish=resolve;})});f.notice();const running=f.flow.service();await settle();
  if(change==='connection')f.socket.drop();
  else if(change==='retirement')f.flow.removeCandidate(selected.mint,'OFFLINE_CAPTURE_RETIRED');
  else{const c=(f.flow as any).candidates.get(selected.mint);if(change==='generation')c.openedAt++;else c.subscription++;}
  finish(structuredClone(tx));await running;assert.equal(f.effects.length,0);assert.equal(f.flow.usage().cleanupProof.pending,0);assert.equal(f.flow.usage().cleanupProof.failed,1);assert.equal(f.cleanupCalls.length,1);await f.flow.stop();
 });
}

test('source admission closure prevents proof qualification and does not create a request retry',async()=>{
 let admitted=true;const f=await fixture({informationAdmissionOpen:()=>admitted});f.notice();admitted=false;
 await f.base.advance(100);assert.equal(f.flow.usage().cleanupProof.pending,0);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);await f.drive(2);assert.equal(f.cleanupCalls.length,0);await f.flow.stop();
});

test('another unresolved cleanup for the same scope fails bounded capacity instead of adding a queue',async()=>{
 const f=await fixture();f.notice();f.notice({signature:bs58.encode(Buffer.alloc(64,94))});
 assert.equal(f.flow.usage().cleanupProof.pending,0);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);assert.equal(f.cleanupCalls.length,0);
 assert.ok(f.records.some(r=>r.kind==='native-flow-refusal'&&r.data.reason==='NATIVE_FLOW_CLEANUP_PENDING_CAPACITY'));await f.flow.stop();
});

test('queued proof packets reserve the remaining attempt-fingerprint capacity before any request',async()=>{
 const f=await fixture();await f.open(peerScope);
 const attempts=(f.flow as any).cleanupAttempts as Map<string,unknown>;
 for(let i=0;i<511;i++)attempts.set('OFFLINE_RETAINED_ATTEMPT_'+i,{rawHash:'a'.repeat(64),slot:1,at:f.base.now});
 f.notice();assert.equal(f.flow.usage().cleanupProof.pending,1);
 // A second canonical scope has the same synthetic mechanics, but no compiled
 // response is manufactured: capacity refuses it before any lookup or effect.
 const actor=PublicKey.findProgramAddressSync([Buffer.from('boost_vault'),new PublicKey(peerScope.pool).toBuffer()],PUMP_AMM_PROGRAM_ID)[0];
 const logs=tx.meta.logMessages.map((line:string)=>{
  if(!line.startsWith('Program data: '))return line;const bytes=Buffer.from(line.slice(14),'base64'),event=coder.events.decode(bytes.toString('base64'))!;
  const data=event.data as any;data.pool=new PublicKey(peerScope.pool);
  if(event.name==='BuyEvent'){data.user=actor;data.user_quote_token_account=getAssociatedTokenAddressSync(NATIVE_MINT,actor,true,TOKEN_PROGRAM_ID);}
  else if(event.name==='BoostBuyAndBurnEvent')data.mint=new PublicKey(peerScope.mint);
  return 'Program data: '+Buffer.concat([bytes.subarray(0,8),coder.types.encode(event.name,data)]).toString('base64');
 });
 f.socket.frame({jsonrpc:'2.0',method:'logsNotification',params:{subscription:f.flow.snapshot(peerScope.mint)!.subscription,result:{context:{slot:tx.slot},value:{signature:bs58.encode(Buffer.alloc(64,95)),err:null,logs}}}});
 assert.equal(f.flow.usage().cleanupProof.pending,1);assert.equal(attempts.size,511);assert.equal(f.cleanupCalls.length,0);
 assert.ok(f.records.some(r=>r.kind==='native-flow-refusal'&&r.data.reason==='NATIVE_FLOW_CLEANUP_ATTEMPT_CAPACITY'));
 assert.equal(f.flow.snapshot(peerScope.mint)!.hasQualityLoss,true);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,false);
 await f.flow.service();assert.equal(attempts.size,512);assert.equal(f.cleanupCalls.length,1);assert.equal(f.effects.length,1);await f.flow.stop();
});

test('a heartbeat within the cleanup operation runway is serviced before the proof request',async()=>{
 const f=await fixture({at:original.receivedAt-9500});await f.base.advance(9500);f.notice();
 assert.equal(f.flow.usage().roundTripLiveness.nextHeartbeatAt,original.receivedAt+500);assert.equal(f.flow.servicePlan().action,'heartbeat');
 assert.equal((await f.flow.service()).kind,'ping');assert.equal(f.cleanupCalls.length,0);assert.equal(f.flow.servicePlan().action,'cleanup-proof');
 assert.equal((await f.flow.service()).kind,'cleanup-proof');assert.equal(f.cleanupCalls.length,1);assert.equal(f.effects.length,1);await f.flow.stop();
});

test('owed peer pong and HTTP cooldown retain their native shared-domain priorities',async()=>{
 const f=await fixture();f.notice();f.socket.controlFrame('ping',Buffer.from('pending-cleanup-peer'));
 assert.equal(f.flow.servicePlan().action,'peer-pong');assert.equal((await f.flow.service()).kind,'pong');assert.equal(f.cleanupCalls.length,0);
 f.setHttpCooldown(original.receivedAt+10000);assert.equal(f.flow.servicePlan().at,original.receivedAt+10000);
 await f.base.advance(5100);assert.equal(f.cleanupCalls.length,0);assert.equal(f.flow.usage().perTransactionEnrichmentRequests,0);assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);await f.flow.stop();
});

test('without an injected shared proof client the default parser still refuses this shape',async()=>{
 const f=await fixture({cleanupRead:undefined});f.notice();assert.equal(f.flow.snapshot(selected.mint)!.hasQualityLoss,true);assert.equal(f.flow.usage().cleanupProof.queued,0);assert.equal(f.flow.usage().perTransactionEnrichmentRequests,0);await f.flow.stop();
 assert.equal(NATIVE_CLEANUP_PROOF_POLICY.maximumAttemptsPerPacket,1);assert.equal(NATIVE_CLEANUP_PROOF_POLICY.automaticRetries,0);
});
