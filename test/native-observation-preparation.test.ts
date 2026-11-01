import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {preparedObservationFresh} from '../src/native-observation-preparation.js';
import type {ResearchClockNativeObservationSupport} from '../src/research-clock-pricing.js';

const AT=Date.parse('2026-11-01T21:00:00Z'),mint=new PublicKey(Buffer.alloc(32,19)).toBase58(),pool=canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),scope={mint,pool,minSlot:100};
function fixture(){
 let at=AT,reads=0,before:(()=>Promise<void>)|null=null,refusal:string|null=null,failure:Error|null=null;
 const accepted:ResearchClockNativeObservationSupport[]=[],gaps:unknown[]=[],physical:unknown[]=[];
 const binding=()=>({mint,pool,at,sourceSlot:100,evidence:'OFFLINE_CANONICAL_POOL_BINDING',summary:{marketClockUnixSeconds:Math.floor(at/1000),tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}} as ResearchClockNativeObservationSupport);
 const control={async operateData(){physical.push('unexpected-ws');throw Error('OFFLINE_UNEXPECTED_WS_OPERATION');},accountControlBytes(){},noteThrottle(){return at;}};
 const flow=new PilotNativeFlow({persistent:true,maximumCandidates:4,record(){},control:control as any,support:{async validateMany(){reads++;if(before)await before();if(failure)throw failure;return refusal?{validations:{},unavailable:{[mint]:refusal},context:null}:{validations:{[mint]:binding()},unavailable:{},context:null};}} as any,onCurrentPoolValidated:support=>accepted.push(support),onTrade(){throw Error('OFFLINE_NO_TRADE_EXPECTED');},onGap:gap=>gaps.push(gap)},{now:()=>at,monotonic:()=>at-AT,setTimer:()=>1,clearTimer(){},makeSocket(){throw Error('OFFLINE_NO_SOCKET_EXPECTED');}});
 return {flow,accepted,gaps,physical,binding,get now(){return at;},get reads(){return reads;},advance:(ms:number)=>{at+=ms;},setBefore:(fn:(()=>Promise<void>)|null)=>{before=fn;},setRefusal:(value:string|null)=>{refusal=value;},setFailure:(value:Error|null)=>{failure=value;}};
}

test('passive binding uses no slot, socket, ACK, financial callback or quality gap',async()=>{
 const f=fixture();try{const result=await f.flow.prepareObservation(scope);assert.equal(result.status,'ready');if(result.status!=='ready')return;
  assert.equal(f.reads,1);assert.equal(f.flow.usage().candidates,0);assert.deepEqual(f.physical,[]);assert.deepEqual(f.accepted,[]);assert.deepEqual(f.gaps,[]);
  f.advance(200);f.flow.addCandidate(scope);f.flow.adoptPreparedObservation(mint,result.support);assert.equal(f.reads,1);assert.equal(f.accepted.length,1);const view=f.flow.snapshot(mint)!;
  assert.equal(view.supportContext!.availableAt,AT);assert.equal(view.supportContext!.bankClockAt,AT);assert.equal(view.openedAt,null);assert.equal(view.subscriptionSentAt,null);assert.equal(view.connected,false);assert.equal(view.warm,false);assert.equal(view.sourceSupportFresh,true);
  assert.equal(f.flow.servicePlan().action,'upgrade','adopted fresh proof needs no duplicate account fetch');
 }finally{await f.flow.stop();}
});

test('absent pool and transient preflight failures do not tear down another registered scope',async()=>{
 const f=fixture();try{const otherMint=new PublicKey(Buffer.alloc(32,20)).toBase58();f.flow.addCandidate({mint:otherMint,pool:canonicalPumpPoolPda(new PublicKey(otherMint)).toBase58()});f.setRefusal('NATIVE_OBSERVATION_POOL_MISSING');assert.deepEqual(await f.flow.prepareObservation(scope),{status:'unavailable',reason:'NATIVE_OBSERVATION_POOL_MISSING'});f.setRefusal(null);f.setFailure(Error('PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT'));assert.deepEqual(await f.flow.prepareObservation(scope),{status:'unavailable',reason:'PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT'});
  assert.equal(f.flow.usage().candidates,1);assert.equal(f.flow.usage().fatal,null);assert.deepEqual(f.gaps,[]);assert.deepEqual(f.physical,[]);assert.equal(f.flow.snapshot(otherMint)!.hasQualityLoss,false);
 }finally{await f.flow.stop();}
});

test('freshness and minimum bank slot are rechecked at actual adoption',async()=>{
 const f=fixture();try{const result=await f.flow.prepareObservation(scope);assert.equal(result.status,'ready');if(result.status!=='ready')return;f.flow.addCandidate({...scope,minSlot:101});assert.throws(()=>f.flow.adoptPreparedObservation(mint,result.support),/PREPARATION_STALE/);assert.equal(f.accepted.length,0);f.flow.removeCandidate(mint);f.flow.addCandidate(scope);f.advance(30000);assert.throws(()=>f.flow.adoptPreparedObservation(mint,result.support),/PREPARATION_STALE/);assert.equal(f.accepted.length,0);assert.equal(f.flow.snapshot(mint)!.sourceSupportFresh,false);
 }finally{await f.flow.stop();}
});

test('an outstanding passive read retains service ownership until physical work returns',async()=>{
 const f=fixture();let resolve!:()=>void;f.setBefore(()=>new Promise<void>(r=>{resolve=r;}));const pending=f.flow.prepareObservation(scope);try{await Promise.resolve();assert.equal(f.flow.usage().sharedOperationActive,true);assert.deepEqual(await f.flow.prepareObservation(scope),{status:'deferred',reason:'NATIVE_FLOW_PREPARATION_BUSY'});assert.equal((await f.flow.service()).kind,'busy');assert.equal(f.reads,1);resolve();assert.equal((await pending).status,'ready');assert.equal(f.flow.usage().sharedOperationActive,false);
 }finally{resolve();await pending;await f.flow.stop();}
});

test('admission loss during a passive read discards returned proof without forging settlement or a gap',async()=>{
 const f=fixture();let admitted=true;f.setBefore(async()=>{admitted=false;});try{const result=await f.flow.prepareObservation(scope,undefined,{latestStartAt:f.now+1000,admissionOpen:()=>admitted});assert.equal(result.status,'deferred');assert.equal(f.reads,1);assert.equal(f.accepted.length,0);assert.equal(f.flow.usage().candidates,0);assert.deepEqual(f.gaps,[]);
 }finally{await f.flow.stop();}
});

test('a reusable proof is bounded by both receipt and original bank Clock freshness',async()=>{
 const f=fixture();const proof=f.binding();assert.equal(preparedObservationFresh(proof,AT+29999,mint,pool,100),true);assert.equal(preparedObservationFresh(proof,AT+30000,mint,pool,100),false);assert.equal(preparedObservationFresh({...proof,at:AT+1},AT),false);assert.equal(preparedObservationFresh({...proof,summary:{...proof.summary,marketClockUnixSeconds:(AT-30000)/1000}},AT),false);await f.flow.stop();
});
