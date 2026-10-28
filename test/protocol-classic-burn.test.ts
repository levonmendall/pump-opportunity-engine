/** Original forward refusal, replayed offline. Passing this test does not
 * retroactively repair that window or authorize financial qualification. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {dirname,join} from 'node:path';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';import BN from 'bn.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {parseProgramLogEvidence,parseProgramLogActivity,admitProtocolPoolEffect,CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,type ProgramLogInput} from '../src/program-log-mapping.js';

const evidence=JSON.parse(readFileSync('evidence/classic-protocol-burn-20261028/actual-refusal-and-support.json','utf8'));
const refusal=evidence.actualRawRefusal.data,support=evidence.freshSupport.data;
const availability=evidence.allRefusalMetadata.find((r:any)=>r.data.signature===refusal.signature).data.availableAt;
const scope={mint:support.mint,pool:support.pool,supportedPoolEvidence:support.evidence,baseTokenProgram:support.summary.tokenProgram,verifiedAt:support.at,minimumSlot:support.sourceSlot};
const options={dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW};
const input=():ProgramLogInput=>({signature:refusal.signature,slot:refusal.slot,err:null,logs:structuredClone(refusal.logs),commitment:'confirmed',receivedAt:refusal.receivedAt,availableAt:availability});
const require=createRequire(import.meta.url),coder=new BorshCoder(JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl);
const activity=(value=input(),selected=[scope])=>parseProgramLogActivity(value,selected,options);
function changed(name:string,mutate:(data:any)=>void){const value=input(),logs=value.logs as string[];for(let i=0;i<logs.length;i++){if(!logs[i]!.startsWith('Program data: '))continue;const encoded=logs[i]!.slice(14),event=coder.events.decode(encoded);if(event?.name!==name)continue;mutate(event.data);logs[i]='Program data: '+Buffer.concat([Buffer.from(encoded,'base64').subarray(0,8),coder.types.encode(event.name,event.data)]).toString('base64');return value;}throw Error('fixture event absent');}

test('actual classic protocol burn needs the fresh supported mint owner and remains a separate nonfinancial effect',()=>{
 assert.equal(evidence.refusalCount,5);assert.equal(evidence.rawSampleCount,1);
 assert.equal(scope.baseTokenProgram,TOKEN_PROGRAM_ID.toBase58());assert.equal(refusal.receivedAt-scope.verifiedAt,467);
 const value=input(),before=JSON.stringify(value),withoutOwner={...scope,baseTokenProgram:undefined};
 assert.throws(()=>parseProgramLogEvidence(value,[scope]),/UNSUPPORTED_SWAP_LABEL|UNSUPPORTED_PROTOCOL_BUY_AND_BURN/);
 assert.throws(()=>activity(value,[withoutOwner as any]),/BASE_BURN_FRAME/);
 const result=activity(value),effect=result.protocolEffects[0]!;
 assert.equal(result.trades.length,0);assert.equal(result.protocolEffects.length,1);assert.equal(result.protocolFramesObserved,1);
 assert.equal(result.financialQualificationAllowed,false);assert.equal(result.baselineFeatureSemantics,'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW');
 assert.equal(effect.quoteLamportsIn,'448404891');assert.equal(effect.baseUnitsBurned,'1001324648595');
 assert.equal(effect.actor.address,'7VJ4kewFhEnTBb6P7d4f25CzPTqWf7eSbgqoSjYyGHru');assert.equal(effect.actor.externalBuyer,false);
 assert.equal(effect.ordinaryUserBaseUnitsReceived,null);assert.equal(effect.pairedBuyLogIndex,12);assert.equal(effect.identity.logArrayIndex,16);
 assert.equal(effect.identity.signature,refusal.signature);assert.equal(effect.transferCrossCheck,'UNAVAILABLE');assert.equal(effect.transactionCompleteness,'NOT_ESTABLISHED');
 assert.ok(Object.values(effect.fees).every(f=>f==='0'));assert.equal(JSON.stringify(value),before);
 const admitted=admitProtocolPoolEffect(effect,scope,availability);assert.equal(admitted.financialQualificationAllowed,false);assert.equal(Object.hasOwn(admitted,'trade'),false);
});

test('explicit wrong or unsupported base-program bindings reject the actual classic shape',()=>{
 assert.throws(()=>activity(input(),[{...scope,baseTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58()}]),/BASE_TOKEN_PROGRAM_MISMATCH/);
 assert.throws(()=>activity(input(),[{...scope,baseTokenProgram:'11111111111111111111111111111111'}]),/VERIFIED_SCOPE_BASE_TOKEN_PROGRAM/);
});

test('the existing Token2022 shape remains byte-for-byte compatible and rejects an explicit classic binding',()=>{
 const tx=JSON.parse(readFileSync('evidence/protocol-pool-effects-20261028/boost-actual.json','utf8')),at=tx.blockTime*1000+11000;
 const priorScope={mint:'5TdjfgA5eJUFD4xQp8ZRvtZAQZVXZHq1dtB4pEg8pump',pool:'5ALPjDC4WUfReszwbmZLpwwbvfyqbjWgJw4t4K6LvE2k',supportedPoolEvidence:'OFFLINE_RETAINED_CREATION_AND_SDK_SUPPORT_CONTEXT'};
 const value:ProgramLogInput={signature:tx.transaction.signatures[0],slot:tx.slot,err:null,logs:tx.meta.logMessages,commitment:'confirmed',receivedAt:at-10,availableAt:at};
 const old=parseProgramLogActivity(value,[priorScope],options),bound=parseProgramLogActivity(value,[{...priorScope,baseTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58()}],options);assert.deepEqual(bound,old);
 assert.throws(()=>parseProgramLogActivity(value,[{...priorScope,baseTokenProgram:TOKEN_PROGRAM_ID.toBase58()}],options),/BASE_TOKEN_PROGRAM_MISMATCH/);
});

test('classic support does not relax paired fees, executed amounts, reserves, actor, timing or frame grammar',()=>{
 for(const [name,mutate,reason] of [
  ['BuyEvent',(e:any)=>{e.protocol_fee=new BN(1);},'FEE_UNSUPPORTED'],
  ['BuyEvent',(e:any)=>{e.base_amount_out=e.base_amount_out.addn(1);},'AMOUNT_AGREEMENT'],
  ['BoostBuyAndBurnEvent',(e:any)=>{e.base_reserves_after=e.base_reserves_after.addn(1);},'RESERVE_AGREEMENT'],
  ['BuyEvent',(e:any)=>{e.user=e.pool;},'ACTOR_ROLE'],
  ['BoostBuyAndBurnEvent',(e:any)=>{e.timestamp=e.timestamp.addn(1);},'TIME_AGREEMENT'],
 ] as const)assert.throws(()=>activity(changed(name,mutate)),new RegExp(reason));
 const labelled=input(),logs=labelled.logs as string[],burnAt=logs.findIndex((l,i)=>i>7&&l===`Program ${TOKEN_PROGRAM_ID.toBase58()} invoke [2]`);assert.ok(burnAt>=0);logs.splice(burnAt+1,0,'Program log: Instruction: Transfer');assert.throws(()=>activity(labelled),/BASE_BURN_FRAME/);
 const extra=input();(extra.logs as string[]).splice(12,0,`Program ${TOKEN_PROGRAM_ID.toBase58()} invoke [2]`,`Program ${TOKEN_PROGRAM_ID.toBase58()} success`);assert.throws(()=>activity(extra),/PROTOCOL_CHILD_SHAPE/);
 const failed=input();failed.err={InstructionError:[2,{Custom:1}]};assert.throws(()=>activity(failed),/TRANSACTION_NOT_SUCCESSFUL/);
});

test('classic effect admission still rejects stale support, stale receipt, future source and quote-floor regression',()=>{
 const effect=activity().protocolEffects[0]!;
 assert.throws(()=>admitProtocolPoolEffect(effect,{...scope,verifiedAt:availability-30001},availability),/FRESH_SCOPE_REQUIRED/);
 assert.throws(()=>admitProtocolPoolEffect(effect,{...scope,minimumSlot:refusal.slot+1},availability),/FRESH_SCOPE_REQUIRED/);
 assert.throws(()=>admitProtocolPoolEffect({...effect,receivedAt:availability-5001},scope,availability),/RECEIPT_DEADLINE/);
 assert.throws(()=>admitProtocolPoolEffect({...effect,programClockTimestamp:String(Math.floor(availability/1000)+1)},scope,availability),/CLOCK_STALE_OR_FUTURE/);
});
