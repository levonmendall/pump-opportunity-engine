/** Retained real Boost bytes; deliberately modified bytes/timing below are
 * OFFLINE stress fixtures, not corrected forward passes or trader permission. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {dirname,join} from 'node:path';
import BN from 'bn.js';import bs58 from 'bs58';import {BorshCoder,type Idl} from '@coral-xyz/anchor';import {PublicKey} from '@solana/web3.js';
import {parseProgramLogEvidence,parseProgramLogActivity,CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,admitProtocolPoolEffect,compareProtocolPoolEffects,toConfirmedProgramTrade,type ProgramLogInput,type ProtocolPoolEffect} from '../src/program-log-mapping.js';
const tx=JSON.parse(readFileSync('evidence/protocol-pool-effects-20261028/boost-actual.json','utf8')),at=tx.blockTime*1000+11000;
const scope={mint:'5TdjfgA5eJUFD4xQp8ZRvtZAQZVXZHq1dtB4pEg8pump',pool:'5ALPjDC4WUfReszwbmZLpwwbvfyqbjWgJw4t4K6LvE2k',supportedPoolEvidence:'OFFLINE_RETAINED_CREATION_AND_SDK_SUPPORT_CONTEXT',verifiedAt:at-1000,minimumSlot:tx.slot};
const require=createRequire(import.meta.url),coder=new BorshCoder(JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl);
const input=():ProgramLogInput=>({signature:tx.transaction.signatures[0],slot:tx.slot,err:null,logs:structuredClone(tx.meta.logMessages),commitment:'confirmed',receivedAt:at-10,availableAt:at});
const options={dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW};
function activity(value=input()){return parseProgramLogActivity(value,[scope],options);}
function effect(value=input()):ProtocolPoolEffect{const result=activity(value);assert.equal(result.protocolEffects.length,1);return result.protocolEffects[0]!;}
function changed(name:string,mutate:(data:any)=>void){const value=input(),logs=value.logs as string[];for(let i=0;i<logs.length;i++){if(!logs[i]!.startsWith('Program data: '))continue;const encoded=logs[i]!.slice(14),event=coder.events.decode(encoded);if(event?.name!==name)continue;mutate(event.data);logs[i]='Program data: '+Buffer.concat([Buffer.from(encoded,'base64').subarray(0,8),coder.types.encode(event.name,event.data)]).toString('base64');return value;}throw Error('fixture event absent');}

test('strictv2 keeps its original Boost refusal while explicit shadow classifies the actual paired pool effect',()=>{
 const value=input(),before=JSON.stringify(value);assert.throws(()=>parseProgramLogEvidence(value,[scope]),/UNSUPPORTED_SWAP_LABEL/);const result=activity(value),e=result.protocolEffects[0]!;
 assert.equal(result.dataContract,CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW);assert.equal(result.trades.length,0);assert.equal(result.protocolFramesObserved,1);assert.equal(result.baselineFeatureSemantics,'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW');assert.equal(result.financialQualificationAllowed,false);assert.equal(e.kind,'PROTOCOL_POOL_EFFECT');assert.equal(e.quoteLamportsIn,'477341378');assert.equal(e.baseUnitsBurned,'1253813629816');assert.equal(e.minimumBaseUnitsBurned,'1242766267550');assert.equal(e.ordinaryUserBaseUnitsReceived,null);assert.equal(e.actor.address,'5n4Hn2P1Psoi5Ga9dGqZr9DkfybBzH98nFrocuvM2Xhg');assert.equal(e.actor.role,'protocol-boost-vault-pda');assert.equal(e.actor.externalBuyer,false);assert.equal(e.instructionAuthority,tx.transaction.message.accountKeys[0]);assert.notEqual(e.actor.address,e.instructionAuthority);assert.ok(Object.values(e.fees).every(f=>f==='0'));assert.equal(e.transferCrossCheck,'UNAVAILABLE');assert.equal(e.compiledInstructionIdentity,null);assert.equal(e.transactionCompleteness,'NOT_ESTABLISHED');assert.equal(e.chainBlockTime,null);assert.equal(JSON.stringify(value),before);assert.equal(Object.hasOwn(e,'trader'),false);assert.equal(Object.hasOwn(e,'wallet'),false);
 assert.deepEqual(e.identity,{namespace:'solana-program-log-protocol-v1',signature:value.signature,program:'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',logArrayIndex:17});assert.equal(e.pairedBuyLogIndex,13);assert.deepEqual(e.events.map(row=>[row.name,row.logArrayIndex]),[['BuyEvent',13],['BoostBuyAndBurnEvent',17]]);assert.equal(e.events[0]!.eventBase64,(value.logs as string[])[13]!.slice(14));assert.equal(e.invocationDepth,1);
});

test('shadow mode is explicit and ordinary Buy/Sell paths retain exact strictv2 parity',()=>{
 assert.throws(()=>parseProgramLogActivity(input(),[scope],undefined as any),/EXPLICIT_OPT_IN/);assert.throws(()=>parseProgramLogActivity(input(),[scope],{dataContract:'other'} as any),/EXPLICIT_OPT_IN/);
 const retained=JSON.parse(readFileSync('evidence/dynamic-funnel-20261027/retained-log-events.ndjson','utf8').split('\n')[0]!),t=retained.data.transaction,s={mint:retained.data.selectedHints[0].mint,pool:'FUKUVc3MffnDK7dq877GT3wa8M5pmF5NNvrWUuXANhbt',supportedPoolEvidence:'OFFLINE_ORDINARY_SCOPE'},v:ProgramLogInput={signature:retained.data.hint.signature,slot:t.slot,err:null,logs:t.meta.logMessages,commitment:'confirmed',availableAt:retained.data.rpcAvailableAt};const ordinary=parseProgramLogEvidence(v,[s]),shadow=parseProgramLogActivity(v,[s],options);assert.deepEqual(shadow.trades,ordinary);assert.deepEqual(shadow.protocolEffects,[]);assert.equal(shadow.baselineFeatureSemantics,'V2_WITHOUT_PROTOCOL_FRAMES');assert.equal(shadow.financialQualificationAllowed,false);
});

for(const [label,event,mutate,reason] of [
 ['protocol fee','BuyEvent',(e:any)=>{e.protocol_fee=new BN(1);},'FEE_UNSUPPORTED'],
 ['fee rate','BuyEvent',(e:any)=>{e.lp_fee_basis_points=new BN(1);},'FEE_UNSUPPORTED'],
 ['executed quote','BoostBuyAndBurnEvent',(e:any)=>{e.quote_amount_in_used=e.quote_amount_in_used.addn(1);},'AMOUNT_AGREEMENT'],
 ['burn amount','BuyEvent',(e:any)=>{e.base_amount_out=e.base_amount_out.addn(1);},'AMOUNT_AGREEMENT'],
 ['post reserves','BoostBuyAndBurnEvent',(e:any)=>{e.base_reserves_after=e.base_reserves_after.addn(1);},'RESERVE_AGREEMENT'],
 ['user role','BuyEvent',(e:any)=>{e.user=new PublicKey(Buffer.alloc(32,9));},'ACTOR_ROLE'],
 ['user base receiver','BuyEvent',(e:any)=>{e.user_base_token_account=new PublicKey(Buffer.alloc(32,9));},'ACTOR_ROLE'],
 ['quote vault','BuyEvent',(e:any)=>{e.user_quote_token_account=new PublicKey(Buffer.alloc(32,9));},'ACTOR_ROLE'],
 ['pool','BoostBuyAndBurnEvent',(e:any)=>{e.pool=new PublicKey(Buffer.alloc(32,9));},'CANONICAL_POOL'],
 ['base mint','BoostBuyAndBurnEvent',(e:any)=>{e.mint=new PublicKey(Buffer.alloc(32,9));},'CANONICAL_POOL'],
 ['event clock','BoostBuyAndBurnEvent',(e:any)=>{e.timestamp=e.timestamp.addn(1);},'TIME_AGREEMENT'],
 ['buy variant','BuyEvent',(e:any)=>{e.ix_name='buy';},'BUY_ROLE_CONVENTION'],
 ['virtual reserves','BoostBuyAndBurnEvent',(e:any)=>{e.virtual_quote_reserves=e.virtual_quote_reserves.addn(1);},'VIRTUAL_RESERVES'],
] as const)test('protocol '+label+' mismatch never becomes an ordinary buy or inert nontrade',()=>{assert.throws(()=>activity(changed(event,mutate)),new RegExp(reason));});

test('unknown labels, extra/missing protocol events, routed and alternate burn frames fail without partial output',()=>{
 const unknown=input();unknown.logs=(unknown.logs as string[]).map(l=>l==='Program log: Instruction: BoostBuyAndBurn'?'Program log: Instruction: FutureProtocolEffect':l);assert.throws(()=>activity(unknown),/UNSUPPORTED_SWAP_LABEL|UNKNOWN_AMM_FRAME/);
 const missing=input();(missing.logs as string[]).splice(17,1);assert.throws(()=>activity(missing),/AMM_FRAME_LABEL_MISSING|PROTOCOL_/);
 const extra=input();(extra.logs as string[]).splice(17,0,(extra.logs as string[])[13]!);assert.throws(()=>activity(extra),/PROTOCOL_EVENT_PAIR/);
 const routed=input();routed.logs=['Program 11111111111111111111111111111111 invoke [1]',...(routed.logs as string[]).map(l=>l.replace(/invoke \[(\d+)\]/,(_m,n)=>'invoke ['+(Number(n)+1)+']')),'Program 11111111111111111111111111111111 success'];assert.throws(()=>activity(routed),/ROUTED_FRAME_UNSUPPORTED/);
 const alternate=input();alternate.logs=(alternate.logs as string[]).map(l=>l==='Program log: Instruction: Burn'?'Program log: Instruction: TransferChecked':l);assert.throws(()=>activity(alternate),/BASE_BURN_FRAME/);
 const failed=input();failed.err={InstructionError:[2,{Custom:1}]};assert.throws(()=>activity(failed),/TRANSACTION_NOT_SUCCESSFUL/);
});

test('protocol admission preserves receipt/source/context/cutoff validity and cannot return a NormalizedTrade',()=>{
 const e=effect(),admitted=admitProtocolPoolEffect(e,scope,at);assert.equal(admitted.validatedAt,at);assert.equal(admitted.financialQualificationAllowed,false);assert.equal(admitted.transferCrossCheck,'UNAVAILABLE');assert.equal(Object.hasOwn(admitted,'trade'),false);assert.notEqual(admitted.effect,e);assert.throws(()=>toConfirmedProgramTrade(e as any,scope,at),/NORMALIZATION_SCOPE/);
 for(const s of [{...scope,minimumSlot:tx.slot+1},{...scope,verifiedAt:at+1},{...scope,verifiedAt:at-30001}])assert.throws(()=>admitProtocolPoolEffect(e,s,at),/FRESH_SCOPE_REQUIRED/);assert.throws(()=>admitProtocolPoolEffect(e,scope,at,at),/ADMISSION_DEADLINE/);assert.throws(()=>admitProtocolPoolEffect({...e,receivedAt:at-5001},scope,at),/RECEIPT_DEADLINE/);assert.throws(()=>admitProtocolPoolEffect({...e,receivedAt:null},scope,at),/RECEIPT_DEADLINE/);assert.throws(()=>admitProtocolPoolEffect({...e,programClockTimestamp:String(at/1000+1)},scope,at),/CLOCK_STALE_OR_FUTURE/);assert.throws(()=>admitProtocolPoolEffect({...e,programClockTimestamp:String(at/1000-31)},scope,at),/CLOCK_STALE_OR_FUTURE/);
});

test('real effect identity separates duplicates, corrections and distinct actual log events',()=>{
 const a=effect(),b=effect({...input(),availableAt:at+1});assert.equal(compareProtocolPoolEffects(a,b),'duplicate');assert.equal(a.identityKey,b.identityKey);
 const value=input(),logs=value.logs as string[];for(let i=0;i<logs.length;i++){if(!logs[i]!.startsWith('Program data: '))continue;const encoded=logs[i]!.slice(14),event=coder.events.decode(encoded);if(!event)continue;const e=event.data as any;if(event.name==='BuyEvent')for(const key of ['max_quote_amount_in','quote_amount_in','user_quote_amount_in','quote_amount_in_with_lp_fee'])e[key]=e[key].addn(1);if(event.name==='BoostBuyAndBurnEvent'){e.quote_amount_in_requested=e.quote_amount_in_requested.addn(1);e.quote_amount_in_used=e.quote_amount_in_used.addn(1);e.real_quote_reserves_after=e.real_quote_reserves_after.addn(1);e.boost_vault_remaining=e.boost_vault_remaining.subn(1);}logs[i]='Program data: '+Buffer.concat([Buffer.from(encoded,'base64').subarray(0,8),coder.types.encode(event.name,event.data)]).toString('base64');}const correction=effect(value);assert.equal(compareProtocolPoolEffects(a,correction),'correction');assert.equal(a.identityKey,correction.identityKey);assert.notEqual(a.quoteLamportsIn,correction.quoteLamportsIn);const distinct=effect({...input(),signature:bs58.encode(Buffer.alloc(64,199))});assert.equal(compareProtocolPoolEffects(a,distinct),'distinct');
});

test('mixed ordinary and protocol frames retain each real event once with no protocol buyer in ordinary flow',()=>{
 const retained=JSON.parse(readFileSync('evidence/dynamic-funnel-20261027/retained-log-events.ndjson','utf8').split('\n')[0]!),s={mint:retained.data.selectedHints[0].mint,pool:'FUKUVc3MffnDK7dq877GT3wa8M5pmF5NNvrWUuXANhbt',supportedPoolEvidence:'OFFLINE_ORDINARY_SCOPE'},value=input();value.logs=[...retained.data.transaction.meta.logMessages,...value.logs as string[]];const result=parseProgramLogActivity(value,[scope,s],options);assert.equal(result.trades.length,1);assert.equal(result.protocolEffects.length,1);assert.equal(result.trades[0]!.mint,s.mint);assert.notEqual(result.trades[0]!.trader,result.protocolEffects[0]!.actor.address);assert.equal(result.protocolFramesObserved,1);assert.equal(result.baselineFeatureSemantics,'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW');assert.notEqual(result.trades[0]!.identityKey,result.protocolEffects[0]!.identityKey);assert.throws(()=>parseProgramLogEvidence(value,[scope,s]),/UNSUPPORTED_SWAP_LABEL/);
});
